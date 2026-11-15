"""Globe frames for Europe (format globe-1, task 017) computed from the real Europe cube.

Usage (from the repository root, after the cube is ready):
    python -m backend.pipelines.europe_globe                    # all 7 variables
    python -m backend.pipelines.europe_globe --variables t2m --prepared
    python -m backend.pipelines.europe_globe --domain world --variables t2m --prepared   # 2° world layer (task 020)

For every native cube cell: monthly values in display units -> anomalies from the cell's own
monthly climatology over the full record (the same rule as a point analysis without a period)
-> annual anomalies (mean of the monthly anomalies; valid only with >= 10 valid months, >= 6 for
OMI NO2 — see backend.app.annual).
The globe shows one common 1° grid for all variables: the value of a 1° cell is the
cos-latitude weighted mean of the annual anomalies of the native cells whose centres lie in
that 1° box, valid only if at least half of the native cells that have data are valid.
Nothing is interpolated or filled: a missing value is null.
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from backend.app import annual, catalog, stats
from backend.app.config import load_settings
from backend.app.series import to_display_units
from backend.app.storage import DOMAINS, domain_cube_dir, globe_path, read_json, write_json_atomic

log = logging.getLogger("europe_globe")
PROCESSING_VERSION = "globe-1"
MIN_BOX_FRACTION = 0.5     # of the native cells with data in a 1° box
MIN_SD_YEARS = 10          # valid years needed for the interannual standard deviation
STATUS_CODES = {"0": "ok", "1": "no_data"}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def monthly_anomalies(values: np.ndarray, times: list[str]) -> np.ndarray:
    """Same rule as stats.anomalies, vectorised over cells (last axis = time)."""
    months = np.array([int(t[5:7]) for t in times])
    anom = np.full(values.shape, np.nan)
    for m in range(1, 13):
        sel = np.where(months == m)[0]
        if sel.size == 0:
            continue
        block = values[..., sel]
        valid = np.isfinite(block)
        n = valid.sum(axis=-1)
        with np.errstate(invalid="ignore", divide="ignore"):
            mean = np.where(valid, block, 0.0).sum(axis=-1) / n
        mean = np.where(n >= stats.MIN_PER_CALENDAR_MONTH, mean, np.nan)
        anom[..., sel] = block - mean[..., None]
    return anom


def box_index(coords: np.ndarray, start: float, step: float, n: int) -> np.ndarray:
    """Box of each native cell centre; centres on the far domain edge go to the last box."""
    return np.clip(np.floor((np.asarray(coords, dtype=float) - start) / step + 1e-9).astype(int), 0, n - 1)


def choose_scale(limit: float | None) -> float:
    """Integer encoding step: 3 significant digits at the legend limit."""
    if not limit or not math.isfinite(limit) or limit <= 0:
        return 0.001
    return 10.0 ** (math.floor(math.log10(limit)) - 3)


def encode(values: np.ndarray, scale: float) -> list[int | None]:
    return [None if not math.isfinite(v) else int(round(v / scale)) for v in values.tolist()]


def domain_fields(domain: str, meta: dict) -> dict:
    """Grid, bbox and wording of a domain (Europe 1° from the Europe cube, World 2° from the strided world cube)."""
    d = DOMAINS[domain]
    g = d["grid"]
    size = f"{g['dlat']:g}°"
    sampling = meta.get("sampling")
    return {"grid": g, "bbox": d["bbox"], "size": size,
            "domain": {"id": d["id"], "name": d["name"], "bbox": list(d["bbox"])},
            "source": ("Europe cube from NASA GES DISC cloud OPeNDAP" if domain == "europe"
                       else "World cube from NASA GES DISC cloud OPeNDAP, native cells sampled with a stride"),
            "sampling": (None if not sampling else
                         {"stride": sampling["stride"], "sampled_step_deg": sampling["sampled_step_deg"],
                          "rule": "every k-th native cell along latitude and longitude (real native cells, "
                                  "not interpolated); the box mean uses these sampled cells"})}


def build_globe(variable_id: str, data_dir: Path, domain: str = "europe") -> dict:
    folder = domain_cube_dir(data_dir, domain, variable_id)
    meta = read_json(folder / "meta.json")
    status = read_json(folder / "status.json") or {}
    if not meta or status.get("status") != "ready":
        raise RuntimeError(f"cube for {variable_id} is not ready")
    variable = catalog.get_variable(variable_id)
    cube = np.load(folder / "data.npy", mmap_mode="r")
    lat = np.asarray(meta["lat"], dtype=float)
    lon = np.asarray(meta["lon"], dtype=float)
    times: list[str] = meta["times"]
    dom = domain_fields(domain, meta)
    g = dom["grid"]
    nrow, ncol = g["shape"]
    west, south = dom["bbox"][0], dom["bbox"][1]
    row_of = box_index(lat, south, g["dlat"], nrow)
    col_of = box_index(lon, west, g["dlon"], ncol)
    cols_in_box = [np.where(col_of == c)[0] for c in range(ncol)]

    need = annual.min_valid_months(variable_id)
    all_years, _ = annual.year_groups(times)
    _, _, _, months_in_record = annual.annual_means(times, np.zeros((1, len(times))), need)
    keep = [k for k, m in enumerate(months_in_record) if m >= need]
    years = [all_years[k] for k in keep]
    ny = len(years)

    frames = np.full((nrow, ncol, ny), np.nan)
    native_with_data = np.zeros((nrow, ncol), dtype=int)
    native_per_box = np.zeros((nrow, ncol), dtype=int)
    for r in range(nrow):
        rows = np.where(row_of == r)[0]
        if rows.size == 0:
            continue
        values = to_display_units(variable_id, times, np.asarray(cube[rows], dtype="float64"))
        has_data = np.isfinite(values).any(axis=-1)
        _, yearly, _, _ = annual.annual_means(times, monthly_anomalies(values, times), need)
        yearly = yearly[..., keep]
        w = np.cos(np.deg2rad(lat[rows]))[:, None, None]
        for c, cols in enumerate(cols_in_box):
            if cols.size == 0:
                continue
            block = yearly[:, cols, :]                           # (native rows, native cols, years)
            data_cells = int(has_data[:, cols].sum())
            native_per_box[r, c] = rows.size * cols.size
            native_with_data[r, c] = data_cells
            if data_cells == 0:
                continue
            valid = np.isfinite(block)
            weights = np.where(valid, w, 0.0)
            wsum = weights.sum(axis=(0, 1))
            with np.errstate(invalid="ignore", divide="ignore"):
                mean = (np.where(valid, block, 0.0) * w).sum(axis=(0, 1)) / wsum
            enough = valid.sum(axis=(0, 1)) >= MIN_BOX_FRACTION * data_cells
            frames[r, c, :] = np.where(enough & (wsum > 0), mean, np.nan)

    flat = frames.reshape(nrow * ncol, ny)
    n_valid_years = np.isfinite(flat).sum(axis=1)
    sd = np.full(flat.shape[0], np.nan)
    enough_years = n_valid_years >= MIN_SD_YEARS
    if enough_years.any():
        sd[enough_years] = np.nanstd(flat[enough_years], axis=1, ddof=1)
    finite = np.abs(flat[np.isfinite(flat)])
    limit = float(np.percentile(finite, 98)) if finite.size else None
    scale = choose_scale(limit)
    decimals = max(0, -int(math.floor(math.log10(scale))))
    cell_status = np.where(native_with_data.reshape(-1) == 0, 1, 0)

    first_valid = next(k for k in range(len(times)) if np.isfinite(cube[..., k]).any())
    last_valid = next(k for k in range(len(times) - 1, -1, -1) if np.isfinite(cube[..., k]).any())
    native = variable["native_resolution"]
    return {
        "status": "ok",
        "format_version": PROCESSING_VERSION,
        "variable_id": variable_id,
        "unit": variable["unit"],
        "product": {"product": variable["source"]["product"], "version": variable["source"]["version"],
                    "doi": variable["source"]["doi"], "mission_or_model": variable["source"]["mission_or_model"]},
        "provenance": {"source": dom["source"],
                       "cube_assembled_at": meta.get("assembled_at"), "computed_at": utc_now(),
                       "processing_version": PROCESSING_VERSION, "statistics_version": stats.PROCESSING_VERSION},
        "domain": dom["domain"],
        "grid": {"shape": [nrow, ncol], "lat0": g["lat0"], "dlat": g["dlat"], "lon0": g["lon0"], "dlon": g["dlon"],
                 "order": "row-major, row 0 = southernmost latitude, column 0 = westernmost longitude",
                 "cell_reference": "center",
                 "aggregation": {
                     "native_resolution_deg": {"lat": native["lat_deg"], "lon": native["lon_deg"]},
                     "method": (f"cos-latitude weighted mean of the annual anomalies of the native cube cells whose "
                                f"centres lie in the {dom['size']} box (centres on the north / east domain edge belong "
                                f"to the last row / column)"),
                     "valid_rule": (f"a {dom['size']} cell is valid in a year only if at least "
                                    f"{int(MIN_BOX_FRACTION * 100)} % of its native cells that have data are valid; "
                                    f"otherwise null"),
                     "sampling": dom["sampling"],
                     "native_cells_per_box": {"min": int(native_per_box[native_per_box > 0].min()),
                                              "max": int(native_per_box.max())},
                     "why": "one grid for all seven variables; native resolution stays in point analyses and maps"}},
        "baseline": {"kind": "full_record",
                     "name": "each native cell's own monthly climatology over the full record of the product",
                     "period": {"start": times[first_valid], "end": times[last_valid]},
                     "rule": (f"mean of each calendar month over the record; at least "
                              f"{stats.MIN_PER_CALENDAR_MONTH} values per calendar month, otherwise null")},
        "annual": {"rule": annual.rule(variable_id), "min_valid_months": need},
        "years": years,
        "months_in_record": [months_in_record[k] for k in keep],
        "encoding": {"scale": scale, "decimals": decimals,
                     "rule": "anomaly = integer x scale, in unit; null = no valid value (never zero)"},
        "frames": [encode(flat[:, k], scale) for k in range(ny)],
        "cell_sd": encode(sd, scale),
        "cell_sd_rule": (f"sample standard deviation of the cell's annual anomalies over its valid years "
                         f"(at least {MIN_SD_YEARS}); for colouring in standard deviations"),
        "cell_status": cell_status.tolist(),
        "status_codes": STATUS_CODES,
        "cell_counts": {"ok": int((cell_status == 0).sum()), "no_data": int((cell_status == 1).sum())},
        "legend": {"center": 0, "range": [-stats.sig(limit, 3), stats.sig(limit, 3)] if limit else None,
                   "rule": "symmetric around 0; limit = 98th percentile of |annual anomaly| over all cells and years"},
        "computed_at": utc_now(),
        "processing_version": PROCESSING_VERSION,
    }


def write_prepared(prepared_dir: Path, variable_id: str, payload: dict, domain: str = "europe") -> Path:
    path = Path(prepared_dir) / "globe" / domain / f"{variable_id}.json.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variables", default=",".join(catalog.CORE_VARIABLE_IDS))
    parser.add_argument("--domain", choices=sorted(DOMAINS), default="europe")
    parser.add_argument("--prepared", action="store_true",
                        help="also write the gzip copy shipped with the code (data/prepared/globe/<domain>)")
    args = parser.parse_args(argv)
    settings = load_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    code = 0
    for vid in [v.strip() for v in args.variables.split(",") if v.strip()]:
        try:
            started = time.monotonic()
            payload = build_globe(vid, settings.data_dir, args.domain)
            write_json_atomic(globe_path(settings.data_dir, vid, args.domain), payload)
            if args.prepared:
                write_prepared(settings.prepared_dir, vid, payload, args.domain)
            log.info("%s/%s: globe frames written, years %s-%s, cells %s, %.0f s", args.domain, vid, payload["years"][0],
                     payload["years"][-1], payload["cell_counts"], time.monotonic() - started)
        except Exception as exc:
            log.exception("%s: globe frames failed (%s)", vid, type(exc).__name__)
            code = 1
    return code


if __name__ == "__main__":
    sys.exit(main())
