"""In-process background jobs (architecture A).

Job state is persisted in SQLite, so a restart puts unfinished jobs back in the queue
instead of losing them silently. Handlers are registered per job kind in later steps
(area series via Harmony, MODIS, investigations). An unknown kind fails explicitly.

Note for Cloud Run: background work between requests needs instance-based billing
(``--no-cpu-throttling``); see deploy/README.md.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from .state import StateStore

log = logging.getLogger(__name__)

JobHandler = Callable[[dict[str, Any], "JobContext"], Awaitable[dict[str, Any]]]


class JobContext:
    """Passed to handlers so they can report real progress and stage."""

    def __init__(self, store: StateStore, job_id: str) -> None:
        self._store = store
        self.job_id = job_id

    def stage(self, stage: str) -> None:
        self._store.update_job(self.job_id, stage=stage)

    def progress(self, done: int, total: int, unit: str) -> None:
        self._store.update_job(self.job_id, progress={"known": True, "done": done, "total": total, "unit": unit})


class JobRunner:
    def __init__(self, store: StateStore, concurrency: int = 2) -> None:
        self.store = store
        self.concurrency = concurrency
        self.handlers: dict[str, JobHandler] = {}
        self._queue: asyncio.Queue[str] | None = None
        self._workers: list[asyncio.Task[None]] = []

    def register(self, kind: str, handler: JobHandler) -> None:
        self.handlers[kind] = handler

    async def start(self) -> None:
        self._queue = asyncio.Queue()
        for job_id in self.store.requeue_interrupted():
            self._queue.put_nowait(job_id)
        self._workers = [asyncio.create_task(self._worker(i)) for i in range(self.concurrency)]

    async def stop(self) -> None:
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers = []

    def submit(self, kind: str, request: dict[str, Any]) -> dict[str, Any]:
        job = self.store.create_job(kind, request)
        if self._queue is not None:
            self._queue.put_nowait(job["job_id"])
        return job

    async def _worker(self, index: int) -> None:
        assert self._queue is not None
        while True:
            job_id = await self._queue.get()
            try:
                await self._run(job_id)
            finally:
                self._queue.task_done()

    async def _run(self, job_id: str) -> None:
        job = self.store.get_job(job_id)
        if job is None or job["status"] not in ("queued", "running"):
            return
        handler = self.handlers.get(job["kind"])
        if handler is None:
            self.store.update_job(job_id, status="failed", stage="queued", error={
                "code": "unsupported_job_kind", "message_public": "This kind of request is not available yet.",
                "retryable": False})
            return
        self.store.update_job(job_id, status="running", stage="waiting_for_source")
        try:
            result = await handler(job, JobContext(self.store, job_id))
        except asyncio.CancelledError:
            raise  # process is stopping; the job is requeued on next start
        except Exception:  # never leak internal or upstream messages to clients
            log.exception("job %s (%s) failed", job_id, job["kind"])
            self.store.update_job(job_id, status="failed", error={
                "code": "internal_error", "message_public": "The request could not be completed.",
                "retryable": True})
            return
        self.store.update_job(job_id, status="complete", result=result)
