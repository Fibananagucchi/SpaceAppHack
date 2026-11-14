"""Europe trend maps (format map-1.2) computed from the real Europe cube.

Usage (from the repository root, after the cube is ready):
    python -m backend.pipelines.europe_maps                 # all 7 variables
    python -m backend.pipelines.europe_maps --variables t2m

For every grid cell: monthly values in display units -> anomalies from the cell's own monthly
climatology over the map period -> Sen's slope (per decade) and Mann-Kendall with the
Hamed-Rao correction (the same code as point analyses, "stats-1"). Multiple testing over all
cells is controlled with the Benjamini-Hochberg false discovery rate (q < 0.05); the
significance decision is taken at full precision and stored as a boolean per cell.
Cells without data, cells that fail the sufficiency rules and cells where the test could not be
computed carry their own status codes; they never look like a zero slope.

IMERG (native 0.1°) is mapped on 0.5° cells: the monthly values of 5 x 5 native cells are first
averaged (cos-latitude weights; a month is valid only if at least 13 of 25 native cells are
valid) and the trend is computed on that aggregated series.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from backend.app import catalog, stats
from backend.app.config import load_settings
from backend.app.series import to_display_units
from backend.app.storage import EUROPE_BBOX, cube_dir, map_path, read_json, write_json_atomic

log = logging.getLogger("europe_maps")
PROCESSING_VERSION = "map-1"
FDR_Q = 0.05
STATUS_CODES = {"0": "ok", "1": "no_data", "2": "insufficient_for_test", "3": "not_computed"}
AGGREGATE = {"precip": 5}            # variable -> block size (native cells per side)
AGG_MIN_VALID = 13                   # of 25 native cells


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def aggregate_blocks(cube: np.ndarray, lat: np.ndarray, block: int) -> tuple[np.ndarray, np.ndarray]:
    nlat, nlon, nt = cube.shape
    nlat_b, nlon_b = nlat // block, nlon // block
    w = np.cos(np.deg2rad(lat))[: nlat_b * block]
    out = np.full((nlat_b, nlon_b, nt), np.nan, dtype="float32")
    for i in range(nlat_b):
        rows = slice(i * block, (i + 1) * block)
        wr = w[rows][:, None, None]
        for j in range(nlon_b):
            blk = np.asarray(cube[rows, j * block:(j + 1) * block, :], dtype="float64")
            valid = np.isfinite(blk)
            count = valid.sum(axis=(0, 1))
            weights = np.where(valid, wr, 0.0)
            wsum = weights.sum(axis=(0, 1))
            mean = np.where(wsum > 0, np.nansum(np.where(valid, blk, 0.0) * wr, axis=(0, 1)) / np.maximum(wsum, 1e-12), np.nan)
            mean[count < AGG_MIN_VALID] = np.nan
            out[i, j, :] = mean
    lat_b = lat[: nlat_b * block].reshape(nlat_b, block).mean(axis=1)
    return out, lat_b


def _cells_worker(args: tuple) -> list[tuple[int, float, float, int]]:
    """Compute (flat_index, slope_per_decade, p, status) for a chunk of cells."""
    times, rows, flat_indices = args
    t_all = stats.month_offsets(times)
    out = []
    for values, flat in zip(rows, flat_indices):
        values = np.asarray(values, dtype=float)
        if not np.isfinite(values).any():
            out.append((flat, math.nan, math.nan, 1))
            continue
        anom, _, _ = stats.anomalies(times, values)
        reason = stats.sufficiency(anom) if np.isfinite(anom).any() else "too_short"
        if reason:
            out.append((flat, math.nan, math.nan, 2))
            continue
        valid = np.isfinite(anom)
        mk = stats.mann_kendall_hamed_rao(t_all[valid], anom[valid])
        if not math.isfinite(mk.p):
            out.append((flat, math.nan, math.nan, 3))
            continue
        out.append((flat, mk.slope * stats.MONTHS_PER_DECADE, mk.p, 0))
    return out


def benjamini_hochberg(p: np.ndarray) -> np.ndarray:
    m = p.size
    order = np.argsort(p)
    ranked = p[order] * m / np.arange(1, m + 1)
    q_sorted = np.minimum.accumulate(ranked[::-1])[::-1]
    q = np.empty(m)
    q[order] = np.minimum(q_sorted, 1.0)
    return q


def sig4(x: float) -> float | None:
    return stats.sig(x, 4)


def build_map(variable_id: str, data_dir: Path, workers: int) -> dict:
    folder = cube_dir(data_dir, variable_id)
    meta = read_json(folder / "meta.json")
    status = read_json(folder / "status.json") or {}
    if not meta or status.get("status") != "ready":
        raise RuntimeError(f"cube for {variable_id} is not ready")
    variable = catalog.get_variable(variable_id)
    cube = np.load(folder / "data.npy", mmap_mode="r")
    lat = np.asarray(meta["lat"], dtype=float)
    lon = np.asarray(meta["lon"], dtype=float)
    times: list[str] = meta["times"]
    aggregation = None
    if variable_id in AGGREGATE:
        block = AGGREGATE[variable_id]
        cube, lat = aggregate_blocks(cube, lat, block)
        lon = lon[: (lon.size // block) * block].reshape(-1, block).mean(axis=1)
        native = variable["native_resolution"]["lat_deg"]
        aggregation = {"native_resolution_deg": native, "analysis_resolution_deg": round(native * block, 4),
                       "method": (f"area-weighted (cos latitude) mean of {block}x{block} native cells, computed on "
                                  f"monthly values before the trend test"),
                       "valid_rule": (f"an aggregate month is valid only if at least {AGG_MIN_VALID} of "
                                      f"{block * block} native cells are valid; otherwise null"),
                       "note": "trend of the aggregated series, not an average of native-cell trends"}
    nlat, nlon, nt = cube.shape
    values = to_display_units(variable_id, times, np.asarray(cube, dtype="float64"))
    flat_values = values.reshape(nlat * nlon, nt)

    chunk = 400
    tasks = [(times, flat_values[s:s + chunk], list(range(s, min(s + chunk, nlat * nlon))))
             for s in range(0, nlat * nlon, chunk)]
    slope = np.full(nlat * nlon, np.nan)
    p = np.full(nlat * nlon, np.nan)
    code = np.full(nlat * nlon, 3, dtype=int)
    started = time.monotonic()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for n_done, result in enumerate(pool.map(_cells_worker, tasks), start=1):
            for flat, s_, p_, c_ in result:
                slope[flat], p[flat], code[flat] = s_, p_, c_
            if n_done % 20 == 0 or n_done == len(tasks):
                log.info("%s: %d/%d chunks (%.0f s)", variable_id, n_done, len(tasks), time.monotonic() - started)

    ok = code == 0
    q = np.full(nlat * nlon, np.nan)
    significant: list[bool | None] = [None] * (nlat * nlon)
    if ok.any():
        q[ok] = benjamini_hochberg(p[ok])
        for idx in np.where(ok)[0]:
            significant[idx] = bool(q[idx] < FDR_Q)
    limit = float(np.nanpercentile(np.abs(slope[ok]), 98)) if ok.any() else None

    first_valid = next((k for k in range(nt) if np.isfinite(values[:, :, k]).any()), 0)
    last_valid = next((k for k in range(nt - 1, -1, -1) if np.isfinite(values[:, :, k]).any()), nt - 1)
    counts = {name: int(np.sum(code == int(c))) for c, name in STATUS_CODES.items()}
    return {
        "status": "ok",
        "format_version": "map-1.2",
        "variable_id": variable_id,
        "product": {"product": variable["source"]["product"], "version": variable["source"]["version"],
                    "doi": variable["source"]["doi"], "mission_or_model": variable["source"]["mission_or_model"]},
        "provenance": {"source": "Europe cube from NASA GES DISC cloud OPeNDAP",
                       "cube_assembled_at": meta.get("assembled_at"), "computed_at": utc_now(),
                       "processing_version": PROCESSING_VERSION, "statistics_version": stats.PROCESSING_VERSION},
        "domain": {"name": "Europe", "bbox": list(EUROPE_BBOX)},
        "period": {"start": times[first_valid], "end": times[last_valid]},
        "transformation": "monthly_anomalies",
        "climatology": {"base_period": {"start": times[first_valid], "end": times[last_valid]},
                        "rule": "mean of each calendar month over the map period, per cell"},
        "method": {"slope": "Sen's slope of monthly anomalies, per decade",
                   "test": "Mann-Kendall with Hamed-Rao autocorrelation correction",
                   "alpha": stats.ALPHA,
                   "multiple_testing": f"Benjamini-Hochberg false discovery rate over all tested cells, q < {FDR_Q}",
                   "sufficiency": (f">= {stats.MIN_VALID_MONTHS} valid months and >= "
                                   f"{int(stats.MIN_VALID_FRACTION * 100)} % valid in the cell")},
        "unit": variable["trend_unit"],
        "grid": {"shape": [nlat, nlon], "lat0": round(float(lat[0]), 5), "dlat": round(float(lat[1] - lat[0]), 5),
                 "lon0": round(float(lon[0]), 5), "dlon": round(float(lon[1] - lon[0]), 5),
                 "order": "row-major, row 0 = southernmost latitude, column 0 = westernmost longitude",
                 "cell_reference": "center", "aggregation": aggregation},
        "legend": {"center": 0, "range": [-sig4(limit), sig4(limit)] if limit else None,
                   "rule": "symmetric around 0; limit = 98th percentile of |slope| over cells with status ok"},
        "cells": {"slope": [sig4(v) if c == 0 else None for v, c in zip(slope, code)],
                  "p_value": [sig4(v) if c == 0 else None for v, c in zip(p, code)],
                  "q_value": [sig4(v) if c == 0 else None for v, c in zip(q, code)],
                  "significant": significant,
                  "status": code.tolist()},
        "status_codes": STATUS_CODES,
        "cell_counts": counts,
        "computed_at": utc_now(),
        "processing_version": PROCESSING_VERSION,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variables", default=",".join(catalog.CORE_VARIABLE_IDS))
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = parser.parse_args(argv)
    settings = load_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    code = 0
    for vid in [v.strip() for v in args.variables.split(",") if v.strip()]:
        try:
            started = time.monotonic()
            payload = build_map(vid, settings.data_dir, args.workers)
            write_json_atomic(map_path(settings.data_dir, vid), payload)
            log.info("%s: map written, cells %s, %.0f s", vid, payload["cell_counts"], time.monotonic() - started)
        except Exception as exc:
            log.exception("%s: map failed (%s)", vid, type(exc).__name__)
            code = 1
    return code


if __name__ == "__main__":
    sys.exit(main())
