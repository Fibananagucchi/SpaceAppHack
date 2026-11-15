"""Globe "Changes" layer (format changes-1, task 022): a possible abrupt change in every globe cell.

Usage (from the repository root, after the cubes are ready):
    python -m backend.pipelines.globe_changes --domain europe --prepared        # 1° Europe, 7 variables
    python -m backend.pipelines.globe_changes --domain world --variables precip --prepared

For every cell of the Europe 1° / World 2° grid:
  1. the same aggregated monthly anomaly series as the globe trend layers (europe_globe_trend.box_monthly_anomalies);
  2. the same change-point decision as a point analysis (breaks.decide_change: sufficiency, Pettitt, then BIC step vs
     straight line) -> detected / inconclusive / not_distinct_from_trend / not_detected;
  3. for detected and inconclusive cells, the same ordered category rules as mode 2, without the measured features:
     R1 a documented product boundary within 12 months -> possible data artifact; R2 / R3 a match with the curated known
     events (variable, window, event box overlapping the cell, direction where stated) -> natural / human; R4 otherwise
     cause undetermined. A boundary and an event together keep R1 in `category` and set `coinciding`.
"Consistent with" only; nothing is filled or interpolated.
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from backend.app import catalog, known_events, stats
from backend.app.breaks import BOUNDARY_WINDOW_MONTHS, PROCESSING_VERSION as BREAKS_VERSION, decide_change
from backend.app.storage import DOMAINS, domain_cube_dir, globe_changes_path, read_json, write_json_atomic
from backend.pipelines.europe_globe import domain_fields, utc_now
from backend.pipelines.europe_globe_trend import box_monthly_anomalies

log = logging.getLogger("globe_changes")
PROCESSING_VERSION = "changes-1"
STATUS_CODES = {"0": "not_detected", "1": "detected", "2": "inconclusive", "3": "not_distinct_from_trend",
                "4": "insufficient_for_test", "5": "no_data"}
STATUS_OF = {v: int(k) for k, v in STATUS_CODES.items()}
CATEGORY_CODES = {"0": "possible_data_artifact", "1": "consistent_with_natural_event",
                  "2": "consistent_with_human_influence", "3": "cause_undetermined"}
RULES_TEXT = [
    f"R1 possible data artifact: the change lies within {BOUNDARY_WINDOW_MONTHS} months of a documented change of "
    "the data product",
    "R2 consistent with a natural event: the change matches a natural event of the curated list (variable, time "
    "window, event area overlapping the cell, direction where the source states it)",
    "R3 consistent with human influence: the same for a human-caused event",
    "R4 cause undetermined: none of the above",
]


def _month_diff(a: str, b: str) -> int:
    return (int(a[:4]) - int(b[:4])) * 12 + int(a[5:7]) - int(b[5:7])


def classify(variable_id: str, month: str, shift: float, cell_bbox: list[float],
             boundaries: list[dict]) -> tuple[int, str | None, str | None, bool]:
    """(category code, boundary_id, event_id, coinciding) by the ordered mode 2 rules (no features)."""
    near = sorted((b for b in boundaries if abs(_month_diff(b["date"], month)) <= BOUNDARY_WINDOW_MONTHS),
                  key=lambda b: abs(_month_diff(b["date"], month)))
    events = known_events.match(variable_id, month, {"type": "area", "requested": {"bbox": cell_bbox}}, shift)
    natural = [e for e in events if e["type"] == "natural"]
    human = [e for e in events if e["type"] == "human"]
    event = (natural or human or [None])[0]
    event_id = event["event_id"] if event else None
    if near:
        return 0, near[0]["boundary_id"], event_id, event is not None
    if natural:
        return 1, None, event_id, False
    if human:
        return 2, None, event_id, False
    return 3, None, None, False


def _cells_worker(args: tuple) -> list[tuple]:
    variable_id, times, rows, flat_indices, cell_boxes, boundaries = args
    t_all = stats.month_offsets(times)
    out = []
    for anom, flat, box in zip(rows, flat_indices, cell_boxes):
        anom = np.asarray(anom, dtype=float)
        if not np.isfinite(anom).any():
            out.append((flat, STATUS_OF["no_data"], None))
            continue
        if stats.sufficiency(anom):
            out.append((flat, STATUS_OF["insufficient_for_test"], None))
            continue
        valid = np.isfinite(anom)
        t, x = t_all[valid], anom[valid]
        decision = decide_change(t, x)
        if decision is None:
            out.append((flat, STATUS_OF["insufficient_for_test"], None))
            continue
        status = decision["status"]
        if status not in ("detected", "inconclusive"):
            out.append((flat, STATUS_OF[status], None))
            continue
        k = decision["pettitt"]["index"]
        month = times[int(t[k + 1])]                       # first month after the change, as for a point
        shift = float(np.median(x[k + 1:]) - np.median(x[: k + 1]))
        category, boundary_id, event_id, coinciding = classify(variable_id, month, shift, box, boundaries)
        out.append((flat, STATUS_OF[status], {"month": month, "shift": stats.sig(shift, 4),
                                              "p_value": stats.sig(decision["pettitt"]["p"], 3),
                                              "category": category, "boundary_id": boundary_id,
                                              "event_id": event_id, "coinciding": coinciding}))
    return out


def build_changes(variable_id: str, data_dir: Path, domain: str = "europe", workers: int = 1) -> dict:
    folder = domain_cube_dir(data_dir, domain, variable_id)
    meta = read_json(folder / "meta.json")
    status = read_json(folder / "status.json") or {}
    if not meta or status.get("status") != "ready":
        raise RuntimeError(f"{domain} cube for {variable_id} is not ready")
    variable = catalog.get_variable(variable_id)
    cube = np.load(folder / "data.npy", mmap_mode="r")
    lat = np.asarray(meta["lat"], dtype=float)
    lon = np.asarray(meta["lon"], dtype=float)
    times: list[str] = meta["times"]
    series, with_data, per_box = box_monthly_anomalies(variable_id, cube, lat, lon, times, domain)
    dom = domain_fields(domain, meta)
    g, bbox = dom["grid"], dom["bbox"]
    nrow, ncol = g["shape"]
    n = nrow * ncol
    valid_any = np.isfinite(series).any(axis=0)
    first = int(np.argmax(valid_any))
    last = int(len(times) - 1 - np.argmax(valid_any[::-1]))
    start, end = times[first], times[last]
    boundaries = [b for b in catalog.product_boundaries(variable_id) if start < b["date"] <= end]

    def cell_box(k: int) -> list[float]:
        r, c = divmod(k, ncol)
        south, west = bbox[1] + r * g["dlat"], bbox[0] + c * g["dlon"]
        return [west, south, west + g["dlon"], south + g["dlat"]]

    chunk = 400
    tasks = [(variable_id, times, series[s:s + chunk], list(range(s, min(s + chunk, n))),
              [cell_box(k) for k in range(s, min(s + chunk, n))], boundaries) for s in range(0, n, chunk)]
    if workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(_cells_worker, tasks))
    else:
        results = [_cells_worker(t) for t in tasks]

    cell_status = np.full(n, STATUS_OF["no_data"], dtype=int)
    columns: dict[str, list] = {k: [] for k in ("cell", "status", "month", "shift", "p_value", "category",
                                                "boundary_id", "event_id", "coinciding")}
    for result in results:
        for flat, code, change in result:
            cell_status[flat] = code
            if change is not None:
                columns["cell"].append(flat)
                columns["status"].append(code)
                for key in ("month", "shift", "p_value", "category", "boundary_id", "event_id", "coinciding"):
                    columns[key].append(change[key])
    cell_status[with_data == 0] = STATUS_OF["no_data"]
    by_status = {name: int((cell_status == int(code)).sum()) for code, name in STATUS_CODES.items()}
    by_category = {name: sum(1 for c in columns["category"] if c == int(code)) for code, name in CATEGORY_CODES.items()}
    detected_by_category = {name: sum(1 for c, s in zip(columns["category"], columns["status"])
                                      if c == int(code) and s == STATUS_OF["detected"])
                            for code, name in CATEGORY_CODES.items()}
    return {
        "status": "ok",
        "format_version": PROCESSING_VERSION,
        "variable_id": variable_id,
        "domain": dom["domain"],
        "unit": variable["unit"],
        "product": {"product": variable["source"]["product"], "version": variable["source"]["version"],
                    "doi": variable["source"]["doi"]},
        "provenance": {"source": dom["source"], "cube_assembled_at": meta.get("assembled_at"), "computed_at": utc_now(),
                       "processing_version": PROCESSING_VERSION, "breaks_version": BREAKS_VERSION,
                       "statistics_version": stats.PROCESSING_VERSION},
        "grid": {"shape": [nrow, ncol], "lat0": g["lat0"], "dlat": g["dlat"], "lon0": g["lon0"], "dlon": g["dlon"],
                 "order": "row-major, row 0 = southernmost latitude, column 0 = westernmost longitude",
                 "cell_reference": "center",
                 "aggregation": {"method": (f"the same {dom['size']} series as the globe trend layer: cos-latitude "
                                            f"weighted mean of the native cells' monthly anomalies, a month valid "
                                            f"with >= 50 % of the cells that have data"),
                                 "sampling": dom["sampling"],
                                 "native_cells_per_box": {"min": int(per_box[per_box > 0].min()),
                                                          "max": int(per_box.max())}}},
        "period": {"start": start, "end": end},
        "method": {"change_point": ("the same rule as a point analysis (breaks-1): Pettitt single change point on "
                                    "monthly anomalies, then BIC step vs straight line for a significant result"),
                   "sufficiency": (f">= {stats.MIN_VALID_MONTHS} valid months and >= "
                                   f"{int(stats.MIN_VALID_FRACTION * 100)} % valid"),
                   "shift": "median of anomalies after minus before the change, in unit",
                   "month": "first month after the change",
                   "note": ("one change per cell; Pettitt p-values assume independent months and are not corrected "
                            "for testing many cells, so a mark is a candidate to inspect, not a finding")},
        "rules": {"order": ["R1", "R2", "R3", "R4"], "text": RULES_TEXT,
                  "boundary_window_months": BOUNDARY_WINDOW_MONTHS,
                  "boundaries_in_period": [{"boundary_id": b["boundary_id"], "date": b["date"], "kind": b["kind"],
                                            "title": b["title"], "reference": b["reference"]} for b in boundaries],
                  "known_events_version": known_events.load_events()["list_version"],
                  "coinciding": "a documented boundary and a known event both fit: category keeps R1, both are shown"},
        "status_codes": STATUS_CODES,
        "category_codes": CATEGORY_CODES,
        "cell_status": cell_status.tolist(),
        "changes": columns,
        "counts": {"by_status": by_status, "changes_by_category": by_category,
                   "detected_by_category": detected_by_category},
        "computed_at": utc_now(),
        "processing_version": PROCESSING_VERSION,
    }


def write_prepared(prepared_dir: Path, variable_id: str, payload: dict, domain: str) -> Path:
    path = Path(prepared_dir) / "globe" / domain / "changes" / f"{variable_id}.json.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    return path


def main(argv: list[str] | None = None) -> int:
    from backend.app.config import load_settings
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--domain", choices=sorted(DOMAINS), default="europe")
    parser.add_argument("--variables", default=",".join(catalog.CORE_VARIABLE_IDS))
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--prepared", action="store_true")
    args = parser.parse_args(argv)
    settings = load_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    code = 0
    for vid in [v.strip() for v in args.variables.split(",") if v.strip()]:
        try:
            started = time.monotonic()
            payload = build_changes(vid, settings.data_dir, args.domain, args.workers)
            write_json_atomic(globe_changes_path(settings.data_dir, vid, args.domain), payload)
            if args.prepared:
                write_prepared(settings.prepared_dir, vid, payload, args.domain)
            log.info("%s/%s: changes written, %s, detected by category %s, %.0f s", args.domain, vid,
                     payload["counts"]["by_status"], payload["counts"]["detected_by_category"],
                     time.monotonic() - started)
        except Exception as exc:
            log.exception("%s/%s: changes failed (%s)", args.domain, vid, type(exc).__name__)
            code = 1
    return code


if __name__ == "__main__":
    sys.exit(main())
