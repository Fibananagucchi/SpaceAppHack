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
import hashlib
import json
import os
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .catalog import CORE_VARIABLE_IDS

EUROPE_BBOX = (-25.0, 34.0, 45.0, 72.0)  # west, south, east, north
# Common 1° grid of the globe layer (task 017): cell centres, row 0 = south, column 0 = west.
GLOBE_GRID = {"shape": [38, 70], "lat0": 34.5, "dlat": 1.0, "lon0": -24.5, "dlon": 1.0}

# World layer (task 020): 2° cells, row 0 = south (centre -89), column 0 = west (centre -179).
WORLD_BBOX = (-180.0, -90.0, 180.0, 90.0)
WORLD_GRID = {"shape": [90, 180], "lat0": -89.0, "dlat": 2.0, "lon0": -179.0, "dlon": 2.0}
DOMAINS = {
    "europe": {"id": "europe", "name": "Europe", "bbox": EUROPE_BBOX, "grid": GLOBE_GRID, "cube": "europe"},
    "world": {"id": "world", "name": "World", "bbox": WORLD_BBOX, "grid": WORLD_GRID, "cube": "world"},
}


def cube_dir(data_dir: Path, variable_id: str) -> Path:
    return Path(data_dir) / "cube" / "europe" / variable_id


def world_cube_dir(data_dir: Path, variable_id: str) -> Path:
    return Path(data_dir) / "cube" / "world" / variable_id


def domain_cube_dir(data_dir: Path, domain: str, variable_id: str) -> Path:
    return Path(data_dir) / "cube" / DOMAINS[domain]["cube"] / variable_id


def map_path(data_dir: Path, variable_id: str) -> Path:
    return Path(data_dir) / "maps" / "europe" / f"{variable_id}.json"


def read_map(data_dir: Path, prepared_dir: Path | None, variable_id: str) -> dict[str, Any] | None:
    """Metadata of the Europe map (map-1.2) from DATA_DIR (fresh) or the prepared copy shipped in the image.

    Only the small top-level fields are returned; the full body is served from :func:`read_map_entry`.
    """
    entry = read_map_entry(data_dir, prepared_dir, variable_id)
    return entry.meta if entry else None


def read_map_entry(data_dir: Path, prepared_dir: Path | None, variable_id: str) -> "LayerEntry | None":
    fresh = _cached(map_path(data_dir, variable_id), gz=False)
    if fresh is not None:
        return fresh
    if prepared_dir is not None:
        return _cached(Path(prepared_dir) / "maps" / "europe" / f"{variable_id}.json.gz", gz=True)
    return None


def globe_path(data_dir: Path, variable_id: str, domain: str = "europe") -> Path:
    return Path(data_dir) / "globe" / domain / f"{variable_id}.json"


def globe_trend_path(data_dir: Path, variable_id: str, domain: str = "europe") -> Path:
    return Path(data_dir) / "globe" / domain / "trend" / f"{variable_id}.json"


def globe_changes_path(data_dir: Path, variable_id: str, domain: str = "europe") -> Path:
    return Path(data_dir) / "globe" / domain / "changes" / f"{variable_id}.json"


GLOBE_KINDS = ("frames", "trend", "changes")
# Fields with one value per cell: never kept as Python objects, only inside the compressed body.
_BULK_KEYS = frozenset({"frames", "cell_sd", "cell_status", "cells", "changes"})
MISSING = int(np.iinfo(np.int32).min)   # sentinel for a null frame value in the strip arrays


@dataclass
class LayerEntry:
    """One prepared layer file, read once per file version.

    ``meta`` holds the small top-level fields only. The body is kept once, gzip-compressed (Brotli or a binary
    encoding were measured on the world layers: only 8-20 % smaller after compression, so not used). Frames
    also keep compact integer arrays for the time strip.
    """
    version: tuple[int, int]
    meta: dict[str, Any]
    gz: bytes
    etag: str
    frames: np.ndarray | None = None        # int32 (years, cells), MISSING = null
    cell_status: np.ndarray | None = None   # int16 (cells,)

    def body(self, accept_encoding: str) -> tuple[bytes, str | None]:
        """The body in the best encoding the client accepts: (bytes, Content-Encoding or None)."""
        accepted = {part.split(";")[0].strip().lower() for part in accept_encoding.split(",")}
        if "gzip" in accepted:
            return self.gz, "gzip"
        return gzip.decompress(self.gz), None


_LAYER_CACHE: dict[str, LayerEntry] = {}
_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(key: str) -> threading.Lock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.Lock())


def _load(path: Path, gz: bool, version: tuple[int, int]) -> LayerEntry | None:
    try:
        if gz:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                payload = json.load(f)
        else:
            with open(path, encoding="utf-8") as f:
                payload = json.load(f)
    except (OSError, EOFError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        return None
    payload.setdefault("provenance", {})["served_from"] = "prepared_copy_in_image" if gz else "data_dir"
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    packed = gzip.compress(body, compresslevel=6, mtime=0)
    frames = cell_status = None
    if isinstance(payload.get("frames"), list) and isinstance(payload.get("cell_status"), list):
        frames = np.array([[MISSING if v is None else v for v in frame] for frame in payload["frames"]],
                          dtype=np.int32).reshape(len(payload["frames"]), -1)
        cell_status = np.asarray(payload["cell_status"], dtype=np.int16)
    meta = {k: v for k, v in payload.items() if k not in _BULK_KEYS}
    etag = '"' + hashlib.sha1(body).hexdigest()[:20] + '"'
    return LayerEntry(version, meta, packed, etag, frames, cell_status)


def _cached(path: Path, gz: bool) -> LayerEntry | None:
    """The layer of ``path``, re-read only when the file changes (thread-safe, one reader per file)."""
    try:
        st = path.stat()
    except OSError:
        return None
    version = (st.st_mtime_ns, st.st_size)
    key = str(path)
    hit = _LAYER_CACHE.get(key)
    if hit is not None and hit.version == version:
        return hit
    with _lock_for(key):
        hit = _LAYER_CACHE.get(key)
        if hit is not None and hit.version == version:
            return hit
        entry = _load(path, gz, version)
        if entry is None:
            _LAYER_CACHE.pop(key, None)
            return None
        _LAYER_CACHE[key] = entry
        return entry


def globe_entry(data_dir: Path, prepared_dir: Path | None, variable_id: str, kind: str = "frames",
                domain: str = "europe") -> LayerEntry | None:
    """Globe frames (globe-1), trend (map-1.2) or changes (changes-1) of a domain from DATA_DIR (fresh) or,
    if absent, the prepared copy shipped in the image. Read-only: callers must not modify the entry."""
    fresh_path = {"frames": globe_path, "trend": globe_trend_path,
                  "changes": globe_changes_path}[kind](data_dir, variable_id, domain)
    fresh = _cached(fresh_path, gz=False)
    if fresh is not None:
        return fresh
    if prepared_dir is not None:
        sub = Path("globe") / domain
        if kind in ("trend", "changes"):
            sub = sub / kind
        return _cached(Path(prepared_dir) / sub / f"{variable_id}.json.gz", gz=True)
    return None


def read_globe(data_dir: Path, prepared_dir: Path | None, variable_id: str, kind: str = "frames",
               domain: str = "europe") -> dict[str, Any] | None:
    """Small top-level fields of a globe layer (status, unit, years, period, computed_at, provenance, ...)."""
    entry = globe_entry(data_dir, prepared_dir, variable_id, kind, domain)
    return entry.meta if entry else None


def warm_cache(data_dir: Path, prepared_dir: Path | None) -> int:
    """Read every prepared layer once (called in a worker thread at start-up). Returns the number of layers."""
    count = 0
    for vid in CORE_VARIABLE_IDS:
        count += read_map_entry(data_dir, prepared_dir, vid) is not None
        for domain in DOMAINS:
            for kind in GLOBE_KINDS:
                count += globe_entry(data_dir, prepared_dir, vid, kind, domain) is not None
    return count


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
