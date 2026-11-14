"""Full mode 2 (investigation-2). Synthetic cubes and EONET answers exist only in these tests; the known-events list is the real curated file."""

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


def write_cube(data_dir, variable_id, values, start_year=1990, lats=None, lons=None):
    """values: array (3, 3, n) in SOURCE units."""
    folder = data_dir / "cube" / "europe" / variable_id
    folder.mkdir(parents=True)
    np.save(folder / "data.npy", values.astype("float32"))
    meta = {"product": {"short_name": "TEST", "version": "1"}, "lat": lats or LATS, "lon": lons or LONS,
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


def run_investigation(settings, monkeypatch, events, variable="t2m", lat=46.5, lon=33.125):
    monkeypatch.setattr(investigation, "eonet_search", fake_eonet(events))
    with TestClient(create_app(settings)) as client:
        a = client.post("/api/v1/analyses", json={"variable_id": variable,
                                                  "location": {"type": "point", "lat": lat, "lon": lon}}).json()
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


# ---------------------------------------------------------------------------------------------
# Curated known events (team decision 23:45)
# ---------------------------------------------------------------------------------------------
KAKHOVKA_LATS = [46.75, 47.0, 47.25]
KAKHOVKA_LONS = [33.75, 34.0, 34.25]


def test_known_human_event_gives_human_influence(tmp_settings, monkeypatch):
    settings = tmp_settings()
    # soil moisture from 2000-01; synthetic step in 2023-06 inside the Kakhovka box
    write_cube(settings.data_dir, "soil_moisture", step_cube(n=320, at=282, where="all", base=30.0),
               start_year=2000, lats=KAKHOVKA_LATS, lons=KAKHOVKA_LONS)
    a, res = run_investigation(settings, monkeypatch, events=[], variable="soil_moisture", lat=47.0, lon=34.0)
    assert "2023-06" <= a["breaks"]["change_point"]["date"] <= "2023-09"  # inside the event window
    c = res["conclusion"]
    assert c["category"] == "consistent_with_human_influence" and c["rule"] == "R3"
    assert c["known_events"][0]["event_id"] == "kakhovka_dam_breach_2023"
    assert c["known_events"][0]["sources"][0]["url"].startswith("https://")
    assert c["evidence_for"][0]["code"] == "documented_context"
    assert "Breach of the Kakhovka dam" in c["statement"] and c["never_proof"] is True
    assert c["coinciding_explanations"] == []
    assert res["known_events_checked"]["events_in_list"] == 10


def test_known_natural_event_gives_natural_event(tmp_settings, monkeypatch):
    settings = tmp_settings()
    # soil moisture (GLDAS, no documented boundary near 2010) from 2000-01; synthetic step in 2010-07
    # inside the 2010 Russian heat wave box. (For t2m, the MERRA-2 stream start 2011-01 would also apply.)
    write_cube(settings.data_dir, "soil_moisture", step_cube(n=300, at=126, where="all", base=30.0), start_year=2000,
               lats=[54.75, 55.0, 55.25], lons=[39.75, 40.0, 40.25])
    a, res = run_investigation(settings, monkeypatch, events=[], variable="soil_moisture", lat=55.0, lon=40.0)
    assert "2010-06" <= a["breaks"]["change_point"]["date"] <= "2010-11"  # inside the event window
    c = res["conclusion"]
    assert c["category"] == "consistent_with_natural_event" and c["rule"] == "R2"
    assert [e["event_id"] for e in c["known_events"]] == ["russian_heatwave_2010"]


def test_product_boundary_and_known_event_are_shown_side_by_side(tmp_settings, monkeypatch):
    settings = tmp_settings()
    # step in 1992-01: MERRA-2 stream 2 starts (documented boundary) AND the global Pinatubo window applies
    write_cube(settings.data_dir, "t2m", step_cube(n=300, at=144, where="all", size=-2.0), start_year=1980)
    a, res = run_investigation(settings, monkeypatch, events=[], variable="t2m")
    assert a["breaks"]["change_point"]["date"] in ("1991-12", "1992-01", "1992-02")
    c = res["conclusion"]
    assert c["category"] == "possible_data_artifact"  # agreed priority for the category field ...
    assert [x["rule"] for x in c["coinciding_explanations"]] == ["R1", "R2"]  # ... but both shown, no winner
    assert "cannot tell which one explains it" in c["statement"]
    assert all(x["rule"] not in ("R2", "R3") for x in c["alternatives"])
    assert c["known_events"][0]["event_id"] == "pinatubo_eruption_1991"


def test_event_variable_rule_must_match(tmp_settings, monkeypatch):
    settings = tmp_settings()
    # precipitation is not listed for the Kakhovka event -> no match
    write_cube(settings.data_dir, "precip", step_cube(n=300, at=281, where="all", base=0.05, size=0.05),
               start_year=2000, lats=KAKHOVKA_LATS, lons=KAKHOVKA_LONS)
    a, res = run_investigation(settings, monkeypatch, events=[], variable="precip", lat=47.0, lon=34.0)
    if a["breaks"]["change_point"]["status"] in ("detected", "inconclusive"):
        c = res["conclusion"]
        assert c["category"] == "cause_undetermined" and c["known_events"] == []
        notes = {r["rule"]: r.get("note") for r in c["rules_checked"]}
        assert notes["R2"] == notes["R3"] == "No event in the curated list of known events matches this change."


def test_known_events_list_endpoint(tmp_settings):
    with TestClient(create_app(tmp_settings())) as client:
        body = client.get("/api/v1/known-events").json()
    assert body["status"] == "ok" and len(body["events"]) == 10 and len(body["match_rules"]) == 4
    for e in body["events"]:
        assert e["type"] in ("natural", "human") and e["sources"]
        assert all(src["url"].startswith("https://") for src in e["sources"])
        assert e["match_window"]["start"] <= e["match_window"]["end"]
        assert set(e["expected_direction"]) <= set(e["variables"])


RUSSIA_LATS = [54.75, 55.0, 55.25]
RUSSIA_LONS = [39.75, 40.0, 40.25]


@pytest.mark.parametrize("size,matches", [(2.0, True), (-2.0, False)])
def test_event_direction_must_match_when_the_source_states_it(tmp_settings, monkeypatch, size, matches):
    settings = tmp_settings()
    # AIRS air temperature (no documented product boundary); step in 2010-07 inside the 2010 heat wave box.
    # The source states the air was warmer, so only a warming step matches.
    write_cube(settings.data_dir, "airs_surface_air_temp", step_cube(n=300, at=126, where="all", size=size),
               start_year=2000, lats=RUSSIA_LATS, lons=RUSSIA_LONS)
    a, res = run_investigation(settings, monkeypatch, events=[], variable="airs_surface_air_temp", lat=55.0, lon=40.0)
    assert a["breaks"]["change_point"]["date"] in ("2010-07", "2010-08")
    c = res["conclusion"]
    if matches:
        assert c["rule"] == "R2" and c["known_events"][0]["event_id"] == "russian_heatwave_2010"
        assert c["known_events"][0]["match"]["direction"] == "increase, as stated by the source"
    else:
        assert c["category"] == "cause_undetermined" and c["known_events"] == []


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
