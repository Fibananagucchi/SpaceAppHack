"""World layer on 2° cells (task 020). Synthetic cubes exist only in these tests."""

import json

import numpy as np
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.storage import globe_path, globe_trend_path, world_cube_dir, write_json_atomic
from backend.pipelines import europe_globe, europe_globe_trend
from backend.pipelines.europe_cube import PRODUCTS
from backend.pipelines.world_cube import world_constraint


def times_from(start_year: int, n: int) -> list[str]:
    return [f"{start_year + i // 12:04d}-{i % 12 + 1:02d}" for i in range(n)]


def write_world_cube(data_dir, variable_id, values, lats, lons, start_year=2000):
    folder = world_cube_dir(data_dir, variable_id)
    folder.mkdir(parents=True)
    np.save(folder / "data.npy", values.astype("float32"))
    meta = {"lat": lats, "lon": lons, "times": times_from(start_year, values.shape[2]),
            "sampling": {"stride": 4, "sampled_step_deg": {"lat": 1.0, "lon": 1.0}},
            "assembled_at": "2026-11-15T00:00:00Z"}
    (folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    (folder / "status.json").write_text(json.dumps({"status": "ready"}), encoding="utf-8")


def test_world_constraint_uses_strides_in_dimension_order():
    merra = world_constraint(PRODUCTS["merra2_t2m"], {"stride": 2, "n_lat": 361, "n_lon": 576})
    assert merra == "/T2M[0][0:2:360][0:2:575]"
    imerg = world_constraint(PRODUCTS["imerg"], {"stride": 10, "n_lat": 1800, "n_lon": 3600})
    assert imerg == "/Grid/precipitation[0][0:10:3599][0:10:1799]"          # IMERG stores (time, lon, lat)
    gldas = world_constraint(PRODUCTS["gldas"], {"stride": 4, "n_lat": 600, "n_lon": 1440})
    assert gldas.count("[0:4:599][0:4:1439]") == 3                        # three variables, one request


# Native 1° sample cells: two rows (one 2° box row at the south pole edge, one in the tropics), and at the date line
LATS = [-89.5, -88.5, 10.5, 11.5]
LONS = [-179.5, -178.5, 0.5, 1.5, 178.5, 179.5]


def synthetic_world(n_years=12, seed=2):
    rng = np.random.default_rng(seed)
    n = 12 * n_years
    t = np.arange(n)
    cube = 20 + 3 * np.sin(2 * np.pi * (t % 12) / 12) + rng.normal(scale=0.2, size=(4, 6, n)) + 0.8 * t / 120
    cube[:, 2:4, :] = np.nan                          # "sea" for a land-only product around 0-2° E
    return cube


def test_world_frames_and_trend_on_2deg_grid(tmp_settings):
    settings = tmp_settings()
    write_world_cube(settings.data_dir, "soil_moisture", synthetic_world(), LATS, LONS)
    f = europe_globe.build_globe("soil_moisture", settings.data_dir, domain="world")
    t = europe_globe_trend.build_globe_trend("soil_moisture", settings.data_dir, domain="world")
    for p in (f, t):
        assert p["grid"]["shape"] == [90, 180] and p["grid"]["lat0"] == -89.0 and p["grid"]["lon0"] == -179.0
        assert p["domain"]["id"] == "world" and p["grid"]["aggregation"]["sampling"]["stride"] == 4
    assert t["format_version"] == "map-1.2" and t["layer"] == "globe_trend_world_2deg"
    k_pole_w, k_pole_e = 0 * 180 + 0, 0 * 180 + 179    # boxes (-90..-88, -180..-178) and (-90..-88, 178..180)
    k_sea = 50 * 180 + 90                             # box (10..12 N, 0..2 E): only "sea" cells
    assert f["cell_status"][k_pole_w] == 0 and f["cell_status"][k_pole_e] == 0
    assert f["cell_status"][k_sea] == 1 and all(fr[k_sea] is None for fr in f["frames"])
    assert t["cells"]["status"][k_sea] == 1 and t["cells"]["slope"][k_sea] is None
    assert t["cells"]["status"][k_pole_w] == 0 and abs(t["cells"]["slope"][k_pole_w] - 0.8) < 0.1
    assert f["grid"]["aggregation"]["native_cells_per_box"] == {"min": 4, "max": 4}


def test_world_endpoints_index_and_strip(tmp_settings):
    settings = tmp_settings()
    with TestClient(create_app(settings)) as client:
        idx = client.get("/api/v1/globe").json()
        assert set(idx["domains"]) == {"europe", "world"} and idx["domains"]["world"]["grid"]["shape"] == [90, 180]
        layer = {x["variable_id"]: x for x in idx["layers"]}["soil_moisture"]
        assert layer["world"]["frames"]["status"] == "not_ready" and layer["europe"]["trend"]["status"] == "not_ready"
        assert client.get("/api/v1/globe/world/soil_moisture").json()["status"] == "not_ready"
        assert client.get("/api/v1/globe/world/ndvi/trend").json()["reason"] == "no_globe_layer_for_variable"
    write_world_cube(settings.data_dir, "soil_moisture", synthetic_world(), LATS, LONS)
    write_json_atomic(globe_path(settings.data_dir, "soil_moisture", "world"),
                      europe_globe.build_globe("soil_moisture", settings.data_dir, domain="world"))
    write_json_atomic(globe_trend_path(settings.data_dir, "soil_moisture", "world"),
                      europe_globe_trend.build_globe_trend("soil_moisture", settings.data_dir, domain="world"))
    with TestClient(create_app(settings)) as client:
        layer = {x["variable_id"]: x for x in client.get("/api/v1/globe").json()["layers"]}["soil_moisture"]
        assert layer["world"]["frames"]["status"] == "ok" and layer["world"]["trend"]["status"] == "ok"
        assert layer["europe"]["frames"]["status"] == "not_ready"        # domains are independent
        r = client.get("/api/v1/globe/world/soil_moisture/trend", headers={"Accept-Encoding": "gzip"})
        assert r.headers.get("content-encoding") == "gzip" and r.json()["domain"]["id"] == "world"
        s = client.get("/api/v1/globe/world/soil_moisture/strip", params={"lat": 11.0, "lon": 179.5}).json()
        assert s["selected"]["center_lon"] == 179.0 and len(s["neighbours"]) == 8
        assert -179.0 in {n["center_lon"] for n in s["neighbours"]}      # longitude wraps at the date line
        pole = client.get("/api/v1/globe/world/soil_moisture/strip", params={"lat": -89.5, "lon": -179.5}).json()
        assert len(pole["neighbours"]) == 5                               # no rows south of the pole
        europe_view = client.get("/api/v1/globe/europe").json()
        assert europe_view["domain"]["name"] == "Europe"                  # the Europe index keeps its old shape
