"""Paths and readers for prepared real data under DATA_DIR.

Layout (same locally and on the Cloud Storage bucket mounted on Cloud Run):

    DATA_DIR/cube/europe/<variable_id>/data.npy     float32 (lat, lon, time), NaN = missing
    DATA_DIR/cube/europe/<variable_id>/meta.json    grid, times, product, provenance
    DATA_DIR/cube/europe/<variable_id>/status.json  pipeline state
    DATA_DIR/maps/europe/<variable_id>.json         precomputed trend map (format map-1.2)
    DATA_DIR/globe/europe/<variable_id>.json        annual anomaly frames on the 1° globe grid (globe-1)
    DATA_DIR/globe/europe/trend/<variable_id>.json  full-period trend on the same 1° grid (map-1.2)
"""

from __future__ import annotations

import gzip
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .catalog import CORE_VARIABLE_IDS

EUROPE_BBOX = (-25.0, 34.0, 45.0, 72.0)  # west, south, east, north
# Common 1° grid of the globe layer (task 017): cell centres, row 0 = south, column 0 = west.
GLOBE_GRID = {"shape": [38, 70], "lat0": 34.5, "dlat": 1.0, "lon0": -24.5, "dlon": 1.0}


def cube_dir(data_dir: Path, variable_id: str) -> Path:
    return Path(data_dir) / "cube" / "europe" / variable_id


def map_path(data_dir: Path, variable_id: str) -> Path:
    return Path(data_dir) / "maps" / "europe" / f"{variable_id}.json"


def read_map(data_dir: Path, prepared_dir: Path | None, variable_id: str) -> dict[str, Any] | None:
    """Map from DATA_DIR (fresh, written by the pipeline) or, if absent, the prepared copy shipped in the image."""
    fresh = read_json(map_path(data_dir, variable_id))
    if fresh and fresh.get("status") == "ok":
        return fresh
    if prepared_dir is not None:
        packed = Path(prepared_dir) / "maps" / "europe" / f"{variable_id}.json.gz"
        try:
            with gzip.open(packed, "rt", encoding="utf-8") as f:
                prepared = json.load(f)
            if prepared.get("status") == "ok":
                prepared.setdefault("provenance", {})["served_from"] = "prepared_copy_in_image"
                return prepared
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return None
    return None


def globe_path(data_dir: Path, variable_id: str) -> Path:
    return Path(data_dir) / "globe" / "europe" / f"{variable_id}.json"


def globe_trend_path(data_dir: Path, variable_id: str) -> Path:
    return Path(data_dir) / "globe" / "europe" / "trend" / f"{variable_id}.json"


# path -> [mtime, payload, serialised bytes, gzip bytes or None]; the gzip copy belongs to that exact file version
_GLOBE_CACHE: dict[str, list[Any]] = {}
GLOBE_KINDS = ("frames", "trend")


def _cached(path: Path, gz: bool) -> list[Any] | None:
    """Parsed JSON and its serialised bytes, re-read only when the file changes."""
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    hit = _GLOBE_CACHE.get(str(path))
    if hit and hit[0] == mtime:
        return hit
    try:
        if gz:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                payload = json.load(f)
        else:
            with open(path, encoding="utf-8") as f:
                payload = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if payload.get("status") != "ok":
        return None
    payload.setdefault("provenance", {})["served_from"] = "prepared_copy_in_image" if gz else "data_dir"
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    entry = [mtime, payload, body, None]
    _GLOBE_CACHE[str(path)] = entry
    return entry


def _globe_entry(data_dir: Path, prepared_dir: Path | None, variable_id: str, kind: str) -> list[Any] | None:
    fresh_path = globe_path(data_dir, variable_id) if kind == "frames" else globe_trend_path(data_dir, variable_id)
    fresh = _cached(fresh_path, gz=False)
    if fresh is not None:
        return fresh
    if prepared_dir is not None:
        sub = Path("globe") / "europe"
        if kind == "trend":
            sub = sub / "trend"
        return _cached(Path(prepared_dir) / sub / f"{variable_id}.json.gz", gz=True)
    return None


def read_globe(data_dir: Path, prepared_dir: Path | None, variable_id: str, kind: str = "frames") -> dict[str, Any] | None:
    """Globe frames (globe-1) or the 1° trend layer (map-1.2) from DATA_DIR (fresh) or, if absent, the
    prepared copy shipped in the image. Read-only: callers must not modify the returned payload."""
    entry = _globe_entry(data_dir, prepared_dir, variable_id, kind)
    return entry[1] if entry else None


def read_globe_bytes(data_dir: Path, prepared_dir: Path | None, variable_id: str, gzipped: bool = False,
                     kind: str = "frames") -> bytes | None:
    """The same payload already serialised; optionally gzip-compressed once per file version and cached."""
    entry = _globe_entry(data_dir, prepared_dir, variable_id, kind)
    if entry is None:
        return None
    if not gzipped:
        return entry[2]
    if entry[3] is None:
        entry[3] = gzip.compress(entry[2], compresslevel=6)
    return entry[3]


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
    for vid in CORE_VARIABLE_IDS:
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
