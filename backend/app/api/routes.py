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
from ..analysis import point_analysis
from .models import AnalysisRequest, InvestigationRequest

API_VERSION = "v1"
SERVICE_VERSION = "0.3.0"
STEP = 2

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
    if body.location.type == "area":
        return JSONResponse(status_code=501, content={
            "status": "not_implemented",
            "reason": "area_available_from_step_3",
            "request": body.model_dump(mode="json"),
        })
    status_code, content = await point_analysis(request.app.state.settings, request.app.state.store, body)
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
    job["next_poll_s"] = 10 if job["status"] in ("queued", "running") else None
    return JSONResponse(content=job)


@router.post("/investigations")
async def create_investigation(body: InvestigationRequest) -> JSONResponse:
    return JSONResponse(status_code=501, content={
        "status": "not_implemented",
        "reason": "investigations_available_from_step_4",
        "request": body.model_dump(mode="json"),
    })


@router.get("/investigations/{investigation_id}")
async def get_investigation(investigation_id: str) -> JSONResponse:
    return _not_found("unknown_investigation")


@router.get("/maps/europe")
async def maps_index(request: Request) -> dict[str, Any]:
    data_dir = request.app.state.settings.data_dir
    maps = []
    for vid in catalog.VARIABLE_IDS:
        prepared = storage.read_json(storage.map_path(data_dir, vid))
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
    prepared = storage.read_json(storage.map_path(request.app.state.settings.data_dir, variable_id))
    if prepared and prepared.get("status") == "ok":
        return JSONResponse(content=prepared)
    return JSONResponse(content={"status": "not_ready", "variable_id": variable_id, "reason": "not_computed"})
