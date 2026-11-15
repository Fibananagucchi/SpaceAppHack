"""Globe layers (tasks 017 / 020): index of the prepared frames and trend, and the time-strip neighbours.

Two domains with the same formats: Europe on 1° cells (from the Europe cube) and the World on 2° cells
(from the strided world cube). Frames (globe-1) and trend layers (map-1.2) are built by
``backend.pipelines.europe_globe`` / ``europe_globe_trend`` and served as they are. This module only reads
them: it never computes, fills or interpolates values. Where a domain has no layer for a variable, the
state says so; the time strip then uses ``series.annual`` of the ordinary point analysis.
"""

from __future__ import annotations

import math
from typing import Any

from . import catalog
from .config import Settings
from .storage import DOMAINS, EUROPE_BBOX, GLOBE_GRID, read_globe

MAX_RING = 2
GRID_ORDER = "row-major, row 0 = southernmost latitude, column 0 = westernmost longitude"


def _layer_state(settings: Settings, vid: str, domain: str) -> dict[str, Any]:
    frames = read_globe(settings.data_dir, settings.prepared_dir, vid, domain=domain)
    trend = read_globe(settings.data_dir, settings.prepared_dir, vid, kind="trend", domain=domain)
    changes = read_globe(settings.data_dir, settings.prepared_dir, vid, kind="changes", domain=domain)
    return {
        "frames": ({"status": "ok", "unit": frames["unit"],
                    "years": {"first": frames["years"][0], "last": frames["years"][-1]},
                    "served_from": frames["provenance"].get("served_from"), "computed_at": frames.get("computed_at")}
                   if frames is not None else {"status": "not_ready", "reason": "not_computed"}),
        "trend": ({"status": "ok", "period": trend["period"], "unit": trend["unit"],
                   "served_from": trend["provenance"].get("served_from")}
                  if trend is not None else {"status": "not_ready", "reason": "not_computed"}),
        "changes": ({"status": "ok", "period": changes["period"], "counts": changes["counts"],
                     "computed_at": changes.get("computed_at"), "served_from": changes["provenance"].get("served_from")}
                    if changes is not None else {"status": "not_ready", "reason": "not_computed"}),
    }


def domains_index(settings: Settings) -> dict[str, Any]:
    """GET /api/v1/globe: which domain is ready for which variable."""
    domains = {d["id"]: {"name": d["name"], "bbox": list(d["bbox"]),
                         "grid": {**d["grid"], "cell_reference": "center", "order": GRID_ORDER}}
               for d in DOMAINS.values()}
    layers = [{"variable_id": vid, **{d: _layer_state(settings, vid, d) for d in DOMAINS}}
              for vid in catalog.CORE_VARIABLE_IDS]
    return {"status": "ok", "format_version": "globe-1", "domains": domains, "layers": layers,
            "rule": ("each layer is ok or not_ready per domain; where the world layer is not ready, Europe still works "
                     "and points anywhere use a live point analysis")}


def index(settings: Settings) -> dict[str, Any]:
    """GET /api/v1/globe/europe (kept as it was for task 017 clients)."""
    layers = []
    for vid in catalog.CORE_VARIABLE_IDS:
        state = _layer_state(settings, vid, "europe")
        f = state["frames"]
        if f["status"] != "ok":
            layers.append({"variable_id": vid, "status": "not_ready", "reason": "not_computed", "trend": state["trend"]})
            continue
        layers.append({"variable_id": vid, "status": "ok", "unit": f["unit"], "years": f["years"],
                       "served_from": f["served_from"], "computed_at": f["computed_at"], "trend": state["trend"]})
    return {"status": "ok", "format_version": "globe-1", "domain": {"name": "Europe", "bbox": list(EUROPE_BBOX)},
            "grid": {**GLOBE_GRID, "cell_reference": "center", "order": GRID_ORDER},
            "outside_domain": "no Europe layer; see GET /api/v1/globe for the world layer, or use a point analysis",
            "layers": layers}


def inside_domain(lat: float, lon: float, domain: str = "europe") -> bool:
    west, south, east, north = DOMAINS[domain]["bbox"]
    return south <= lat <= north and west <= lon <= east


def _decode(value: int | None, scale: float, decimals: int) -> float | None:
    return None if value is None else round(value * scale, decimals)


def strip(settings: Settings, variable_id: str, lat: float, lon: float, ring: int,
          domain: str = "europe") -> dict[str, Any]:
    requested = {"lat": lat, "lon": lon, "ring": ring, "domain": domain}
    if variable_id not in catalog.CORE_VARIABLE_IDS:
        return {"status": "not_available", "reason": "no_globe_layer_for_variable", "variable_id": variable_id,
                "requested": requested}
    if not inside_domain(lat, lon, domain):
        return {"status": "not_available", "reason": "outside_globe_layer", "variable_id": variable_id,
                "requested": requested,
                "note": "No globe layer here; the time strip uses series.annual of the point analysis."}
    payload = read_globe(settings.data_dir, settings.prepared_dir, variable_id, domain=domain)
    if payload is None:
        return {"status": "not_ready", "reason": "not_computed", "variable_id": variable_id, "requested": requested}

    grid = payload["grid"]
    nrow, ncol = grid["shape"]
    west, south = DOMAINS[domain]["bbox"][0], DOMAINS[domain]["bbox"][1]
    row = min(nrow - 1, max(0, math.floor((lat - south) / grid["dlat"])))
    col = min(ncol - 1, max(0, math.floor((lon - west) / grid["dlon"])))
    wraps = domain == "world"                                # longitude is cyclic on the whole globe
    scale, decimals = payload["encoding"]["scale"], payload["encoding"]["decimals"]
    frames, cell_status, codes = payload["frames"], payload["cell_status"], payload["status_codes"]
    size = f"{grid['dlat']:g}°"

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
                if max(abs(r - row), abs(c - col)) != d or not 0 <= r < nrow:
                    continue
                if wraps:
                    c %= ncol
                elif not 0 <= c < ncol:
                    continue
                neighbours.append(cell(r, c, d))
    return {
        "status": "ok", "format_version": payload["format_version"], "variable_id": variable_id,
        "domain": payload.get("domain"), "unit": payload["unit"], "requested": requested, "years": payload["years"],
        "baseline": payload["baseline"], "annual": payload["annual"],
        "grid": {"cell_size_deg": grid["dlat"], "aggregation": grid["aggregation"]["method"]},
        "selected": cell(row, col, 0),
        "neighbours": neighbours,
        "rule": (f"the {size} globe cells around the selected one (ring 1 = up to 8 cells, ring 2 = up to 24); "
                 + ("longitude wraps around the globe" if wraps else "cells outside the layer are not listed")),
        "provenance": payload["provenance"],
    }
