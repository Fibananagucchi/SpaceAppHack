"""FastAPI application: API under /api/v1, built frontend under /.

Run locally from the repository root:
    python -m uvicorn backend.app.main:app --reload
On Cloud Run the container command binds to $PORT (see Dockerfile).
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .analysis import AREA_JOB_KIND, MODIS_JOB_KIND, area_job_handler, modis_job_handler
from .investigation import investigate
from .jobs import JobFailed
from .api.routes import SERVICE_VERSION, router
from . import storage
from .config import Settings, get_settings
from .http_client import close_shared_client
from .jobs import JobRunner
from .logging_setup import setup_logging
from .state import StateStore

PLACEHOLDER_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trend Detective — backend</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem;">
<h1>Backend is running</h1>
<p>The frontend has not been built into this image yet. No data is shown on this page.</p>
<p>API health: <a href="/api/v1/health">/api/v1/health</a> · API schema: <a href="/api/docs">/api/docs</a></p>
</body></html>"""


def _validation_error_response(exc: RequestValidationError) -> JSONResponse:
    errors = []
    for err in exc.errors():
        location = [str(p) for p in err.get("loc", ()) if p != "body"]
        errors.append({"field": ".".join(location) or None, "message": err.get("msg", "invalid value")})
    return JSONResponse(status_code=400, content={"status": "invalid_request", "errors": errors})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings.log_level, settings.secrets)
    store = StateStore(settings.state_db)
    runner = JobRunner(store)

    async def _area_handler(job, ctx):
        return await area_job_handler(job, ctx, settings, store)

    runner.register(AREA_JOB_KIND, _area_handler)

    async def _investigation_handler(job, ctx):
        analysis = store.get_analysis(job["request"]["analysis_id"])
        if analysis is None:
            raise JobFailed({"code": "not_found", "message_public": "The analysis is no longer available. Run it again.",
                             "retryable": False})
        result = await investigate(settings, store, analysis, job["request"]["change_id"], on_stage=ctx.stage)
        iid = result["investigation_id"]
        return {"type": "investigation", "id": iid, "url": f"/api/v1/investigations/{iid}"}

    runner.register("investigation", _investigation_handler)

    async def _modis_handler(job, ctx):
        return await modis_job_handler(job, ctx, settings, store)

    runner.register(MODIS_JOB_KIND, _modis_handler)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.started_at = datetime.now(timezone.utc)
        await runner.start()
        # Read and compress every prepared layer once, in a worker thread, so the first /globe request
        # does not parse dozens of files and the event loop keeps serving other requests meanwhile.
        warm = asyncio.create_task(asyncio.to_thread(storage.warm_cache, settings.data_dir, settings.prepared_dir))
        try:
            yield
        finally:
            warm.cancel()
            await runner.stop()
            await close_shared_client()

    app = FastAPI(
        title="Earth System Trend Detective API",
        version=SERVICE_VERSION,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.store = store
    app.state.runner = runner
    app.state.started_at = datetime.now(timezone.utc)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.include_router(router)

    @app.exception_handler(RequestValidationError)
    async def _on_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _validation_error_response(exc)

    @app.exception_handler(StarletteHTTPException)
    async def _on_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        status = "not_found" if exc.status_code == 404 else "error"
        return JSONResponse(status_code=exc.status_code, content={"status": status})

    _mount_frontend(app, settings.frontend_dist)
    return app


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    dist = Path(dist).resolve()
    index = dist / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"status": "not_found", "reason": "unknown_endpoint"})
        if not index.is_file():
            return HTMLResponse(PLACEHOLDER_HTML)
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(dist):
            return FileResponse(candidate)
        # A missing asset (anything with a file extension, e.g. .js/.css/.json) is a real 404.
        # Only interface routes fall back to index.html, so a wrong path never looks like data.
        last_segment = full_path.rsplit("/", 1)[-1]
        if "." in last_segment:
            return JSONResponse(status_code=404, content={"status": "not_found", "reason": "unknown_file"})
        return FileResponse(index)  # single-page app fallback


app = create_app()
