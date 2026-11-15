"""Globe layer for Europe (task 017): index of the prepared frames and the time-strip neighbours.

The frames themselves (format globe-1) are built by ``backend.pipelines.europe_globe`` from the
real Europe cube and served as they are. This module only reads them: it never computes,
fills or interpolates values. Outside Europe there is no globe layer; the time strip there uses
``series.annual`` of the ordinary point analysis.
"""

from __future__ import annotations

import math
from typing import Any

from . import catalog
from .config import Settings
from .storage import EUROPE_BBOX, GLOBE_GRID, read_globe

MAX_RING = 2


def index(settings: Settings) -> dict[str, Any]:
    layers = []
    for vid in catalog.CORE_VARIABLE_IDS:
        payload = read_globe(settings.data_dir, settings.prepared_dir, vid)
        trend = read_globe(settings.data_dir, settings.prepared_dir, vid, kind="trend")
        trend_state = ({"status": "ok", "period": trend["period"], "unit": trend["unit"],
                        "served_from": trend["provenance"].get("served_from")}
                       if trend is not None else {"status": "not_ready", "reason": "not_computed"})
        if payload is None:
            layers.append({"variable_id": vid, "status": "not_ready", "reason": "not_computed", "trend": trend_state})
            continue
        layers.append({"variable_id": vid, "status": "ok", "unit": payload["unit"],
                       "years": {"first": payload["years"][0], "last": payload["years"][-1]},
                       "served_from": payload["provenance"].get("served_from"),
                       "computed_at": payload.get("computed_at"), "trend": trend_state})
    return {"status": "ok", "format_version": "globe-1", "domain": {"name": "Europe", "bbox": list(EUROPE_BBOX)},
            "grid": {**GLOBE_GRID, "cell_reference": "center",
                     "order": "row-major, row 0 = southernmost latitude, column 0 = westernmost longitude"},
            "outside_domain": "no globe layer; use a point analysis (series.annual for the time strip)",
            "layers": layers}


def inside_domain(lat: float, lon: float) -> bool:
    west, south, east, north = EUROPE_BBOX
    return south <= lat <= north and west <= lon <= east


def _decode(value: int | None, scale: float, decimals: int) -> float | None:
    return None if value is None else round(value * scale, decimals)


def strip(settings: Settings, variable_id: str, lat: float, lon: float, ring: int) -> dict[str, Any]:
    requested = {"lat": lat, "lon": lon, "ring": ring}
    if variable_id not in catalog.CORE_VARIABLE_IDS:
        return {"status": "not_available", "reason": "no_globe_layer_for_variable", "variable_id": variable_id,
                "requested": requested}
    if not inside_domain(lat, lon):
        return {"status": "not_available", "reason": "outside_globe_layer", "variable_id": variable_id,
                "requested": requested,
                "note": "No globe layer here; the time strip uses series.annual of the point analysis."}
    payload = read_globe(settings.data_dir, settings.prepared_dir, variable_id)
    if payload is None:
        return {"status": "not_ready", "reason": "not_computed", "variable_id": variable_id, "requested": requested}

    grid = payload["grid"]
    nrow, ncol = grid["shape"]
    west, south = EUROPE_BBOX[0], EUROPE_BBOX[1]
    row = min(nrow - 1, max(0, math.floor((lat - south) / grid["dlat"])))
    col = min(ncol - 1, max(0, math.floor((lon - west) / grid["dlon"])))
    scale, decimals = payload["encoding"]["scale"], payload["encoding"]["decimals"]
    frames, cell_status, codes = payload["frames"], payload["cell_status"], payload["status_codes"]

    def cell(r: int, c: int, distance: int) -> dict[str, Any]:
        k = r * ncol + c
        return {"center_lat": round(grid["lat0"] + r * grid["dlat"], 4),
                "center_lon": round(grid["lon0"] + c * grid["dlon"], 4),
                "ring": distance, "status": codes[str(cell_status[k])],
                "values": [_decode(frame[k], scale, decimals) for frame in frames]}

    neighbours = []
    for d in range(1, ring + 1):
        for r in range(row + d, row - d - 1, -1):           # north to south
            for c in range(col - d, col + d + 1):           # west to east
                if max(abs(r - row), abs(c - col)) != d or not (0 <= r < nrow and 0 <= c < ncol):
                    continue
                neighbours.append(cell(r, c, d))
    return {
        "status": "ok", "format_version": payload["format_version"], "variable_id": variable_id,
        "unit": payload["unit"], "requested": requested, "years": payload["years"],
        "baseline": payload["baseline"], "annual": payload["annual"],
        "grid": {"cell_size_deg": grid["dlat"], "aggregation": grid["aggregation"]["method"]},
        "selected": cell(row, col, 0),
        "neighbours": neighbours,
        "rule": (f"the 1° globe cells around the selected one (ring 1 = up to 8 cells, ring 2 = up to 24); "
                 f"cells outside the Europe layer are not listed"),
        "provenance": payload["provenance"],
    }
