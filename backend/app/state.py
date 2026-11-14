"""SQLite state: background jobs, hot cache of real source responses, stored analyses.

On Cloud Run this database lives on the instance's temporary filesystem, so it is a
*hot* cache only. Durable prepared data (Europe cube, maps) lives under DATA_DIR.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    job_id        TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    status        TEXT NOT NULL,          -- queued | running | complete | failed
    stage         TEXT NOT NULL,
    request_json  TEXT NOT NULL,
    result_json   TEXT,
    error_json    TEXT,
    progress_json TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS series_cache (
    cache_key     TEXT PRIMARY KEY,
    payload_json  TEXT NOT NULL,          -- a real response from a source, never generated
    source        TEXT NOT NULL,
    product       TEXT NOT NULL,
    retrieved_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyses (
    analysis_id   TEXT PRIMARY KEY,
    request_json  TEXT NOT NULL,
    result_json   TEXT NOT NULL,
    created_at    TEXT NOT NULL
);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


class StateStore:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def health(self) -> str:
        try:
            with self._connect() as conn:
                conn.execute("SELECT 1").fetchone()
            return "ok"
        except sqlite3.Error:
            return "error"

    # ---- jobs -------------------------------------------------------------------------
    def create_job(self, kind: str, request: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        job = {
            "job_id": new_id("j"),
            "kind": kind,
            "status": "queued",
            "stage": "queued",
            "request": request,
            "result": None,
            "error": None,
            "progress": {"known": False},
            "created_at": now,
            "updated_at": now,
        }
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)",
                (job["job_id"], kind, "queued", "queued", json.dumps(request), None, None,
                 json.dumps(job["progress"]), now, now),
            )
        return job

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        return self._job_from_row(row) if row else None

    def update_job(self, job_id: str, **fields: Any) -> None:
        columns = {"status": "status", "stage": "stage", "result": "result_json",
                   "error": "error_json", "progress": "progress_json"}
        sets, values = [], []
        for key, value in fields.items():
            column = columns[key]
            sets.append(f"{column} = ?")
            values.append(json.dumps(value) if column.endswith("_json") else value)
        sets.append("updated_at = ?")
        values.append(utc_now())
        values.append(job_id)
        with self._connect() as conn:
            conn.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE job_id = ?", values)

    def requeue_interrupted(self) -> list[str]:
        """Jobs that were running when the process stopped go back to the queue."""
        with self._connect() as conn:
            rows = conn.execute("SELECT job_id FROM jobs WHERE status IN ('queued', 'running')").fetchall()
            conn.execute("UPDATE jobs SET status = 'queued', stage = 'queued', updated_at = ? "
                         "WHERE status = 'running'", (utc_now(),))
        return [r["job_id"] for r in rows]

    # ---- series cache (real source responses only) ------------------------------------
    def get_cached_series(self, cache_key: str, max_age_s: float) -> tuple[dict[str, Any], str] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT payload_json, retrieved_at FROM series_cache WHERE cache_key = ?",
                               (cache_key,)).fetchone()
        if not row:
            return None
        retrieved = datetime.strptime(row["retrieved_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - retrieved).total_seconds() > max_age_s:
            return None
        return json.loads(row["payload_json"]), row["retrieved_at"]

    def put_cached_series(self, cache_key: str, payload: dict[str, Any], *, source: str, product: str,
                          retrieved_at: str) -> None:
        with self._connect() as conn:
            conn.execute("INSERT OR REPLACE INTO series_cache VALUES (?,?,?,?,?)",
                         (cache_key, json.dumps(payload), source, product, retrieved_at))

    # ---- stored analyses ------------------------------------------------------------------
    def put_analysis(self, analysis_id: str, request: dict[str, Any], result: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute("INSERT OR REPLACE INTO analyses VALUES (?,?,?,?)",
                         (analysis_id, json.dumps(request), json.dumps(result), utc_now()))

    def get_analysis(self, analysis_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT result_json FROM analyses WHERE analysis_id = ?", (analysis_id,)).fetchone()
        return json.loads(row["result_json"]) if row else None

    def find_active_job(self, kind: str, science_request: dict[str, Any]) -> dict[str, Any] | None:
        """Queued or running job of this kind whose request (ignoring request_id) is identical."""
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM jobs WHERE kind = ? AND status IN ('queued', 'running')",
                                (kind,)).fetchall()
        for row in rows:
            job = self._job_from_row(row)
            if {k: v for k, v in job["request"].items() if k != "request_id"} == science_request:
                return job
        return None

    @staticmethod
    def _job_from_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "job_id": row["job_id"],
            "kind": row["kind"],
            "status": row["status"],
            "stage": row["stage"],
            "request": json.loads(row["request_json"]),
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "error": json.loads(row["error_json"]) if row["error_json"] else None,
            "progress": json.loads(row["progress_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
