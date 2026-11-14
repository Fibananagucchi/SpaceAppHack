"""Runtime configuration, read from environment variables only.

EARTHDATA_TOKEN comes from the environment: a local ``.env`` file in development,
Google Secret Manager on Cloud Run. It is never logged and never returned by the API.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> None:
    """Minimal ``.env`` loader for local development. Never overrides real env vars."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass(frozen=True)
class Settings:
    earthdata_token: str | None
    data_dir: Path        # prepared real data: Europe cube, maps, durable cache
    raw_dir: Path         # raw per-granule downloads used by pipelines (resumable)
    state_db: Path        # SQLite with jobs and hot cache (ephemeral on Cloud Run)
    frontend_dist: Path   # built frontend (static files)
    environment: str      # "local" | "cloud_run" | value of APP_ENV
    log_level: str
    upstream_timeout_s: float

    @property
    def token_configured(self) -> bool:
        return bool(self.earthdata_token)

    @property
    def secrets(self) -> tuple[str, ...]:
        """Values that must never appear in logs."""
        return tuple(s for s in (self.earthdata_token,) if s)


def load_settings() -> Settings:
    if os.environ.get("APP_LOAD_DOTENV", "1") == "1":
        _load_dotenv(REPO_ROOT / ".env")
    token = (os.environ.get("EARTHDATA_TOKEN") or "").strip() or None
    if os.environ.get("K_SERVICE") or os.environ.get("CLOUD_RUN_JOB"):
        environment = "cloud_run"
    else:
        environment = os.environ.get("APP_ENV", "local")
    runtime = REPO_ROOT / "data" / "runtime"
    return Settings(
        earthdata_token=token,
        data_dir=Path(os.environ.get("DATA_DIR", runtime)),
        raw_dir=Path(os.environ.get("RAW_DIR", REPO_ROOT / "data" / "raw")),
        state_db=Path(os.environ.get("STATE_DB", runtime / "state.sqlite")),
        frontend_dist=Path(os.environ.get("FRONTEND_DIST", REPO_ROOT / "frontend" / "dist")),
        environment=environment,
        log_level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        upstream_timeout_s=float(os.environ.get("UPSTREAM_TIMEOUT_S", "60")),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
