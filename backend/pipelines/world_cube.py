"""World cube (task 020): real monthly grids for the whole globe from NASA cloud OPeNDAP, sampled with a stride.

Usage (from the repository root):
    python -m backend.pipelines.world_cube --products merra2_t2m
    python -m backend.pipelines.world_cube --products merra2_t2m,airs,imerg,gldas --with-layers
    python -m backend.pipelines.world_cube --products omi_no2 --with-layers      # daily granules: slowest, last

Same steps as the Europe cube (CMR listing, one DAP4 subset per granule, resumable, fill values -> NaN),
but the subset is the whole globe with a stride (every k-th native cell along latitude and longitude),
so that the full native resolution of the world is not downloaded. The sampled cells are real native
cells; nothing is interpolated or averaged at this step. The stride per product is recorded in meta.json.
Output: DATA_DIR/cube/world/<variable_id>/{data.npy, meta.json, status.json}.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import logging
import os
import sys
import time
from pathlib import Path

import h5py
import httpx
import numpy as np

from backend.app.config import load_settings
from backend.app.logging_setup import setup_logging
from backend.app.storage import WORLD_BBOX, world_cube_dir, write_json_atomic
from backend.pipelines.europe_cube import (PRODUCTS, Product, dap4_url, list_granules, month_range, read_field,
                                           request_with_retries, utc_now)

log = logging.getLogger("world_cube")

# Native cells kept along each axis (every k-th), chosen for the 2° world grid of the globe layer.
STRIDES = {"merra2_t2m": 2, "airs": 1, "imerg": 5, "gldas": 2, "omi_no2": 4}
ORDER = ("merra2_t2m", "airs", "imerg", "gldas", "omi_no2")      # fastest first, NO2 (daily granules) last


def write_status(data_dir: Path, product: Product, **fields) -> None:
    for vid in product.variables:
        payload = {"product": f"{product.short_name} v{product.version}", "domain": "world",
                   "updated_at": utc_now(), **fields}
        write_json_atomic(world_cube_dir(data_dir, vid) / "status.json", payload)


async def world_window(client: httpx.AsyncClient, product: Product, granule_url: str, auth: dict, stride: int) -> dict:
    response = await request_with_retries(client, dap4_url(granule_url, f"{product.lat_path};{product.lon_path}"),
                                          headers=auth)
    with h5py.File(io.BytesIO(response.content), "r") as f:
        lat = np.asarray(f[product.lat_path.lstrip("/")][...], dtype="float64")
        lon = np.asarray(f[product.lon_path.lstrip("/")][...], dtype="float64")
    if product.coords_2d:
        lat, lon = lat[:, 0], lon[0, :]
    n_lat, n_lon = lat.size, lon.size
    return {"n_lat": int(n_lat), "n_lon": int(n_lon), "stride": stride,
            "native_step": {"lat": round(float(abs(lat[1] - lat[0])), 5), "lon": round(float(abs(lon[1] - lon[0])), 5)},
            "lat": lat[0::stride].tolist(), "lon": lon[0::stride].tolist()}


def world_constraint(product: Product, window: dict) -> str:
    s = window["stride"]
    index = {"time": "[0]", "lat": f"[0:{s}:{window['n_lat'] - 1}]", "lon": f"[0:{s}:{window['n_lon'] - 1}]"}
    return ";".join(path + "".join(index[d] for d in product.dims) for path in product.variables.values())


async def download(product: Product, settings, *, concurrency: int, limit: int | None, stride: int) -> dict:
    auth = {"Authorization": f"Bearer {settings.earthdata_token}"}
    raw = settings.raw_dir / "world_cube" / product.key
    raw.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(follow_redirects=True) as client:
        granules = await list_granules(client, product)
        if limit:
            granules = granules[:limit]
        window_file = raw / "window.json"
        window = json.loads(window_file.read_text(encoding="utf-8")) if window_file.is_file() else None
        if window is None or window.get("stride") != stride:
            window = await world_window(client, product, granules[0]["url"], auth, stride)
            window_file.write_text(json.dumps(window), encoding="utf-8")
            for old in raw.glob("*.nc4"):            # files of another stride are not comparable
                old.unlink()
        (raw / "granules.json").write_text(json.dumps(granules), encoding="utf-8")
        constraint = world_constraint(product, window)
        total = len(granules)
        todo = [g for g in granules if not (raw / f"{g['key']}.nc4").is_file()]
        done = total - len(todo)
        failed: dict[str, str] = {}
        log.info("%s: %d granules, %d already downloaded, %d to fetch (stride %d)", product.key, total, done,
                 len(todo), stride)
        write_status(settings.data_dir, product, status="downloading", done=done, total=total, failed=0)
        semaphore = asyncio.Semaphore(concurrency)
        started = time.monotonic()

        async def fetch(g: dict) -> None:
            nonlocal done
            async with semaphore:
                try:
                    response = await request_with_retries(client, dap4_url(g["url"], constraint), headers=auth,
                                                          timeout=180.0)
                except PermissionError:
                    raise
                except Exception as exc:  # recorded per granule; never fills data
                    failed[g["key"]] = type(exc).__name__
                    return
                tmp = raw / f".{g['key']}.part"
                tmp.write_bytes(response.content)
                os.replace(tmp, raw / f"{g['key']}.nc4")
                done += 1
                if done % 25 == 0 or done == total:
                    rate = (time.monotonic() - started) / max(1, done - (total - len(todo)))
                    log.info("%s: %d/%d downloaded (%.2f s per granule)", product.key, done, total, rate)
                    write_status(settings.data_dir, product, status="downloading", done=done, total=total,
                                 failed=len(failed))

        await asyncio.gather(*(fetch(g) for g in todo))
    return {"granules": granules, "window": window, "failed": failed}


def assemble(product: Product, settings, result: dict) -> None:
    raw = settings.raw_dir / "world_cube" / product.key
    window, granules, failed = result["window"], result["granules"], result["failed"]
    lat = np.asarray(window["lat"])
    lon = np.asarray(window["lon"])
    flip = lat[0] > lat[-1]
    if flip:
        lat = lat[::-1]
    keys = [g["key"] for g in granules]
    months = month_range(keys[0][:7], keys[-1][:7])
    n_lat, n_lon, n_t = lat.size, lon.size, len(months)
    write_status(settings.data_dir, product, status="assembling", done=len(keys), total=len(keys), failed=len(failed))
    for vid, dataset in product.variables.items():
        cube = np.full((n_lat, n_lon, n_t), np.nan, dtype="float32")
        counts = np.zeros((n_lat, n_lon, n_t), dtype="uint8") if product.daily else None
        sums = np.zeros((n_lat, n_lon, n_t), dtype="float64") if product.daily else None
        present: set[str] = set()
        for g in granules:
            path = raw / f"{g['key']}.nc4"
            if not path.is_file():
                continue
            field_ = read_field(path, dataset, product.dims)
            if flip:
                field_ = field_[::-1, :]
            t = months.index(g["key"][:7])
            present.add(g["key"][:7])
            if product.daily:
                valid = np.isfinite(field_)
                sums[:, :, t][valid] += field_[valid]
                counts[:, :, t][valid] += 1
            else:
                cube[:, :, t] = field_
        if product.daily:
            enough = counts >= product.min_valid_days
            cube[enough] = (sums[enough] / counts[enough]).astype("float32")
        target = world_cube_dir(settings.data_dir, vid)
        target.mkdir(parents=True, exist_ok=True)
        tmp = target / ".data.npy.part"
        with open(tmp, "wb") as f:
            np.save(f, cube)
        os.replace(tmp, target / "data.npy")
        failed_months = sorted({k[:7] for k in failed})
        meta = {
            "variable_id": vid,
            "product": {"short_name": product.short_name, "version": product.version,
                        "collection_concept_id": product.collection, "dataset": dataset},
            "source": "NASA GES DISC cloud OPeNDAP (DAP4 subsets with a stride)",
            "source_unit": product.units.get(vid),
            "layout": "data.npy: float32, shape (lat, lon, time); NaN = missing (fill value or no granule)",
            "domain": {"id": "world", "name": "World", "bbox": list(WORLD_BBOX)},
            "sampling": {"stride": window["stride"], "native_step_deg": window["native_step"],
                         "sampled_step_deg": {k: round(v * window["stride"], 5) for k, v in window["native_step"].items()},
                         "rule": "every k-th native cell along latitude and longitude; values are the native cells' own"},
            "lat": [round(float(x), 5) for x in lat],
            "lon": [round(float(x), 5) for x in lon],
            "times": months,
            "aggregation": (f"daily granules averaged to monthly means; month is NaN if fewer than "
                            f"{product.min_valid_days} valid days") if product.daily else None,
            "months_without_granule": [m for m in months if m not in present and m not in failed_months],
            "months_with_failed_downloads": failed_months,
            "granules_used": len([g for g in granules if (raw / f"{g['key']}.nc4").is_file()]),
            "assembled_at": utc_now(),
        }
        write_json_atomic(target / "meta.json", meta)
        status = "ready" if not failed else "partial"
        write_json_atomic(target / "status.json", {
            "product": f"{product.short_name} v{product.version}", "domain": "world", "status": status,
            "done": meta["granules_used"], "total": len(granules), "failed": len(failed),
            "months": n_t, "shape": [n_lat, n_lon, n_t], "updated_at": utc_now()})
        log.info("%s/%s: assembled %s, status %s, failed granules %d", product.key, vid, (n_lat, n_lon, n_t),
                 status, len(failed))


async def run_product(key: str, settings, concurrency: int, limit: int | None) -> int:
    product = PRODUCTS[key]
    try:
        result = await download(product, settings, concurrency=concurrency, limit=limit, stride=STRIDES[key])
        if result["failed"]:                         # one more pass for granules that failed (resumable)
            log.info("%s: retrying %d failed granules", key, len(result["failed"]))
            result = await download(product, settings, concurrency=concurrency, limit=limit, stride=STRIDES[key])
        assemble(product, settings, result)
        return 0
    except PermissionError as exc:
        log.error("%s: %s — check the Earthdata token", key, exc)
        write_status(settings.data_dir, product, status="failed", reason="source_rejected")
        return 3
    except Exception as exc:
        log.exception("%s failed: %s", key, type(exc).__name__)
        write_status(settings.data_dir, product, status="failed", reason=type(exc).__name__)
        return 1


def build_layers(variables: list[str], prepared: bool) -> int:
    from backend.pipelines import europe_globe, europe_globe_trend
    args = ["--domain", "world", "--variables", ",".join(variables)] + (["--prepared"] if prepared else [])
    code = europe_globe.main(args)
    return europe_globe_trend.main(args) or code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--products", default=",".join(ORDER[:-1]), help=f"comma-separated: {', '.join(ORDER)}")
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--limit", type=int, default=None, help="only the first N granules (testing)")
    parser.add_argument("--with-layers", action="store_true",
                        help="after each product: build its world globe frames and trend (+ prepared copies)")
    args = parser.parse_args(argv)
    settings = load_settings()
    setup_logging(settings.log_level, settings.secrets)
    if not settings.token_configured:
        log.error("EARTHDATA_TOKEN is not configured; nothing downloaded")
        return 2
    code = 0
    for key in [k.strip() for k in args.products.split(",") if k.strip()]:
        if key not in PRODUCTS:
            parser.error(f"unknown product: {key}")
        rc = asyncio.run(run_product(key, settings, args.concurrency, args.limit))
        code = code or rc
        if rc == 0 and args.with_layers:              # publish this product right away
            code = build_layers(list(PRODUCTS[key].variables), prepared=True) or code
    return code


if __name__ == "__main__":
    sys.exit(main())
