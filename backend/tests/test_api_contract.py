"""Contract endpoints answer with explicit states and never with invented values."""

import asyncio
import json

from fastapi.testclient import TestClient

from backend.app.jobs import JobRunner
from backend.app.main import create_app
from backend.app.state import StateStore

POINT = {"variable_id": "t2m", "location": {"type": "point", "lat": 46.6, "lon": 32.6},
         "period": {"start": "1980-01", "end": "2026-09"}}


def client_for(settings) -> TestClient:
    return TestClient(create_app(settings))


def test_health_reports_state_without_token_value(tmp_settings):
    secret = "test-token-value-that-must-not-leak"
    with client_for(tmp_settings(token=secret)) as client:
        r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["config"]["earthdata_token_configured"] is True
    assert body["config"]["state_db"] == "ok"
    assert body["europe_cube"]["status"] == "not_started"
    assert body["sources"]["status"] == "not_checked"
    assert "uptime_s" in body["instance"] and "started_at" in body["instance"]
    assert secret not in r.text


def test_health_without_token(tmp_settings):
    with client_for(tmp_settings(token=None)) as client:
        body = client.get("/api/v1/health").json()
    assert body["config"]["earthdata_token_configured"] is False


def test_variables_catalog_has_explicit_capabilities(tmp_settings):
    with client_for(tmp_settings()) as client:
        r = client.get("/api/v1/variables")
    assert r.status_code == 200
    variables = r.json()["variables"]
    assert [v["variable_id"] for v in variables] == [
        "t2m", "precip", "soil_moisture", "evapotranspiration", "surface_runoff", "airs_surface_air_temp", "no2_tropo",
        "ndvi", "lst_day"]
    slow = {v["variable_id"]: v for v in variables[7:]}
    assert all(v["capabilities"] == {"point": "job", "area": "not_available", "map_europe": "not_available"} for v in slow.values())
    for v in variables[:7]:
        assert isinstance(v["definition"], str) and len(v["definition"]) > 40
        assert v["limitations"] and all(isinstance(x, str) for x in v["limitations"])
        assert set(v["summary"]) == {"definition", "limitation"}
        assert v["boundary_review"]["references"]
        for b in v["product_boundaries"]:
            assert b["reference"]["url"].startswith("https://") and len(b["date"]) == 7
        assert v["capabilities"] == {"point": "live", "area": "live_in_europe_job_elsewhere", "map_europe": "precomputed"}
        assert v["source"]["doi"]
        assert not any(k.startswith("_") for k in v)


def test_point_analysis_without_token_is_an_explicit_source_error(tmp_settings):
    # no cube, no token: the source cannot be reached -> explicit source_error, no values
    with client_for(tmp_settings(token=None)) as client:
        r = client.post("/api/v1/analyses", json=POINT)
    assert r.status_code == 502
    body = r.json()
    assert body["status"] == "source_error"
    assert body["error"]["source"] == "giovanni" and body["error"]["kind"] == "rejected"
    assert body["request"]["location"] == POINT["location"]
    assert "series" not in body and "trend" not in body


def test_invalid_analysis_requests_return_400(tmp_settings):
    bad = [
        {**POINT, "variable_id": "unknown"},
        {**POINT, "location": {"type": "point", "lat": 95, "lon": 0}},
        {**POINT, "location": {"type": "area", "bbox": [36, 46, 32, 48]}},
        {**POINT, "period": {"start": "2020-05", "end": "2019-01"}},
        {**POINT, "period": {"start": "2020-13", "end": "2021-01"}},
        {**POINT, "unexpected": True},
    ]
    with client_for(tmp_settings()) as client:
        for payload in bad:
            r = client.post("/api/v1/analyses", json=payload)
            assert r.status_code == 400, payload
            assert r.json()["status"] == "invalid_request"
            assert r.json()["errors"]


def test_area_outside_europe_becomes_a_job_with_explicit_failure_without_token(tmp_settings):
    import time
    payload = {**POINT, "location": {"type": "area", "bbox": [100.0, 10.0, 104.0, 12.0]}}
    with client_for(tmp_settings(token=None)) as client:
        r = client.post("/api/v1/analyses", json=payload)
        assert r.status_code == 202
        job = r.json()
        assert job["kind"] == "area_series" and job["status"] in ("queued", "running", "failed")
        assert job["estimate_s"] == {"value": 180, "kind": "estimate"}
        assert job["request"]["location"]["bbox"] == [100.0, 10.0, 104.0, 12.0]
        for _ in range(100):
            job = client.get(f"/api/v1/jobs/{job['job_id']}").json()
            if job["status"] == "failed":
                break
            time.sleep(0.05)
    assert job["status"] == "failed"
    assert job["error"]["code"] == "source_error" and job["error"]["kind"] == "rejected"
    assert job["result"] is None


def test_unknown_resources_are_explicit_not_found(tmp_settings):
    with client_for(tmp_settings()) as client:
        for path in ("/api/v1/analyses/a_x", "/api/v1/jobs/j_x", "/api/v1/investigations/i_x",
                     "/api/v1/maps/europe/unknown", "/api/v1/nope"):
            r = client.get(path)
            assert r.status_code == 404, path
            assert r.json()["status"] == "not_found"


def test_investigation_of_unknown_analysis_is_not_found(tmp_settings):
    with client_for(tmp_settings()) as client:
        r = client.post("/api/v1/investigations", json={"analysis_id": "a_1", "change_id": "c_1"})
    assert r.status_code == 404
    assert r.json()["status"] == "not_found" and r.json()["reason"] == "unknown_analysis"


def test_maps_are_not_ready_until_precomputed(tmp_settings):
    with client_for(tmp_settings()) as client:
        index = client.get("/api/v1/maps/europe").json()
        single = client.get("/api/v1/maps/europe/t2m").json()
    assert {m["status"] for m in index["maps"]} == {"not_ready"}
    assert single == {"status": "not_ready", "variable_id": "t2m", "reason": "not_computed"}


def test_root_shows_placeholder_without_frontend(tmp_settings):
    with client_for(tmp_settings()) as client:
        r = client.get("/")
    assert r.status_code == 200
    assert "frontend has not been built" in r.text


def test_frontend_is_served_with_spa_fallback(tmp_settings, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "app.js").write_text("console.log(1)", encoding="utf-8")
    with client_for(tmp_settings(frontend_dist=dist)) as client:
        assert client.get("/").text == "<html>app</html>"
        assert client.get("/app.js").text == "console.log(1)"
        assert client.get("/some/route").text == "<html>app</html>"
        assert client.get("/../secret").status_code in (200, 404)  # never escapes dist
        assert client.get("/api/unknown").json()["status"] == "not_found"
        for missing in ("/missing.js", "/assets/style.css", "/data/europe.json"):
            r = client.get(missing)
            assert r.status_code == 404, missing
            assert "<html>" not in r.text


def test_job_runner_persists_and_completes(tmp_path):
    store = StateStore(tmp_path / "jobs.sqlite")

    async def scenario():
        runner = JobRunner(store, concurrency=1)

        async def handler(job, ctx):
            ctx.progress(1, 1, "steps")
            return {"type": "analysis", "id": "a_test"}

        runner.register("demo", handler)
        await runner.start()
        job = runner.submit("demo", {"x": 1})
        unknown = runner.submit("no_such_kind", {})
        for _ in range(100):
            if store.get_job(job["job_id"])["status"] == "complete" and store.get_job(unknown["job_id"])["status"] == "failed":
                break
            await asyncio.sleep(0.01)
        await runner.stop()
        return job["job_id"], unknown["job_id"]

    job_id, unknown_id = asyncio.run(scenario())
    done = store.get_job(job_id)
    assert done["status"] == "complete"
    assert done["result"] == {"type": "analysis", "id": "a_test"}
    assert done["progress"] == {"known": True, "done": 1, "total": 1, "unit": "steps"}
    failed = store.get_job(unknown_id)
    assert failed["status"] == "failed" and failed["error"]["code"] == "unsupported_job_kind"


def test_interrupted_jobs_are_requeued(tmp_path):
    store = StateStore(tmp_path / "jobs.sqlite")
    job = store.create_job("demo", {})
    store.update_job(job["job_id"], status="running", stage="downloading")
    assert job["job_id"] in store.requeue_interrupted()
    assert store.get_job(job["job_id"])["status"] == "queued"


def test_log_redaction():
    import logging

    from backend.app.logging_setup import RedactSecretsFilter

    record = logging.LogRecord("x", logging.INFO, __file__, 1, "token=%s", ("abc123secret",), None)
    RedactSecretsFilter(("abc123secret",)).filter(record)
    assert "abc123secret" not in record.getMessage()
    assert json.dumps(record.getMessage())


def test_prepared_map_copy_is_served_when_runtime_map_is_missing(tmp_settings):
    import gzip
    settings = tmp_settings()
    folder = settings.prepared_dir / "maps" / "europe"
    folder.mkdir(parents=True)
    payload = {"status": "ok", "format_version": "map-1.2", "variable_id": "t2m", "period": {"start": "1980-01", "end": "2026-09"},
               "computed_at": "2026-11-14T15:46:40Z", "cells": {"slope": [0.1], "status": [0]}}
    with gzip.open(folder / "t2m.json.gz", "wt", encoding="utf-8") as f:
        json.dump(payload, f)
    with client_for(settings) as client:
        body = client.get("/api/v1/maps/europe/t2m").json()
        index = client.get("/api/v1/maps/europe").json()
    assert body["status"] == "ok" and body["provenance"]["served_from"] == "prepared_copy_in_image"
    assert {m["variable_id"]: m["status"] for m in index["maps"]}["t2m"] == "ok"
    assert {m["variable_id"]: m["status"] for m in index["maps"]}["precip"] == "not_ready"
