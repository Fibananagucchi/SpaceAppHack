"""Series sources, unit conversions and the point-analysis response (step 1).

All series here are synthetic and exist only inside tests (AGENTS.md rule 10).
"""

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app import analysis, series
from backend.app.main import create_app
from backend.app.series import MonthlySeries, SourceError


# ---------------------------------------------------------------------------------------------
# Units (product documentation)
# ---------------------------------------------------------------------------------------------
def test_unit_conversions_follow_product_documentation():
    times = ["2021-01", "2021-02"]  # 31 and 28 days
    one = np.array([1.0, 1.0])
    assert series.to_display_units("t2m", times, np.array([273.15, 300.15])).tolist() == pytest.approx([0.0, 27.0])
    assert series.to_display_units("airs_surface_air_temp", times, np.array([273.15, 273.15])).tolist() == pytest.approx([0, 0])
    assert series.to_display_units("precip", times, one).tolist() == pytest.approx([24 * 31, 24 * 28])
    assert series.to_display_units("evapotranspiration", times, one).tolist() == pytest.approx([86400 * 31, 86400 * 28])
    assert series.to_display_units("surface_runoff", times, one).tolist() == pytest.approx([8 * 31, 8 * 28])
    assert series.to_display_units("soil_moisture", times, np.array([25.0, 30.0])).tolist() == [25.0, 30.0]
    assert series.to_display_units("no2_tropo", times, np.array([2e15, 3e15])).tolist() == pytest.approx([2.0, 3.0])
    nan_in = series.to_display_units("precip", times, np.array([np.nan, 1.0]))
    assert np.isnan(nan_in[0])  # missing stays missing


# ---------------------------------------------------------------------------------------------
# Giovanni CSV and daily -> monthly aggregation
# ---------------------------------------------------------------------------------------------
CSV_DAILY = "\r\n".join(
    ["prod_name,OMNO2d.003", "unit,molecules/cm^2", "undef,-1.26765e+30", "lat,46.624992", "lon,32.625", "",
     "Timestamp (UTC),Data"]
    + [f"2020-01-{d:02d} 00:00,{(1e15 if d <= 12 else -1.26765e+30):g}" for d in range(1, 32)]   # 12 valid days
    + [f"2020-02-{d:02d} 00:00,{(1e15 if d <= 5 else -1.26765e+30):g}" for d in range(1, 30)]    # 5 valid days
    + [f"2020-04-{d:02d} 00:00,2e+15" for d in range(1, 31)]                                     # March absent
)


def test_parse_giovanni_csv_and_daily_rule():
    header, rows = series.parse_giovanni_csv(CSV_DAILY)
    assert header["lat"] == "46.624992" and header["undef"] == "-1.26765e+30"
    months, values, reasons, n_rows = series._monthly_from_rows(rows, float(header["undef"]), daily=True)
    assert months == ["2020-01", "2020-02", "2020-03", "2020-04"]
    assert values[0] == pytest.approx(1e15) and reasons[0] is None
    assert np.isnan(values[1]) and reasons[1] == "too_few_valid_days"
    assert np.isnan(values[2]) and reasons[2] == "no_granule"
    assert values[3] == pytest.approx(2e15)


def test_monthly_fill_values_become_nan_with_reason():
    rows = [("2000-01-01", 280.0), ("2000-02-01", -9999.0), ("2000-03-01", 281.0)]
    months, values, reasons, _ = series._monthly_from_rows(rows, -9999.0, daily=False)
    assert np.isnan(values[1]) and reasons[1] == "fill_value"
    assert reasons[0] is None and values[2] == 281.0


# ---------------------------------------------------------------------------------------------
# Europe cube reader
# ---------------------------------------------------------------------------------------------
def write_tiny_cube(data_dir, variable_id="t2m"):
    folder = data_dir / "cube" / "europe" / variable_id
    folder.mkdir(parents=True)
    lat = [46.0, 46.5, 47.0]
    lon = [32.5, 33.125]
    times = [f"{1990 + i // 12}-{i % 12 + 1:02d}" for i in range(24)]
    cube = np.full((3, 2, 24), 280.0, dtype="float32")
    cube[1, 0, 5] = np.nan
    np.save(folder / "data.npy", cube)
    meta = {"product": {"short_name": "M2IMNXASM", "version": "5.12.4"}, "lat": lat, "lon": lon, "times": times,
            "months_without_granule": ["1990-03"], "months_with_failed_downloads": [], "assembled_at": "2026-11-14T14:54:19Z"}
    cube[1, 0, 2] = np.nan
    np.save(folder / "data.npy", cube)
    (folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    (folder / "status.json").write_text(json.dumps({"status": "ready"}), encoding="utf-8")
    return folder


def test_cube_reader_nearest_cell_reasons_and_units(tmp_path):
    write_tiny_cube(tmp_path)
    assert series.cube_ready(tmp_path, "t2m")
    s = series.from_cube(tmp_path, "t2m", 46.6, 32.6)
    assert s.grid_cell["center_lat"] == 46.5 and s.grid_cell["center_lon"] == 32.5
    assert s.values[0] == pytest.approx(280.0 - 273.15, abs=1e-4)
    assert s.missing_reasons[2] == "no_granule" and s.missing_reasons[5] == "fill_value"
    assert s.provenance["source_service"] == "europe_cube"
    assert series.from_cube(tmp_path, "t2m", 50.0, 32.6) is None  # outside the cube grid


# ---------------------------------------------------------------------------------------------
# Point analysis response
# ---------------------------------------------------------------------------------------------
def fake_series(n_months=300, start="1990-01", gaps=(), values=None):
    times = series.month_range(start, f"{int(start[:4]) + (n_months - 1) // 12:04d}-{(n_months - 1) % 12 + 1:02d}")
    rng = np.random.default_rng(1)
    v = values if values is not None else 10 + 5 * np.sin(2 * np.pi * np.arange(len(times)) / 12) + 0.003 * np.arange(len(times)) + rng.normal(size=len(times))
    v = np.asarray(v, dtype=float)
    reasons = [None] * len(times)
    for g in gaps:
        v[g] = np.nan
        reasons[g] = "fill_value"
    return MonthlySeries(times, v, reasons, {"center_lat": 46.5, "center_lon": 32.5, "lat_res": 0.5, "lon_res": 0.625},
                         {"source_service": "test", "product": "TEST", "version": "1", "doi": "10.0/test",
                          "retrieved_at": "2026-11-14T00:00:00Z", "from_cache": False})


@pytest.fixture
def client_with_series(tmp_settings, monkeypatch):
    def make(result):
        async def fake_get(settings, store, variable_id, lat, lon):
            if isinstance(result, Exception):
                raise result
            return result
        monkeypatch.setattr(analysis, "get_point_series", fake_get)
        return TestClient(create_app(tmp_settings()))
    return make


POINT = {"variable_id": "t2m", "location": {"type": "point", "lat": 46.6, "lon": 32.6}}


def test_point_analysis_full_response(client_with_series):
    with client_with_series(fake_series(gaps=(10, 11))) as client:
        r = client.post("/api/v1/analyses", json=POINT)
        assert r.status_code == 200
        body = r.json()
        again = client.get(f"/api/v1/analyses/{body['analysis_id']}")
    assert again.status_code == 200 and again.json() == body
    assert body["status"] == "ok"
    assert body["location_resolved"]["requested"] == {"lat": 46.6, "lon": 32.6}
    assert body["location_resolved"]["grid_cell"]["center_lat"] == 46.5
    assert body["provenance"]["processing_version"] == "stats-1"
    assert body["requested_period"] is None
    assert body["analysis_period"] == body["observations_period"]
    s = body["series"]
    assert s["status"] == "ok" and s["unit"] == "°C" and s["coverage"]["valid"] == 298
    gap = s["points"][10]
    assert gap["v"] is None and gap["anomaly"] is None and gap["missing_reason"] == "fill_value"
    an = body["trend"]["monthly_anomalies"]
    assert an["sen_slope"]["status"] == "ok" and an["sen_slope"]["unit"] == "°C per decade"
    assert an["mann_kendall"]["p_value"] is not None
    assert body["trend"]["raw"]["ols_t_test"]["status"] == "not_applicable"
    assert body["breaks"] == {"status": "not_implemented", "reason": "available_from_step_2"}


def test_requested_period_trims_and_warns(client_with_series):
    payload = {**POINT, "period": {"start": "1980-01", "end": "2000-12"}}
    with client_with_series(fake_series()) as client:
        body = client.post("/api/v1/analyses", json=payload).json()
    assert body["analysis_period"] == {"start": "1990-01", "end": "2000-12"}
    assert body["requested_period"] == {"start": "1980-01", "end": "2000-12"}
    assert any(w["code"] == "partial_period" for w in body["warnings"])
    assert body["series"]["points"][0]["t"] == "1990-01" and body["series"]["points"][-1]["t"] == "2000-12"


def test_period_outside_product_is_no_data(client_with_series):
    payload = {**POINT, "period": {"start": "1950-01", "end": "1960-12"}}
    with client_with_series(fake_series()) as client:
        body = client.post("/api/v1/analyses", json=payload).json()
    assert body["series"]["status"] == "no_data" and body["series"]["reason"] == "period_outside_product"
    assert body["trend"] == {"status": "not_applicable", "reason": "no_series_data"}


def test_land_variable_over_sea_is_outside_coverage(client_with_series):
    sea = fake_series(values=np.full(300, np.nan))
    with client_with_series(sea) as client:
        body = client.post("/api/v1/analyses", json={**POINT, "variable_id": "soil_moisture"}).json()
    assert body["series"]["status"] == "no_data" and body["series"]["reason"] == "outside_product_coverage"
    assert body["series"]["points"] == []


def test_short_series_is_insufficient_for_test(client_with_series):
    with client_with_series(fake_series(n_months=60)) as client:
        body = client.post("/api/v1/analyses", json=POINT).json()
    assert body["series"]["status"] == "ok"
    an = body["trend"]["monthly_anomalies"]
    assert an["mann_kendall"]["status"] == "insufficient_for_test" and an["mann_kendall"]["reason"] == "too_short"


def test_old_series_gets_series_ended_warning(client_with_series):
    with client_with_series(fake_series(start="1990-01", n_months=300)) as client:  # ends 2014-12
        body = client.post("/api/v1/analyses", json=POINT).json()
    assert {"code": "series_ended", "last_available": "2014-12"} in body["warnings"]


@pytest.mark.parametrize("kind,code", [("timeout", 504), ("unavailable", 502), ("rejected", 502), ("rate_limited", 503)])
def test_source_errors_are_explicit(client_with_series, kind, code):
    with client_with_series(SourceError("giovanni", kind)) as client:
        r = client.post("/api/v1/analyses", json=POINT)
    assert r.status_code == code
    body = r.json()
    assert body["status"] == "source_error" and body["error"]["kind"] == kind
    assert "series" not in body
