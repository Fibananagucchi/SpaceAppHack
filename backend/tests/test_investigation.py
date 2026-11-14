"""Full mode 2 (investigation-1). Synthetic cubes and EONET answers exist only in these tests."""

import json
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app import investigation
from backend.app.main import create_app

LATS = [46.0, 46.5, 47.0]
LONS = [32.5, 33.125, 33.75]


def times_from(start_year: int, n: int) -> list[str]:
    return [f"{start_year + i // 12:04d}-{i % 12 + 1:02d}" for i in range(n)]


def write_cube(data_dir, variable_id, values, start_year=1990):
    """values: array (3, 3, n) in SOURCE units."""
    folder = data_dir / "cube" / "europe" / variable_id
    folder.mkdir(parents=True)
    np.save(folder / "data.npy", values.astype("float32"))
    meta = {"product": {"short_name": "TEST", "version": "1"}, "lat": LATS, "lon": LONS,
            "times": times_from(start_year, values.shape[2]), "months_without_granule": [],
            "months_with_failed_downloads": [], "assembled_at": "2026-11-14T00:00:00Z"}
    (folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    (folder / "status.json").write_text(json.dumps({"status": "ready"}), encoding="utf-8")


def step_cube(n=300, at=150, size=2.0, where="all", seed=0, base=280.0):
    rng = np.random.default_rng(seed)
    cube = base + rng.normal(scale=0.4, size=(3, 3, n))
    if where == "all":
        cube[:, :, at:] += size
    elif where == "center":
        cube[1, 1, at:] += size
    return cube


def fake_eonet(events):
    async def _search(analysis):
        return {"status": "ok", "search": {"bbox": [0, 0, 1, 1], "start": "x", "end": "y", "categories": "all"},
                "coverage_note": "test", "events": events, "early_record_note": None}
    return _search


def run_investigation(settings, monkeypatch, events, variable="t2m"):
    monkeypatch.setattr(investigation, "eonet_search", fake_eonet(events))
    with TestClient(create_app(settings)) as client:
        a = client.post("/api/v1/analyses", json={"variable_id": variable,
                                                  "location": {"type": "point", "lat": 46.5, "lon": 33.125}}).json()
        cp = a["breaks"]["change_point"]
        r = client.post("/api/v1/investigations", json={"analysis_id": a["analysis_id"], "change_id": cp["change_id"]})
        if r.status_code != 202:
            return a, r.json()
        job = r.json()
        for _ in range(200):
            job = client.get(f"/api/v1/jobs/{job['job_id']}").json()
            if job["status"] in ("complete", "failed"):
                break
            time.sleep(0.02)
        assert job["status"] == "complete", job
        result = client.get(job["result"]["url"]).json()
    return a, result


def test_cause_undetermined_with_regional_step_and_features(tmp_settings, monkeypatch):
    settings = tmp_settings()
    write_cube(settings.data_dir, "t2m", step_cube(where="all"))
    a, res = run_investigation(settings, monkeypatch, events=[])
    assert a["breaks"]["change_point"]["status"] == "detected"
    c = res["conclusion"]
    assert c["category"] == "cause_undetermined" and c["label"] == "Cause undetermined" and c["rule"] == "R4"
    f = res["features"]
    assert f["abruptness"]["value"] == "abrupt"
    assert f["persistence"]["value"] == "persistent"
    assert f["spatial_extent"]["value"] == "regional"
    assert f["spatial_extent"]["detail"]["neighbours_assessed"] == 8
    assert any(e["code"] == "no_independent_context" for e in c["evidence_for"])
    assert not any(e["code"].startswith("eonet") for e in c["evidence_for"] + c["evidence_against"])
    assert [r["applies"] for r in c["rules_checked"]] == [False, False, False, True]
    assert res["eonet"]["status"] == "ok" and res["eonet"]["events"] == []


def test_local_step_is_local(tmp_settings, monkeypatch):
    settings = tmp_settings()
    write_cube(settings.data_dir, "t2m", step_cube(where="center"))
    _, res = run_investigation(settings, monkeypatch, events=[])
    assert res["features"]["spatial_extent"]["value"] == "local"


def test_temporary_change_is_temporary(tmp_settings, monkeypatch):
    settings = tmp_settings()
    cube = step_cube(where="all")
    cube[:, :, 230:] -= 2.0  # back to the earlier level for the last 70 months
    write_cube(settings.data_dir, "t2m", cube)
    a, res = run_investigation(settings, monkeypatch, events=[])
    if a["breaks"]["change_point"]["status"] in ("detected", "inconclusive"):
        assert res["features"]["persistence"]["value"] == "temporary"


def test_documented_boundary_gives_possible_data_artifact(tmp_settings, monkeypatch):
    settings = tmp_settings()
    # step at 2001-01 = first month of MERRA-2 production stream 3 (documented boundary for t2m)
    write_cube(settings.data_dir, "t2m", step_cube(at=132, where="all"))
    natural = [{"id": "EONET_1", "title": "Test storm", "categories": [{"id": "severeStorms", "title": "Severe Storms"}],
                "first_date": "2000-12-20", "link": "https://eonet.example/1", "sources": []}]
    _, res = run_investigation(settings, monkeypatch, events=natural)
    c = res["conclusion"]
    assert c["category"] == "possible_data_artifact" and c["rule"] == "R1"
    assert c["evidence_for"][0]["reference"]["url"].startswith("https://")
    alt = [x["category"] for x in c["alternatives"]]
    assert alt == ["cause_undetermined"]  # the EONET storm is an observation, not an alternative cause
    assert res["eonet"]["events"][0]["title"] == "Test storm"


def test_eonet_event_alone_never_chooses_a_cause(tmp_settings, monkeypatch):
    settings = tmp_settings()
    write_cube(settings.data_dir, "t2m", step_cube(where="all"))
    events = [{"id": "EONET_2", "title": "Test wildfire", "categories": [{"id": "wildfires", "title": "Wildfires"}],
               "first_date": "2002-06-01", "link": "https://eonet.example/2", "sources": []},
              {"id": "EONET_3", "title": "Test dam collapse", "categories": [{"id": "manmade", "title": "Manmade"}],
               "first_date": "2002-06-01", "link": "https://eonet.example/3", "sources": []}]
    _, res = run_investigation(settings, monkeypatch, events=events)
    c = res["conclusion"]
    assert c["category"] == "cause_undetermined" and c["rule"] == "R4"
    assert [e["title"] for e in res["eonet"]["events"]] == ["Test wildfire", "Test dam collapse"]
    notes = {r["rule"]: r.get("note") for r in c["rules_checked"]}
    assert notes["R2"] and notes["R3"]  # explains why these rules cannot apply


@pytest.mark.parametrize("kind,category,rule", [("natural", "consistent_with_natural_event", "R2"),
                                                ("human", "consistent_with_human_influence", "R3")])
def test_documented_context_rules(tmp_settings, monkeypatch, kind, category, rule):
    """R2 / R3 machinery, exercised with a test-only documented context source."""
    settings = tmp_settings()
    write_cube(settings.data_dir, "t2m", step_cube(where="all"))
    monkeypatch.setattr(investigation, "independent_causal_context", lambda analysis: [
        {"kind": kind, "text": "Test context statement.", "reference": {"title": "Test source", "url": "https://example.org"}}])
    _, res = run_investigation(settings, monkeypatch, events=[])
    c = res["conclusion"]
    assert c["category"] == category and c["rule"] == rule
    assert c["evidence_for"][0]["reference"]["url"] == "https://example.org"
    assert c["statement"].startswith("This change is consistent with") and c["never_proof"] is True


def test_other_variables_feature(tmp_settings, monkeypatch):
    settings = tmp_settings()
    write_cube(settings.data_dir, "t2m", step_cube(where="all"))
    write_cube(settings.data_dir, "airs_surface_air_temp", step_cube(where="all", seed=5))
    _, res = run_investigation(settings, monkeypatch, events=[])
    ov = res["features"]["other_variables"]
    assert ov["status"] == "ok" and "airs_surface_air_temp" in ov["detail"]["variables_with_change"]


def test_gradual_change_is_not_investigated(tmp_settings, monkeypatch):
    settings = tmp_settings()
    rng = np.random.default_rng(2)
    cube = 280 + 0.02 * np.arange(360)[None, None, :] + rng.normal(scale=0.5, size=(3, 3, 360))
    write_cube(settings.data_dir, "t2m", cube)
    a, res = run_investigation(settings, monkeypatch, events=[])
    if a["breaks"]["change_point"]["status"] == "not_distinct_from_trend":
        assert res["status"] == "not_applicable" and res["reason"] == "no_abrupt_change"


def test_wrong_change_id_is_rejected(tmp_settings, monkeypatch):
    settings = tmp_settings()
    write_cube(settings.data_dir, "t2m", step_cube(where="all"))
    monkeypatch.setattr(investigation, "eonet_search", fake_eonet([]))
    with TestClient(create_app(settings)) as client:
        a = client.post("/api/v1/analyses", json={"variable_id": "t2m",
                                                  "location": {"type": "point", "lat": 46.5, "lon": 33.125}}).json()
        r = client.post("/api/v1/investigations", json={"analysis_id": a["analysis_id"], "change_id": "c_1900-01"})
    assert r.status_code == 400 and r.json()["status"] == "invalid_request"



# ---------------------------------------------------------------------------------------------
# MODIS as a background job with cache
# ---------------------------------------------------------------------------------------------
def test_modis_value_conversion_follows_file_attributes():
    from backend.app import series
    assert series._modis_value("ndvi", 5373) == pytest.approx(0.5373)
    assert np.isnan(series._modis_value("ndvi", -3000))          # fill value
    assert np.isnan(series._modis_value("ndvi", -2500))          # outside the valid range
    assert series._modis_value("lst_day", 15014) == pytest.approx(300.28)
    assert np.isnan(series._modis_value("lst_day", 0))
    assert series.modis_pixel(46.6, 32.6)[:2] == (867, 4252)


def test_modis_point_is_a_job_then_served_from_cache(tmp_settings, monkeypatch):
    from backend.app import analysis, series

    calls = {"n": 0}

    async def fake_fetch(settings, store, variable_id, lat, lon, progress=None):
        calls["n"] += 1
        if progress:
            progress(160, 321, "months")
        months = [f"{2000 + i // 12}-{i % 12 + 1:02d}" for i in range(2, 2 + 300)]
        rng = np.random.default_rng(1)
        vals = 0.4 + 0.2 * np.sin(np.arange(300) * 2 * np.pi / 12) + rng.normal(scale=0.03, size=300)
        store.put_cached_series(series.modis_cache_key(variable_id, lat, lon), {"rows": [[m, None] for m in months]},
                                source="lpdaac_opendap", product="MOD13C2", retrieved_at="2026-11-14T00:00:00Z")
        return series.MonthlySeries(months, vals, [None] * 300,
                                    {"center_lat": 46.575, "center_lon": 32.625, "lat_res": 0.05, "lon_res": 0.05},
                                    {"source_service": "lpdaac_opendap", "product": "MOD13C2", "version": "061",
                                     "doi": "10.5067/MODIS/MOD13C2.061", "retrieved_at": "2026-11-14T00:00:00Z",
                                     "from_cache": False})

    monkeypatch.setattr(analysis, "fetch_modis_point", fake_fetch)
    body = {"variable_id": "ndvi", "location": {"type": "point", "lat": 46.6, "lon": 32.6}}
    with TestClient(create_app(tmp_settings())) as client:
        r = client.post("/api/v1/analyses", json=body)
        assert r.status_code == 202
        job = r.json()
        assert job["kind"] == "modis_point" and job["estimate_s"]["value"] == 150
        for _ in range(200):
            job = client.get(f"/api/v1/jobs/{job['job_id']}").json()
            if job["status"] in ("complete", "failed"):
                break
            time.sleep(0.02)
        assert job["status"] == "complete" and job["progress"] == {"known": True, "done": 160, "total": 321, "unit": "months"}
        result = client.get(job["result"]["url"]).json()
        assert result["series"]["status"] == "ok" and result["provenance"]["source_service"] == "lpdaac_opendap"
        # cached now -> synchronous 200
        again = client.post("/api/v1/analyses", json=body)
        assert again.status_code == 200
        area = client.post("/api/v1/analyses", json={"variable_id": "ndvi",
                                                     "location": {"type": "area", "bbox": [30, 45, 31, 46]}})
        assert area.status_code == 501 and area.json()["reason"] == "area_not_available_for_this_variable"
