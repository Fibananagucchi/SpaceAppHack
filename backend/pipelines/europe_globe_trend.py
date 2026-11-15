"""Full-period trend layer for the globe (format map-1.2 on the 1° globe-1 grid), from the real Europe cube.

Usage (from the repository root, after the cube is ready):
    python -m backend.pipelines.europe_globe_trend                  # all 7 variables
    python -m backend.pipelines.europe_globe_trend --variables t2m --prepared

It is NOT an average of finished slopes, p- or q-values. For every 1° box:
  1. monthly anomalies of each native cube cell from its own monthly climatology (the same rule as
     the globe frames and a point analysis without a period);
  2. the box's monthly anomaly = cos-latitude weighted mean of the anomalies of the native cells whose
     centres lie in the box; a month is valid only if at least half of the box's cells that have data
     are valid, otherwise null (anomalies first, so cells dropping out cannot fake a jump between
     cells with different climatologies);
  3. on that monthly anomaly series (used as it is, not re-anomalised): the same statistics code as the
     Europe trend maps ("stats-1": Sen's slope per decade, Mann-Kendall with the Hamed-Rao correction, the
     same sufficiency rules), then the Benjamini-Hochberg false discovery rate (q < 0.05) over all boxes
     with status ok of the variable.
For a box that holds exactly one native cell (AIRS, 1° native) the result equals the native trend map.
Boxes without any native cell with data are no_data; nothing is filled or interpolated.
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import math
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from backend.app import catalog, stats
from backend.app.config import load_settings
from backend.app.series import to_display_units
from backend.app.storage import (EUROPE_BBOX, GLOBE_GRID, cube_dir, globe_trend_path, read_json,
                                 write_json_atomic)
from backend.pipelines.europe_globe import MIN_BOX_FRACTION, box_index, utc_now
from backend.pipelines.europe_maps import FDR_Q, STATUS_CODES, benjamini_hochberg, sig4

log = logging.getLogger("europe_globe_trend")
PROCESSING_VERSION = "globe-trend-1"


def _anomaly_trend_worker(args: tuple) -> list[tuple[int, float, float, int]]:
    """(flat_index, slope_per_decade, p, status) for a chunk of boxes whose series already are anomalies.

    Same tests and status codes as europe_maps._cells_worker, but without computing anomalies again:
    re-anomalising adds float noise that breaks ties in Mann-Kendall and shifts the Hamed-Rao correction.
    """
    times, rows, flat_indices = args
    t_all = stats.month_offsets(times)
    out = []
    for anom, flat in zip(rows, flat_indices):
        anom = np.asarray(anom, dtype=float)
        if not np.isfinite(anom).any():
            out.append((flat, math.nan, math.nan, 1))
            continue
        if stats.sufficiency(anom):
            out.append((flat, math.nan, math.nan, 2))
            continue
        valid = np.isfinite(anom)
        mk = stats.mann_kendall_hamed_rao(t_all[valid], anom[valid])
        if not math.isfinite(mk.p):
            out.append((flat, math.nan, math.nan, 3))
            continue
        out.append((flat, mk.slope * stats.MONTHS_PER_DECADE, mk.p, 0))
    return out


def box_monthly_anomalies(variable_id: str, cube: np.ndarray, lat: np.ndarray, lon: np.ndarray,
                          times: list[str]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Monthly anomaly series of every 1° box: (n_boxes, n_times), native cells with data, native cells per box."""
    nrow, ncol = GLOBE_GRID["shape"]
    west, south = EUROPE_BBOX[0], EUROPE_BBOX[1]
    row_of = box_index(lat, south, GLOBE_GRID["dlat"], nrow)
    col_of = box_index(lon, west, GLOBE_GRID["dlon"], ncol)
    cols_in_box = [np.where(col_of == c)[0] for c in range(ncol)]
    out = np.full((nrow * ncol, len(times)), np.nan)
    with_data = np.zeros(nrow * ncol, dtype=int)
    per_box = np.zeros(nrow * ncol, dtype=int)
    for r in range(nrow):
        rows = np.where(row_of == r)[0]
        if rows.size == 0:
            continue
        values = to_display_units(variable_id, times, np.asarray(cube[rows], dtype="float64"))
        has_data = np.isfinite(values).any(axis=-1)
        # the exact per-cell function of point analyses and trend maps (stats.anomalies), so that a box with one
        # native cell reproduces the native trend map bit for bit
        anom = np.full(values.shape, np.nan)
        for i, j in zip(*np.where(has_data)):
            anom[i, j] = stats.anomalies(times, values[i, j])[0]
        w = np.cos(np.deg2rad(lat[rows]))[:, None, None]
        for c, cols in enumerate(cols_in_box):
            if cols.size == 0:
                continue
            k = r * ncol + c
            per_box[k] = rows.size * cols.size
            data_cells = int(has_data[:, cols].sum())
            with_data[k] = data_cells
            if data_cells == 0:
                continue
            block = anom[:, cols, :]
            valid = np.isfinite(block)
            weights = np.where(valid, w, 0.0)
            wsum = weights.sum(axis=(0, 1))
            with np.errstate(invalid="ignore", divide="ignore"):
                # normalised weights: a month with one valid cell reproduces that cell exactly (w / w == 1.0)
                mean = (np.where(valid, block, 0.0) * (weights / wsum)).sum(axis=(0, 1))
            enough = valid.sum(axis=(0, 1)) >= MIN_BOX_FRACTION * data_cells
            out[k] = np.where(enough & (wsum > 0), mean, np.nan)
    return out, with_data, per_box


def build_globe_trend(variable_id: str, data_dir: Path, workers: int = 1) -> dict:
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
    series, with_data, per_box = box_monthly_anomalies(variable_id, cube, lat, lon, times)
    n = series.shape[0]

    chunk = 200
    tasks = [(times, series[s:s + chunk], list(range(s, min(s + chunk, n)))) for s in range(0, n, chunk)]
    slope = np.full(n, np.nan)
    p = np.full(n, np.nan)
    code = np.full(n, 3, dtype=int)
    if workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(_anomaly_trend_worker, tasks))
    else:
        results = [_anomaly_trend_worker(t) for t in tasks]
    for result in results:
        for flat, s_, p_, c_ in result:
            slope[flat], p[flat], code[flat] = s_, p_, c_
    # box with data, but no month ever reached the validity rule -> not enough for a test (not "no data")
    code[(with_data > 0) & (code == 1)] = 2
    code[with_data == 0] = 1                                   # no native cell with data in the box

    ok = code == 0
    q = np.full(n, np.nan)
    significant: list[bool | None] = [None] * n
    if ok.any():
        q[ok] = benjamini_hochberg(p[ok])
        for idx in np.where(ok)[0]:
            significant[idx] = bool(q[idx] < FDR_Q)
    limit = float(np.nanpercentile(np.abs(slope[ok]), 98)) if ok.any() else None

    valid_any = np.isfinite(series).any(axis=0)
    first_valid = int(np.argmax(valid_any)) if valid_any.any() else 0
    last_valid = int(len(times) - 1 - np.argmax(valid_any[::-1])) if valid_any.any() else len(times) - 1
    counts = {name: int(np.sum(code == int(c))) for c, name in STATUS_CODES.items()}
    native = variable["native_resolution"]
    g = GLOBE_GRID
    return {
        "status": "ok",
        "format_version": "map-1.2",
        "layer": "globe_trend_1deg",
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
                        "rule": ("each native cell's own mean of each calendar month over the record; the 1° box "
                                 "series is the weighted mean of its cells' anomalies, tested as it is")},
        "method": {"slope": "Sen's slope of the 1° box's monthly anomalies, per decade",
                   "test": "Mann-Kendall with Hamed-Rao autocorrelation correction",
                   "alpha": stats.ALPHA,
                   "multiple_testing": f"Benjamini-Hochberg false discovery rate over all tested 1° cells, q < {FDR_Q}",
                   "sufficiency": (f">= {stats.MIN_VALID_MONTHS} valid months and >= "
                                   f"{int(stats.MIN_VALID_FRACTION * 100)} % valid in the 1° cell")},
        "unit": variable["trend_unit"],
        "grid": {"shape": list(g["shape"]), "lat0": g["lat0"], "dlat": g["dlat"], "lon0": g["lon0"], "dlon": g["dlon"],
                 "order": "row-major, row 0 = southernmost latitude, column 0 = westernmost longitude",
                 "cell_reference": "center",
                 "aggregation": {
                     "native_resolution_deg": {"lat": native["lat_deg"], "lon": native["lon_deg"]},
                     "analysis_resolution_deg": g["dlat"],
                     "method": ("cos-latitude weighted mean of the monthly anomalies of the native cube cells whose "
                                "centres lie in the 1° box, computed before the trend test"),
                     "valid_rule": (f"a 1° month is valid only if at least {int(MIN_BOX_FRACTION * 100)} % of the box's "
                                    f"native cells that have data are valid; otherwise null"),
                     "native_cells_per_box": {"min": int(per_box[per_box > 0].min()), "max": int(per_box.max())},
                     "note": ("trend of the aggregated series, not an average of native-cell trends; the same 1° grid "
                              "as the globe frames (globe-1)")}},
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


def write_prepared(prepared_dir: Path, variable_id: str, payload: dict) -> Path:
    path = Path(prepared_dir) / "globe" / "europe" / "trend" / f"{variable_id}.json.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variables", default=",".join(catalog.CORE_VARIABLE_IDS))
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--prepared", action="store_true",
                        help="also write the gzip copy shipped with the code (data/prepared/globe/europe/trend)")
    args = parser.parse_args(argv)
    settings = load_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    code = 0
    for vid in [v.strip() for v in args.variables.split(",") if v.strip()]:
        try:
            started = time.monotonic()
            payload = build_globe_trend(vid, settings.data_dir, args.workers)
            write_json_atomic(globe_trend_path(settings.data_dir, vid), payload)
            if args.prepared:
                write_prepared(settings.prepared_dir, vid, payload)
            log.info("%s: globe trend written, period %s..%s, cells %s, %.0f s", vid, payload["period"]["start"],
                     payload["period"]["end"], payload["cell_counts"], time.monotonic() - started)
        except Exception as exc:
            log.exception("%s: globe trend failed (%s)", vid, type(exc).__name__)
            code = 1
    return code


if __name__ == "__main__":
    sys.exit(main())
