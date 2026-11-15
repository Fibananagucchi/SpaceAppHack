"""Globe frames (globe-1), time-strip neighbours and series.annual (task 017).

Synthetic cubes exist only in these tests; they are never written to the real data directories.
"""

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app import annual, stats
from backend.app.main import create_app
from backend.pipelines import europe_globe
from backend.app.storage import globe_path, write_json_atomic


def times_from(start_year: int, n: int) -> list[str]:
    return [f"{start_year + i // 12:04d}-{i % 12 + 1:02d}" for i in range(n)]


def write_cube(data_dir, variable_id, values, lats, lons, start_year=2000):
    folder = data_dir / "cube" / "europe" / variable_id
    folder.mkdir(parents=True)
    np.save(folder / "data.npy", values.astype("float32"))
    meta = {"product": {"short_name": "TEST", "version": "1"}, "lat": lats, "lon": lons,
            "times": times_from(start_year, values.shape[2]), "months_without_granule": [],
            "months_with_failed_downloads": [], "assembled_at": "2026-11-15T00:00:00Z"}
    (folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    (folder / "status.json").write_text(json.dumps({"status": "ready"}), encoding="utf-8")


# ---------------------------------------------------------------------------------------------
# Annual anomalies
# ---------------------------------------------------------------------------------------------
def test_annual_mean_needs_ten_valid_months():
    times = times_from(2000, 36)
    a = np.ones(36)
    a[12:15] = np.nan          # 2001: 9 valid months -> null
    a[24:26] = np.nan          # 2002: 10 valid months -> valid
    years, values, counts, in_record = annual.annual_means(times, a)
    assert years == [2000, 2001, 2002] and in_record == [12, 12, 12]
    assert values[0] == 1.0 and np.isnan(values[1]) and values[2] == 1.0
    assert counts.tolist() == [12, 9, 10]


def test_annual_series_reasons_and_no2_threshold():
    times = times_from(2000, 30)[5:]                      # 2000-06 .. 2002-06
    a = np.zeros(len(times))
    a[10:14] = np.nan                                     # 2001: 8 valid months
    s = annual.annual_series("t2m", times, a, "°C", {"start": times[0], "end": times[-1]})
    by_year = {p["year"]: p for p in s["points"]}
    assert by_year[2000]["anomaly"] is None and by_year[2000]["missing_reason"] == "year_not_fully_in_period"
    assert by_year[2001]["anomaly"] is None and by_year[2001]["missing_reason"] == "fewer_than_10_valid_months"
    assert by_year[2001]["valid_months"] == 8 and s["min_valid_months"] == 10
    no2 = annual.annual_series("no2_tropo", times, a, "1e15 molecules/cm2", {"start": times[0], "end": times[-1]})
    assert {p["year"]: p["anomaly"] for p in no2["points"]}[2001] == 0.0 and no2["min_valid_months"] == 6
    assert "lower threshold" in no2["rule"]


# ---------------------------------------------------------------------------------------------
# Globe frames from a synthetic cube
# ---------------------------------------------------------------------------------------------
GLDAS_LATS = [46.125, 46.375, 46.625, 46.875]                       # one 1° row (46-47 N)
GLDAS_LONS = [-24.875 + 0.25 * k for k in range(12)]                # three 1° columns (-25..-22 E)


def synthetic_soil_moisture(n_years=12):
    """value = 20 + seasonal cycle + year offset; anomalies therefore = year offset - its mean."""
    n = 12 * n_years
    months = np.arange(n) % 12
    year_offset = np.repeat(np.linspace(-1.0, 1.0, n_years), 12)
    series = 20.0 + 3.0 * np.sin(2 * np.pi * months / 12) + year_offset
    cube = np.broadcast_to(series, (4, 12, n)).copy()
    cube[:, 8:12, :] = np.nan                                    # third 1° box: "sea", never any data
    y5 = slice(5 * 12, 6 * 12)
    cube[0:2, 0:4, y5] = np.nan                                  # box 0: 8 of 16 cells missing in year 5 -> still valid
    cube[0:3, 4:7, y5] = np.nan                                  # box 1: 9 of 16 cells missing in year 5 -> null
    cube[3, 7, 6 * 12:6 * 12 + 3] = np.nan                       # one cell loses 3 months in year 6 (its year is null)
    return cube, np.linspace(-1.0, 1.0, n_years)


def reference_box(cube, lats, cols, times):
    """Independent per-cell reference: stats.anomalies (point analysis) -> annual -> weighted box mean."""
    yearly, has_data, weights = [], [], []
    for i, lat in enumerate(lats):
        for j in cols:
            series = cube[i, j, :].astype(float)
            has_data.append(bool(np.isfinite(series).any()))
            anom, _, _ = stats.anomalies(times, series)
            yearly.append(annual.annual_means(times, anom)[1])
            weights.append(np.cos(np.deg2rad(lat)))
    yearly, w = np.array(yearly), np.array(weights)[:, None]
    valid = np.isfinite(yearly)
    mean = (np.where(valid, yearly, 0.0) * w).sum(axis=0) / np.maximum((np.where(valid, w, 0.0)).sum(axis=0), 1e-12)
    return np.where(valid.sum(axis=0) >= 0.5 * sum(has_data), mean, np.nan)


def test_globe_frames_aggregate_real_rules(tmp_settings):
    settings = tmp_settings()
    cube, offsets = synthetic_soil_moisture()
    write_cube(settings.data_dir, "soil_moisture", cube, GLDAS_LATS, GLDAS_LONS)
    p = europe_globe.build_globe("soil_moisture", settings.data_dir)
    assert p["format_version"] == "globe-1" and p["grid"]["shape"] == [38, 70]
    assert p["years"] == list(range(2000, 2012)) and p["months_in_record"] == [12] * 12
    assert p["baseline"]["kind"] == "full_record"
    scale = p["encoding"]["scale"]
    row = 12                                                     # 46.5 N
    k0, k1, k2 = row * 70 + 0, row * 70 + 1, row * 70 + 2
    times = times_from(2000, cube.shape[2])
    ref0 = reference_box(cube, GLDAS_LATS, range(0, 4), times)
    ref1 = reference_box(cube, GLDAS_LATS, range(4, 8), times)
    expected = offsets - offsets.mean()
    for y, frame in enumerate(p["frames"]):
        assert frame[k0] is not None and abs(frame[k0] * scale - ref0[y]) <= scale / 2 + 1e-9
        assert abs(frame[k0] * scale - expected[y]) < 0.02         # ~ the synthetic year offsets
        assert frame[k2] is None                                 # sea box: null, never 0
        if y == 5:
            assert frame[k1] is None and np.isnan(ref1[y])       # fewer than half of the cells with data are valid
        else:
            assert abs(frame[k1] * scale - ref1[y]) <= scale / 2 + 1e-9
    assert p["cell_status"][k2] == 1 and p["cell_status"][k0] == 0 and p["cell_status"][k1] == 0
    assert p["cell_counts"]["ok"] == 2                           # boxes without any native cell are no_data too
    assert all(f[0] is None for f in p["frames"])                # far from the cube: null
    assert p["grid"]["aggregation"]["native_cells_per_box"] == {"min": 16, "max": 16}
    assert p["legend"]["range"][0] == -p["legend"]["range"][1]


def test_box_index_puts_edge_centres_in_last_box():
    idx = europe_globe.box_index(np.array([34.0, 34.5, 71.5, 72.0]), 34.0, 1.0, 38)
    assert idx.tolist() == [0, 0, 37, 37]


# ---------------------------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------------------------
def write_frames(settings, variable_id="soil_moisture"):
    cube, _ = synthetic_soil_moisture()
    write_cube(settings.data_dir, variable_id, cube, GLDAS_LATS, GLDAS_LONS)
    payload = europe_globe.build_globe(variable_id, settings.data_dir)
    write_json_atomic(globe_path(settings.data_dir, variable_id), payload)
    return payload


def test_globe_endpoints_explicit_states(tmp_settings):
    settings = tmp_settings()
    with TestClient(create_app(settings)) as client:
        idx = client.get("/api/v1/globe/europe").json()
        assert idx["status"] == "ok" and {x["status"] for x in idx["layers"]} == {"not_ready"}
        assert client.get("/api/v1/globe/europe/t2m").json()["status"] == "not_ready"
        assert client.get("/api/v1/globe/europe/ndvi").json()["reason"] == "no_globe_layer_for_variable"
        assert client.get("/api/v1/globe/europe/nope").status_code == 404
        out = client.get("/api/v1/globe/europe/t2m/strip", params={"lat": 40.7, "lon": -74.0}).json()
        assert out["status"] == "not_available" and out["reason"] == "outside_globe_layer"
        assert client.get("/api/v1/globe/europe/t2m/strip", params={"lat": 50, "lon": 10}).json()["status"] == "not_ready"
        assert client.get("/api/v1/globe/europe/t2m/strip", params={"lat": 50, "lon": 10, "ring": 3}).status_code == 400


def test_globe_frames_and_strip(tmp_settings):
    settings = tmp_settings()
    payload = write_frames(settings)
    with TestClient(create_app(settings)) as client:
        idx = {x["variable_id"]: x for x in client.get("/api/v1/globe/europe").json()["layers"]}
        assert idx["soil_moisture"]["status"] == "ok" and idx["soil_moisture"]["years"] == {"first": 2000, "last": 2011}
        frames = client.get("/api/v1/globe/europe/soil_moisture").json()
        assert frames["frames"] == payload["frames"] and frames["provenance"]["served_from"] == "data_dir"

        s = client.get("/api/v1/globe/europe/soil_moisture/strip", params={"lat": 46.4, "lon": -23.7}).json()
        assert s["status"] == "ok" and s["selected"]["center_lat"] == 46.5 and s["selected"]["center_lon"] == -23.5
        assert s["selected"]["values"][5] is None                 # the null year stays null
        assert len(s["neighbours"]) == 8 and {n["ring"] for n in s["neighbours"]} == {1}
        west = next(n for n in s["neighbours"] if n["center_lat"] == 46.5 and n["center_lon"] == -24.5)
        sea = next(n for n in s["neighbours"] if n["center_lat"] == 46.5 and n["center_lon"] == -22.5)
        assert west["status"] == "ok" and west["values"][5] is not None
        assert sea["status"] == "no_data" and all(v is None for v in sea["values"])

        corner = client.get("/api/v1/globe/europe/soil_moisture/strip", params={"lat": 34.2, "lon": -24.9}).json()
        assert len(corner["neighbours"]) == 3                     # cells outside the layer are not listed
        ring2 = client.get("/api/v1/globe/europe/soil_moisture/strip",
                           params={"lat": 50.5, "lon": 10.5, "ring": 2}).json()
        assert len(ring2["neighbours"]) == 24 and [n["ring"] for n in ring2["neighbours"]][:8] == [1] * 8


def test_prepared_copy_is_served_when_data_dir_has_none(tmp_settings):
    settings = tmp_settings()
    cube, _ = synthetic_soil_moisture()
    write_cube(settings.data_dir, "soil_moisture", cube, GLDAS_LATS, GLDAS_LONS)
    europe_globe.write_prepared(settings.prepared_dir, "soil_moisture",
                                europe_globe.build_globe("soil_moisture", settings.data_dir))
    with TestClient(create_app(settings)) as client:
        body = client.get("/api/v1/globe/europe/soil_moisture").json()
    assert body["status"] == "ok" and body["provenance"]["served_from"] == "prepared_copy_in_image"


@pytest.mark.parametrize("period,kind", [(None, "full_record"), ({"start": "2003-01", "end": "2011-12"}, "analysis_period")])
def test_analysis_has_annual_series_matching_the_globe(tmp_settings, period, kind):
    settings = tmp_settings()
    clean = np.broadcast_to(synthetic_soil_moisture()[0][0, 0, :], (4, 12, 144)).copy()   # no gaps: native = box
    write_cube(settings.data_dir, "surface_runoff", clean, GLDAS_LATS, GLDAS_LONS)
    payload = europe_globe.build_globe("surface_runoff", settings.data_dir)
    write_json_atomic(globe_path(settings.data_dir, "surface_runoff"), payload)
    body = {"variable_id": "surface_runoff", "location": {"type": "point", "lat": 46.4, "lon": -24.4}}
    if period:
        body["period"] = period
    with TestClient(create_app(settings)) as client:
        a = client.post("/api/v1/analyses", json=body).json()
    ann = a["series"]["annual"]
    assert ann["status"] == "ok" and ann["baseline"]["kind"] == kind and ann["min_valid_months"] == 10
    monthly = [p["anomaly"] for p in a["series"]["points"]]
    first = ann["points"][0]
    assert first["anomaly"] == pytest.approx(np.mean([m for m in monthly[:12] if m is not None]), rel=1e-5)
    if kind == "full_record":
        # the same baseline as the globe: the native cell agrees with its 1° box (all native cells equal here;
        # surface runoff is converted to display units in both paths)
        k = 12 * 70 + 0
        for p, frame in zip(ann["points"], payload["frames"]):
            if p["anomaly"] is not None and frame[k] is not None:
                assert abs(p["anomaly"] - frame[k] * payload["encoding"]["scale"]) <= payload["encoding"]["scale"]
