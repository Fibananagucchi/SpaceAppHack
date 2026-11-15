"""Globe Changes layer (changes-1, task 022). Synthetic cubes exist only in these tests."""

import json

import numpy as np
from fastapi.testclient import TestClient

from backend.app import breaks, stats
from backend.app.main import create_app
from backend.app.storage import globe_changes_path, write_json_atomic
from backend.pipelines import globe_changes as gc


def times_from(start_year: int, n: int) -> list[str]:
    return [f"{start_year + i // 12:04d}-{i % 12 + 1:02d}" for i in range(n)]


def write_cube(data_dir, variable_id, values, lats, lons, start_year=2000):
    folder = data_dir / "cube" / "europe" / variable_id
    folder.mkdir(parents=True)
    np.save(folder / "data.npy", values.astype("float32"))
    meta = {"lat": lats, "lon": lons, "times": times_from(start_year, values.shape[2]), "assembled_at": "2026-11-15T00:00:00Z"}
    (folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    (folder / "status.json").write_text(json.dumps({"status": "ready"}), encoding="utf-8")


def step_series(n, at, size, base, seed):
    rng = np.random.default_rng(seed)
    x = base + rng.normal(scale=0.4 * abs(base) * 0.01 + 0.02, size=n) + 0.3 * np.sin(2 * np.pi * np.arange(n) / 12)
    x[at:] += size
    return x


def test_decide_change_is_the_point_analysis_rule():
    times = times_from(2000, 300)
    x = step_series(300, 150, 1.0, 0.0, 1)
    anom = stats.anomalies(times, x)[0]
    full = breaks.analyze_breaks(times, anom, "u", {"status": "not_applicable"}, [])
    t = stats.month_offsets(times)
    d = breaks.decide_change(t[np.isfinite(anom)], anom[np.isfinite(anom)])
    assert d["status"] == full["change_point"]["status"] == "detected"


# Precipitation-like 1° cells at 50-51 N: box 0 step at the IMERG 2014-06 boundary, box 1 no change, box 2 sea
LATS = [50.25, 50.75]
LONS = [-24.75, -24.25, -23.75, -23.25, -22.75, -22.25]


def test_boundary_step_is_a_possible_artifact_and_sea_is_no_data(tmp_settings):
    settings = tmp_settings()
    n, at = 300, (2014 - 2000) * 12 + 5                      # step in 2014-06
    cube = np.zeros((2, 6, n))
    for i in range(2):
        for j in range(6):
            cube[i, j] = step_series(n, at, 0.05 if j < 2 else 0.0, 0.1, seed=10 * i + j)
    cube[:, 4:6, :] = np.nan
    write_cube(settings.data_dir, "precip", cube, LATS, LONS)
    p = gc.build_changes("precip", settings.data_dir, "europe")
    row = 16                                                  # 50-51 N
    k0, k1, k2 = row * 70, row * 70 + 1, row * 70 + 2
    assert p["cell_status"][k0] == 1 and p["cell_status"][k2] == 5
    assert p["cell_status"][k1] in (0, 3)                     # no step: not detected / not distinct from trend
    c = p["changes"]
    i = c["cell"].index(k0)
    assert c["month"][i] in ("2014-05", "2014-06", "2014-07") and c["shift"][i] > 0
    assert c["category"][i] == 0 and c["boundary_id"][i] == "imerg_v07_gpm_era" and c["coinciding"][i] is False
    assert all(len(v) == len(c["cell"]) for v in c.values())
    assert p["counts"]["detected_by_category"]["possible_data_artifact"] >= 1


def test_known_event_gives_human_influence_and_endpoint(tmp_settings):
    settings = tmp_settings()
    # soil moisture step in 2023-06 in the Kakhovka box. Synthetic months run on past the real record (to 2029-05) so that
    # the step is not at the end and every calendar month has the same number of months after the step: otherwise the
    # full-record climatology tilts some calendar months and Pettitt places the change a few months off (as for a point)
    n, at = (2029 - 2010) * 12 + 5, (2023 - 2010) * 12 + 5
    lats, lons = [47.25, 47.75], [33.25, 33.75]
    cube = np.stack([np.stack([step_series(n, at, -3.0, 30.0, seed=i * 2 + j) for j in range(2)]) for i in range(2)])
    write_cube(settings.data_dir, "soil_moisture", cube, lats, lons, start_year=2010)
    p = gc.build_changes("soil_moisture", settings.data_dir, "europe")
    k = (47 - 34) * 70 + (33 + 25)
    c = p["changes"]
    i = c["cell"].index(k)
    # Pettitt locates a step to within a few months (rank statistic), the same for a point analysis
    assert c["status"][i] == 1 and abs(gc._month_diff(c["month"][i], "2023-06")) <= 6 and c["shift"][i] < 0
    # the category rules themselves, on the documented month
    assert gc.classify("soil_moisture", "2023-06", -3.0, [33, 47, 34, 48], []) == (2, None, "kakhovka_dam_breach_2023", False)
    t2m_bounds = [b for b in __import__("backend.app.catalog", fromlist=["x"]).product_boundaries("t2m")]
    assert gc.classify("t2m", "1992-01", -0.5, [10, 46, 12, 48], t2m_bounds)[1:] == ("merra2_stream_2", "pinatubo_eruption_1991", True)
    assert gc.classify("t2m", "1992-01", -0.5, [10, 46, 12, 48], t2m_bounds)[0] == 0
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/globe/europe/soil_moisture/changes").json()["status"] == "not_ready"
    write_json_atomic(globe_changes_path(settings.data_dir, "soil_moisture", "europe"), p)
    with TestClient(create_app(settings)) as client:
        body = client.get("/api/v1/globe/europe/soil_moisture/changes", headers={"Accept-Encoding": "gzip"}).json()
        assert body["format_version"] == "changes-1" and body["changes"] == c
        layer = {x["variable_id"]: x for x in client.get("/api/v1/globe").json()["layers"]}["soil_moisture"]
        assert layer["europe"]["changes"]["status"] == "ok" and layer["world"]["changes"]["status"] == "not_ready"
        assert client.get("/api/v1/globe/world/ndvi/changes").json()["reason"] == "no_globe_layer_for_variable"
        events = {e["event_id"]: e for e in client.get("/api/v1/known-events").json()["events"]}
        assert events["kakhovka_dam_breach_2023"]["marker"]["lat"] == 47.15
        assert events["pinatubo_eruption_1991"]["marker"] is None
