"""Test configuration: never read the real .env, never touch real data directories."""

import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="trend-tests-"))
os.environ["APP_LOAD_DOTENV"] = "0"
os.environ["EARTHDATA_TOKEN"] = ""
os.environ["DATA_DIR"] = str(_TMP / "data")
os.environ["RAW_DIR"] = str(_TMP / "raw")
os.environ["PREPARED_DIR"] = str(_TMP / "prepared")
os.environ["STATE_DB"] = str(_TMP / "state.sqlite")
os.environ["FRONTEND_DIST"] = str(_TMP / "no-frontend")


@pytest.fixture
def tmp_settings(tmp_path):
    from backend.app.config import Settings

    def make(token: str | None = None, frontend_dist: Path | None = None) -> Settings:
        return Settings(
            earthdata_token=token,
            data_dir=tmp_path / "data",
            raw_dir=tmp_path / "raw",
            prepared_dir=tmp_path / "prepared",
            state_db=tmp_path / "state.sqlite",
            frontend_dist=frontend_dist or (tmp_path / "no-frontend"),
            environment="test",
            log_level="WARNING",
            upstream_timeout_s=5.0,
        )

    return make
