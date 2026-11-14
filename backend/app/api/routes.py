"""Contract v1.1 endpoints — step 2 (mode 1 minimum + basic mode 2 for points).

Every endpoint answers with real data or an explicit state. Point analyses use real
series (Europe cube or Giovanni); areas answer ``not_implemented`` until step 3,
investigations until step 4; maps answer ``not_ready`` until precomputed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .. import catalog, sources, storage
from ..analysis import area_analysis, job_body, point_analysis
from ..investigation import precheck
from ..known_events import public_list
from .models import AnalysisRequest, InvestigationRequest

API_VERSION = "v1"
SERVICE_VERSION = "0.5.0"
STEP = 4

router = APIRouter(prefix="/api/v1")


def _not_found(reason: str) -> JSONResponse:
    return JSONResponse(status_code=404, content={"status": "not_found", "reason": reason})


@router.get("/health")
async def health(request: Request, deep: bool = False) -> dict[str, Any]:
    app = request.app
    settings = app.state.settings
    started_at: datetime = app.state.started_at
    uptime_s = int((datetime.now(timezone.utc) - started_at).total_seconds())
    body: dict[str, Any] = {
        "status": "ok",
        "service": "trend-detective-api",
        "version": SERVICE_VERSION,
        "api_version": API_VERSION,
        "step": STEP,
        "instance": {
            "started_at": started_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "uptime_s": uptime_s,
            "just_started": uptime_s < 60,
            "environment": settings.environment,
        },
        "config": {
            "earthdata_token_configured": settings.token_configured,  # boolean only, never the value
            "data_dir_writable": storage.data_dir_writable(settings.data_dir),
            "state_db": app.state.store.health(),
        },
        "europe_cube": storage.cube_status(settings.data_dir),
    }
    if deep:
        body["sources"] = await sources.deep_check(settings)
    else:
        body["sources"] = {"status": "not_checked", "hint": "add ?deep=true for live checks (cached 60 s)"}
    return body


@router.get("/variables")
async def variables() -> dict[str, Any]:
    return {"status": "ok", "variables": catalog.list_public_variables()}


@router.post("/analyses")
async def create_analysis(body: AnalysisRequest, request: Request) -> JSONResponse:
    state = request.app.state
    if body.location.type == "area":
        status_code, content = await area_analysis(state.settings, state.store, state.runner, body)
    else:
        status_code, content = await point_analysis(state.settings, state.store, body, state.runner)
    return JSONResponse(status_code=status_code, content=content)


@router.get("/analyses/{analysis_id}")
async def get_analysis(analysis_id: str, request: Request) -> JSONResponse:
    stored = request.app.state.store.get_analysis(analysis_id)
    if stored is None:
        return _not_found("unknown_analysis")
    return JSONResponse(content=stored)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, request: Request) -> JSONResponse:
    job = request.app.state.store.get_job(job_id)
    if job is None:
        return _not_found("unknown_job")
    return JSONResponse(content=job_body(job))


@router.post("/investigations")
async def create_investigation(body: InvestigationRequest, request: Request) -> JSONResponse:
    state = request.app.state
    analysis = state.store.get_analysis(body.analysis_id)
    problem = precheck(analysis, body.change_id)
    if problem is not None:
        status_code, content = problem
        content["request"] = body.model_dump(mode="json")
        return JSONResponse(status_code=status_code, content=content)
    job_request = body.model_dump(mode="json")
    job = state.store.find_active_job("investigation", job_request) or state.runner.submit("investigation", job_request)
    return JSONResponse(status_code=202, content=job_body(job))


@router.get("/investigations/{investigation_id}")
async def get_investigation(investigation_id: str, request: Request) -> JSONResponse:
    stored = request.app.state.store.get_investigation(investigation_id)
    if stored is None:
        return _not_found("unknown_investigation")
    return JSONResponse(content=stored)


@router.get("/known-events")
async def known_events_list() -> dict[str, Any]:
    """The curated list of known events used for R2 / R3, with sources and matching rules (for review)."""
    return public_list()


@router.get("/maps/europe")
async def maps_index(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    maps = []
    for vid in catalog.CORE_VARIABLE_IDS:
        prepared = storage.read_map(settings.data_dir, settings.prepared_dir, vid)
        if prepared and prepared.get("status") == "ok":
            maps.append({"variable_id": vid, "status": "ok", "period": prepared.get("period"),
                         "computed_at": prepared.get("computed_at")})
        else:
            maps.append({"variable_id": vid, "status": "not_ready", "reason": "not_computed"})
    return {"status": "ok", "domain": {"name": "Europe", "bbox": list(storage.EUROPE_BBOX)}, "maps": maps}


@router.get("/maps/europe/{variable_id}")
async def map_europe(variable_id: str, request: Request) -> JSONResponse:
    if catalog.get_variable(variable_id) is None:
        return _not_found("unknown_variable")
    settings = request.app.state.settings
    prepared = storage.read_map(settings.data_dir, settings.prepared_dir, variable_id)
    if prepared and prepared.get("status") == "ok":
        return JSONResponse(content=prepared)
    return JSONResponse(content={"status": "not_ready", "variable_id": variable_id, "reason": "not_computed"})
