"""Paths and readers for prepared real data under DATA_DIR.

Layout (same locally and on the Cloud Storage bucket mounted on Cloud Run):

    DATA_DIR/cube/europe/<variable_id>/data.npy     float32 (lat, lon, time), NaN = missing
    DATA_DIR/cube/europe/<variable_id>/meta.json    grid, times, product, provenance
    DATA_DIR/cube/europe/<variable_id>/status.json  pipeline state
    DATA_DIR/maps/europe/<variable_id>.json         precomputed trend map (format map-1.2)
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .catalog import VARIABLE_IDS

EUROPE_BBOX = (-25.0, 34.0, 45.0, 72.0)  # west, south, east, north


def cube_dir(data_dir: Path, variable_id: str) -> Path:
    return Path(data_dir) / "cube" / "europe" / variable_id


def map_path(data_dir: Path, variable_id: str) -> Path:
    return Path(data_dir) / "maps" / "europe" / f"{variable_id}.json"


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, path)


def cube_status(data_dir: Path) -> dict[str, Any]:
    variables: dict[str, Any] = {}
    for vid in VARIABLE_IDS:
        status = read_json(cube_dir(data_dir, vid) / "status.json")
        variables[vid] = status if status else {"status": "not_started"}
    states = {v["status"] for v in variables.values()}
    if states == {"ready"}:
        overall = "ready"
    elif states == {"not_started"}:
        overall = "not_started"
    else:
        overall = "partial"
    return {"status": overall, "variables": variables}


def data_dir_writable(data_dir: Path) -> bool:
    try:
        Path(data_dir).mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=data_dir, prefix=".probe-")
        os.close(fd)
        os.remove(tmp)
        return True
    except OSError:
        return False
