"""1° globe trend layer (map-1.2 on the globe-1 grid). Synthetic cubes exist only in these tests."""

import json

import numpy as np
from fastapi.testclient import TestClient

from backend.app import stats
from backend.app.main import create_app
from backend.app.series import to_display_units
from backend.app.storage import globe_trend_path, write_json_atomic
from backend.pipelines import europe_globe_trend as gt
from backend.pipelines.europe_maps import _cells_worker, sig4

ROW = 12                                                    # 46-47 N
LATS = [46.125, 46.375, 46.625, 46.875]
LONS = [-24.875 + 0.25 * k for k in range(16)]             # four 1° boxes: columns 0..3


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


def synthetic_cube(n_years=15, seed=1):
    """Box 0: +0.5 per decade; box 1: no trend; box 2: sea (never data); box 3: only 100 months of data."""
    rng = np.random.default_rng(seed)
    n = 12 * n_years
    t = np.arange(n)
    seasonal = 4.0 * np.sin(2 * np.pi * (t % 12) / 12)
    cube = 25.0 + seasonal + rng.normal(scale=0.3, size=(4, 16, n))
    cube[:, 0:4, :] += 0.5 * t / 120.0
    cube[:, 8:12, :] = np.nan
    cube[:, 12:16, 100:] = np.nan
    cube[0:3, 0:4, 50] = np.nan                       # box 0, one month: 12 of 16 cells missing -> that month is null
    return cube


def reference_box_series(cube, times, cols):
    """Independent path: stats.anomalies per native cell (point-analysis code) -> weighted mean -> 50 % rule."""
    anoms, has_data, w = [], [], []
    for i, lat in enumerate(LATS):
        for j in cols:
            v = to_display_units("soil_moisture", times, cube[i, j, :].astype(float))
            has_data.append(bool(np.isfinite(v).any()))
            anoms.append(stats.anomalies(times, v)[0])
            w.append(np.cos(np.deg2rad(lat)))
    a, w = np.array(anoms), np.array(w)[:, None]
    valid = np.isfinite(a)
    weights = np.where(valid, w, 0)
    mean = (np.where(valid, a, 0) * weights / np.maximum(weights.sum(axis=0), 1e-12)).sum(axis=0)
    return np.where(valid.sum(axis=0) >= 0.5 * sum(has_data), mean, np.nan)


def test_trend_of_aggregated_monthly_series(tmp_settings):
    settings = tmp_settings()
    cube = synthetic_cube()
    write_cube(settings.data_dir, "soil_moisture", cube, LATS, LONS)
    p = gt.build_globe_trend("soil_moisture", settings.data_dir)
    assert p["format_version"] == "map-1.2" and p["layer"] == "globe_trend_1deg"
    assert p["grid"]["shape"] == [38, 70] and p["grid"]["lat0"] == 34.5 and p["grid"]["lon0"] == -24.5
    k = [ROW * 70 + c for c in range(4)]
    status = [p["cells"]["status"][i] for i in k]
    assert status == [0, 0, 1, 2]                    # ok, ok, no_data (sea), insufficient_for_test (100 months)
    assert all(s == 1 for i, s in enumerate(p["cells"]["status"]) if i not in k)   # no native cells -> no_data

    times = times_from(2000, cube.shape[2])
    t_all = stats.month_offsets(times)
    for box, cols in [(0, range(0, 4)), (1, range(4, 8))]:
        ref = reference_box_series(cube, times, cols)
        if box == 0:
            assert np.isnan(ref[50])                 # the validity rule removed that month
        ok = np.isfinite(ref)
        mk = stats.mann_kendall_hamed_rao(t_all[ok], ref[ok])
        # independent code, different summation order: equal up to float noise (exactness: single-cell test below)
        ref_slope = mk.slope * stats.MONTHS_PER_DECADE   # payload is rounded to 4 significant digits
        assert abs(p["cells"]["slope"][k[box]] - ref_slope) <= 5e-4 * abs(ref_slope) + 1e-6
        assert abs(p["cells"]["p_value"][k[box]] - mk.p) < 1e-3
    assert abs(p["cells"]["slope"][k[0]] - 0.5) < 0.05 and p["cells"]["significant"][k[0]] is True
    for i in k[2:]:                                  # non-ok cells carry no numbers
        assert p["cells"]["slope"][i] is None and p["cells"]["significant"][i] is None
    for i, s in enumerate(p["cells"]["status"]):
        if s == 0:                                   # Benjamini-Hochberg: q >= p, decision taken from q
            assert p["cells"]["q_value"][i] >= p["cells"]["p_value"][i]
            assert p["cells"]["significant"][i] == (p["cells"]["q_value"][i] < 0.05)
    lo, hi = p["legend"]["range"]
    assert lo < 0 < hi and lo == -hi


def test_single_cell_box_equals_the_native_map_cell(tmp_settings):
    """AIRS-like 1° cube: every box holds one native cell, so the result must equal the native map code."""
    settings = tmp_settings()
    rng = np.random.default_rng(3)
    n = 12 * 14
    lats, lons = [46.5, 47.5], [10.5, 11.5, 12.5]
    cube = 280.0 + rng.normal(scale=0.5, size=(2, 3, n)) + np.linspace(0, 1.0, n)
    write_cube(settings.data_dir, "airs_surface_air_temp", cube, lats, lons)
    p = gt.build_globe_trend("airs_surface_air_temp", settings.data_dir)
    times = times_from(2000, n)
    stored = np.load(settings.data_dir / "cube" / "europe" / "airs_surface_air_temp" / "data.npy")   # float32 on disk
    values = to_display_units("airs_surface_air_temp", times, stored.astype("float64")).reshape(6, n)
    native = {flat: (s, pv) for flat, s, pv, _ in _cells_worker((times, values, list(range(6))))}
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            k = (int(lat - 34)) * 70 + int(lon + 25)
            s, pv = native[i * 3 + j]
            assert p["cells"]["slope"][k] == sig4(s) and p["cells"]["p_value"][k] == sig4(pv)
    assert p["grid"]["aggregation"]["native_cells_per_box"] == {"min": 1, "max": 1}


def test_validity_rule_on_box_months():
    times = times_from(2000, 72)                     # >= 5 values per calendar month for the climatology
    cube = np.random.default_rng(5).normal(size=(2, 2, 72))
    cube[0, 0, :] = np.nan                           # one cell never has data -> not counted
    cube[0, 1, 5] = np.nan                           # month 5: 2 of 3 cells with data valid -> valid
    cube[1, :, 6] = np.nan                           # month 6: 1 of 3 valid -> null
    series, with_data, per_box = gt.box_monthly_anomalies("soil_moisture", cube, np.array([46.2, 46.4]),
                                                          np.array([-24.8, -24.6]), times)
    k = ROW * 70
    assert with_data[k] == 3 and per_box[k] == 4
    assert np.isfinite(series[k, 5]) and np.isnan(series[k, 6])
    assert np.isnan(series[k + 1]).all()             # neighbouring box has no native cells


def test_trend_endpoint_and_index(tmp_settings):
    settings = tmp_settings()
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/globe/europe/soil_moisture/trend").json()["status"] == "not_ready"
        assert client.get("/api/v1/globe/europe/ndvi/trend").json()["reason"] == "no_globe_layer_for_variable"
        assert client.get("/api/v1/globe/europe/nope/trend").status_code == 404
    write_cube(settings.data_dir, "soil_moisture", synthetic_cube(), LATS, LONS)
    payload = gt.build_globe_trend("soil_moisture", settings.data_dir)
    write_json_atomic(globe_trend_path(settings.data_dir, "soil_moisture"), payload)
    with TestClient(create_app(settings)) as client:
        r = client.get("/api/v1/globe/europe/soil_moisture/trend", headers={"Accept-Encoding": "gzip"})
        assert r.headers.get("content-encoding") == "gzip"
        body = r.json()
        assert body["cells"] == payload["cells"] and body["provenance"]["served_from"] == "data_dir"
        layers = {x["variable_id"]: x for x in client.get("/api/v1/globe/europe").json()["layers"]}
        assert layers["soil_moisture"]["trend"]["status"] == "ok"
        assert layers["t2m"]["trend"]["status"] == "not_ready"


def test_trend_prepared_copy_is_served(tmp_settings):
    settings = tmp_settings()
    write_cube(settings.data_dir, "soil_moisture", synthetic_cube(), LATS, LONS)
    gt.write_prepared(settings.prepared_dir, "soil_moisture", gt.build_globe_trend("soil_moisture", settings.data_dir))
    with TestClient(create_app(settings)) as client:
        body = client.get("/api/v1/globe/europe/soil_moisture/trend").json()
    assert body["status"] == "ok" and body["provenance"]["served_from"] == "prepared_copy_in_image"
