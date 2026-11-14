"""Step 0: every contract endpoint answers with an explicit state and no invented values."""

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
        "t2m", "precip", "soil_moisture", "evapotranspiration", "surface_runoff", "airs_surface_air_temp", "no2_tropo"]
    for v in variables:
        assert v["definition"] is None
        assert v["product_boundaries"] == []
        assert set(v["capabilities"].values()) == {"not_implemented"}
        assert v["source"]["doi"]
        assert not any(k.startswith("_") for k in v)


def test_valid_analysis_request_is_not_implemented_and_echoed(tmp_settings):
    with client_for(tmp_settings()) as client:
        r = client.post("/api/v1/analyses", json=POINT)
    assert r.status_code == 501
    body = r.json()
    assert body["status"] == "not_implemented"
    assert body["request"]["variable_id"] == "t2m"
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


def test_area_request_is_accepted_as_valid(tmp_settings):
    payload = {**POINT, "location": {"type": "area", "bbox": [32.0, 46.0, 36.0, 48.0]}}
    with client_for(tmp_settings()) as client:
        r = client.post("/api/v1/analyses", json=payload)
    assert r.status_code == 501
    assert r.json()["request"]["location"]["bbox"] == [32.0, 46.0, 36.0, 48.0]


def test_unknown_resources_are_explicit_not_found(tmp_settings):
    with client_for(tmp_settings()) as client:
        for path in ("/api/v1/analyses/a_x", "/api/v1/jobs/j_x", "/api/v1/investigations/i_x",
                     "/api/v1/maps/europe/unknown", "/api/v1/nope"):
            r = client.get(path)
            assert r.status_code == 404, path
            assert r.json()["status"] == "not_found"


def test_investigation_is_not_implemented(tmp_settings):
    with client_for(tmp_settings()) as client:
        r = client.post("/api/v1/investigations", json={"analysis_id": "a_1", "change_id": "c_1"})
    assert r.status_code == 501
    assert r.json()["status"] == "not_implemented"


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
