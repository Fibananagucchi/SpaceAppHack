"""Europe cube: download real monthly grids for Europe from NASA cloud OPeNDAP and assemble them.

Usage (from the repository root):
    python -m backend.pipelines.europe_cube                       # merra2_t2m, imerg, gldas, airs
    python -m backend.pipelines.europe_cube --products omi_no2    # NO2 last (7800 daily granules)
    python -m backend.pipelines.europe_cube --products gldas --limit 3   # quick test

What it does, per product:
  1. lists granules in NASA CMR (with retries; CMR sometimes resets connections);
  2. reads the product's latitude/longitude once and finds the Europe index window;
  3. downloads one small DAP4 subset per granule into RAW_DIR/europe_cube/<product>/ (resumable);
  4. assembles DATA_DIR/cube/europe/<variable_id>/data.npy (float32, shape lat x lon x time,
     NaN = missing) with meta.json and status.json.

Nothing is interpolated, filled or invented. Fill values become NaN. Months without a granule,
and granules that failed to download, are listed separately in meta.json.
The Earthdata token is read from the environment and is never printed.
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
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import h5py
import httpx
import numpy as np

from backend.app.config import load_settings
from backend.app.logging_setup import setup_logging
from backend.app.storage import EUROPE_BBOX, cube_dir, write_json_atomic

log = logging.getLogger("europe_cube")

CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.json"


@dataclass(frozen=True)
class Product:
    key: str
    collection: str
    short_name: str
    version: str
    variables: dict[str, str]          # variable_id -> dataset path in the granule
    lat_path: str
    lon_path: str
    dims: tuple[str, ...]              # order of the data variable's dimensions
    coords_2d: bool = False            # latitude/longitude stored as 2-D arrays
    daily: bool = False                # daily granules aggregated to monthly means
    min_valid_days: int = 10           # for daily products
    units: dict[str, str] = field(default_factory=dict)


PRODUCTS: dict[str, Product] = {
    "merra2_t2m": Product(
        key="merra2_t2m", collection="C1276812823-GES_DISC", short_name="M2IMNXASM", version="5.12.4",
        variables={"t2m": "/T2M"}, lat_path="/lat", lon_path="/lon", dims=("time", "lat", "lon"),
        units={"t2m": "K"}),
    "imerg": Product(
        key="imerg", collection="C2723754851-GES_DISC", short_name="GPM_3IMERGM", version="07",
        variables={"precip": "/Grid/precipitation"}, lat_path="/Grid/lat", lon_path="/Grid/lon",
        dims=("time", "lon", "lat"), units={"precip": "mm/hr"}),
    "gldas": Product(
        key="gldas", collection="C1342986036-GES_DISC", short_name="GLDAS_NOAH025_M", version="2.1",
        variables={"soil_moisture": "/SoilMoi0_10cm_inst", "evapotranspiration": "/Evap_tavg",
                   "surface_runoff": "/Qs_acc"},
        lat_path="/lat", lon_path="/lon", dims=("time", "lat", "lon"),
        units={"soil_moisture": "kg m-2", "evapotranspiration": "kg m-2 s-1", "surface_runoff": "kg m-2"}),
    "airs": Product(
        key="airs", collection="C1701805662-GES_DISC", short_name="AIRS3STM", version="7.0",
        variables={"airs_surface_air_temp": "/ascending/Data_Fields/SurfAirTemp_A"},
        lat_path="/location/Data_Fields/Latitude", lon_path="/location/Data_Fields/Longitude",
        dims=("lat", "lon"), coords_2d=True, units={"airs_surface_air_temp": "K"}),
    "omi_no2": Product(
        key="omi_no2", collection="C1266136111-GES_DISC", short_name="OMNO2d", version="003",
        variables={"no2_tropo": "/HDFEOS/GRIDS/ColumnAmountNO2/Data_Fields/ColumnAmountNO2TropCloudScreened"},
        lat_path="/HDFEOS/GRIDS/ColumnAmountNO2/YDim", lon_path="/HDFEOS/GRIDS/ColumnAmountNO2/XDim",
        dims=("lat", "lon"), daily=True, units={"no2_tropo": "molecules/cm2"}),
}
DEFAULT_ORDER = ("merra2_t2m", "imerg", "gldas", "airs")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------------------------
async def request_with_retries(client: httpx.AsyncClient, url: str, *, headers=None, params=None,
                               tries: int = 6, timeout: float = 120.0) -> httpx.Response:
    last_error = "unknown"
    for attempt in range(tries):
        try:
            response = await client.get(url, headers=headers, params=params, timeout=timeout)
            if response.status_code == 200:
                return response
            if response.status_code in (401, 403):
                raise PermissionError(f"source rejected the request (HTTP {response.status_code})")
            last_error = f"HTTP {response.status_code}"
        except httpx.HTTPError as exc:
            last_error = type(exc).__name__
        await asyncio.sleep(min(60, 2 * 2 ** attempt))
    raise ConnectionError(f"request failed after {tries} attempts ({last_error})")


async def list_granules(client: httpx.AsyncClient, product: Product) -> list[dict]:
    granules: list[dict] = []
    search_after: str | None = None
    while True:
        headers = {"CMR-Search-After": search_after} if search_after else None
        response = await request_with_retries(client, CMR_GRANULES, headers=headers, params={
            "collection_concept_id": product.collection, "page_size": 2000, "sort_key": "start_date"})
        entries = response.json()["feed"]["entry"]
        for e in entries:
            opendap = [l["href"] for l in e.get("links", []) if "opendap.earthdata.nasa.gov" in l.get("href", "")]
            if not opendap:
                continue
            start = e["time_start"][:10]
            granules.append({"key": start if product.daily else start[:7], "title": e["title"], "url": opendap[0]})
        search_after = response.headers.get("CMR-Search-After")
        if not entries or not search_after:
            break
    # One granule per period key; duplicates (reprocessed files) are reported, the last one is kept.
    by_key: dict[str, dict] = {}
    duplicates = []
    for g in granules:
        if g["key"] in by_key:
            duplicates.append(g["key"])
        by_key[g["key"]] = g
    if duplicates:
        log.warning("%s: %d duplicate period keys in CMR listing (kept last): %s",
                    product.key, len(duplicates), duplicates[:5])
    return [by_key[k] for k in sorted(by_key)]


def dap4_url(granule_url: str, constraint: str) -> str:
    return f"{granule_url}.dap.nc4?dap4.ce={quote(constraint, safe='/;:')}"


# ---------------------------------------------------------------------------------------------
# Grid window
# ---------------------------------------------------------------------------------------------
async def europe_window(client: httpx.AsyncClient, product: Product, granule_url: str, auth: dict) -> dict:
    constraint = f"{product.lat_path};{product.lon_path}"
    response = await request_with_retries(client, dap4_url(granule_url, constraint), headers=auth)
    with h5py.File(io.BytesIO(response.content), "r") as f:
        lat = np.asarray(f[product.lat_path.lstrip("/")][...], dtype="float64")
        lon = np.asarray(f[product.lon_path.lstrip("/")][...], dtype="float64")
    if product.coords_2d:
        lat, lon = lat[:, 0], lon[0, :]
    west, south, east, north = EUROPE_BBOX
    lat_idx = np.where((lat >= south) & (lat <= north))[0]
    lon_idx = np.where((lon >= west) & (lon <= east))[0]
    if lat_idx.size == 0 or lon_idx.size == 0:
        raise ValueError(f"{product.key}: Europe window is empty")
    if np.any(np.diff(lat_idx) != 1) or np.any(np.diff(lon_idx) != 1):
        raise ValueError(f"{product.key}: Europe window is not contiguous")
    return {
        "i0": int(lat_idx[0]), "i1": int(lat_idx[-1]), "j0": int(lon_idx[0]), "j1": int(lon_idx[-1]),
        "lat": lat[lat_idx].tolist(), "lon": lon[lon_idx].tolist(),
    }


def subset_constraint(product: Product, window: dict) -> str:
    index = {"time": "[0]", "lat": f"[{window['i0']}:{window['i1']}]", "lon": f"[{window['j0']}:{window['j1']}]"}
    parts = [path + "".join(index[d] for d in product.dims) for path in product.variables.values()]
    return ";".join(parts)


# ---------------------------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------------------------
def write_status(data_dir: Path, product: Product, **fields) -> None:
    for vid in product.variables:
        payload = {"product": f"{product.short_name} v{product.version}", "updated_at": utc_now(), **fields}
        write_json_atomic(cube_dir(data_dir, vid) / "status.json", payload)


async def download(product: Product, settings, *, concurrency: int, limit: int | None) -> dict:
    auth = {"Authorization": f"Bearer {settings.earthdata_token}"}
    raw = settings.raw_dir / "europe_cube" / product.key
    raw.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(follow_redirects=True) as client:
        granules = await list_granules(client, product)
        if limit:
            granules = granules[:limit]
        window_file = raw / "window.json"
        if window_file.is_file():
            window = json.loads(window_file.read_text(encoding="utf-8"))
        else:
            window = await europe_window(client, product, granules[0]["url"], auth)
            window_file.write_text(json.dumps(window), encoding="utf-8")
        (raw / "granules.json").write_text(json.dumps(granules), encoding="utf-8")
        constraint = subset_constraint(product, window)
        total = len(granules)
        todo = [g for g in granules if not (raw / f"{g['key']}.nc4").is_file()]
        done = total - len(todo)
        failed: dict[str, str] = {}
        log.info("%s: %d granules, %d already downloaded, %d to fetch", product.key, total, done, len(todo))
        write_status(settings.data_dir, product, status="downloading", done=done, total=total, failed=0)
        semaphore = asyncio.Semaphore(concurrency)
        started = time.monotonic()

        async def fetch(g: dict) -> None:
            nonlocal done
            async with semaphore:
                try:
                    response = await request_with_retries(client, dap4_url(g["url"], constraint), headers=auth)
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
                    log.info("%s: %d/%d downloaded (%.1f s per granule)", product.key, done, total, rate)
                    write_status(settings.data_dir, product, status="downloading", done=done, total=total,
                                 failed=len(failed))

        await asyncio.gather(*(fetch(g) for g in todo))
    return {"granules": granules, "window": window, "failed": failed}


# ---------------------------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------------------------
def month_range(first: str, last: str) -> list[str]:
    y, m = int(first[:4]), int(first[5:7])
    out = []
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def read_field(path: Path, dataset: str, dims: tuple[str, ...]) -> np.ndarray:
    """Return a (lat, lon) float32 field with fill values replaced by NaN."""
    with h5py.File(path, "r") as f:
        ds = f[dataset.lstrip("/")]
        values = np.asarray(ds[...], dtype="float64")
        attrs = {k: ds.attrs[k] for k in ds.attrs}
    for key in ("_FillValue", "missing_value"):
        if key in attrs:
            fill = float(np.asarray(attrs[key]).ravel()[0])
            values[np.isclose(values, fill, rtol=1e-6)] = np.nan
    scale = float(np.asarray(attrs.get("scale_factor", 1.0)).ravel()[0])
    offset = float(np.asarray(attrs.get("add_offset", 0.0)).ravel()[0])
    if scale != 1.0 or offset != 0.0:
        values = values * scale + offset
    values[~np.isfinite(values)] = np.nan
    data_dims = [d for d in dims if d != "time"]
    if "time" in dims:
        values = values[0]
    if data_dims == ["lon", "lat"]:
        values = values.T
    return values.astype("float32")


def assemble(product: Product, settings, download_result: dict) -> None:
    raw = settings.raw_dir / "europe_cube" / product.key
    window = download_result["window"]
    granules = download_result["granules"]
    failed = download_result["failed"]
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
        target = cube_dir(settings.data_dir, vid)
        target.mkdir(parents=True, exist_ok=True)
        tmp = target / ".data.npy.part"
        with open(tmp, "wb") as f:
            np.save(f, cube)
        os.replace(tmp, target / "data.npy")
        if counts is not None:
            with open(target / ".valid_days.npy.part", "wb") as f:
                np.save(f, counts)
            os.replace(target / ".valid_days.npy.part", target / "valid_days.npy")
        failed_months = sorted({k[:7] for k in failed})
        meta = {
            "variable_id": vid,
            "product": {"short_name": product.short_name, "version": product.version,
                        "collection_concept_id": product.collection, "dataset": dataset},
            "source": "NASA GES DISC cloud OPeNDAP (DAP4 subsets)",
            "source_unit": product.units.get(vid),
            "layout": "data.npy: float32, shape (lat, lon, time); NaN = missing (fill value or no granule)",
            "domain": {"name": "Europe", "bbox": list(EUROPE_BBOX)},
            "lat": [round(float(x), 5) for x in lat],
            "lon": [round(float(x), 5) for x in lon],
            "times": months,
            "aggregation": (f"daily granules averaged to monthly means; month is NaN if fewer than "
                            f"{product.min_valid_days} valid days (valid_days.npy)") if product.daily else None,
            "months_without_granule": [m for m in months if m not in present and m not in failed_months],
            "months_with_failed_downloads": failed_months,
            "granules_used": len([g for g in granules if (raw / f"{g['key']}.nc4").is_file()]),
            "assembled_at": utc_now(),
        }
        write_json_atomic(target / "meta.json", meta)
        status = "ready" if not failed else "partial"
        write_json_atomic(target / "status.json", {
            "product": f"{product.short_name} v{product.version}", "status": status,
            "done": meta["granules_used"], "total": len(granules), "failed": len(failed),
            "months": n_t, "shape": [n_lat, n_lon, n_t], "updated_at": utc_now()})
        log.info("%s/%s: assembled %s, status %s", product.key, vid, (n_lat, n_lon, n_t), status)


# ---------------------------------------------------------------------------------------------
async def run(product_keys: list[str], concurrency: int, limit: int | None) -> int:
    settings = load_settings()
    setup_logging(settings.log_level, settings.secrets)
    if not settings.token_configured:
        log.error("EARTHDATA_TOKEN is not configured; nothing downloaded")
        return 2
    exit_code = 0
    for key in product_keys:
        product = PRODUCTS[key]
        try:
            result = await download(product, settings, concurrency=concurrency, limit=limit)
            assemble(product, settings, result)
        except PermissionError as exc:
            log.error("%s: %s — check the Earthdata token", key, exc)
            write_status(settings.data_dir, product, status="failed", reason="source_rejected")
            return 3
        except Exception as exc:
            log.exception("%s failed: %s", key, type(exc).__name__)
            write_status(settings.data_dir, product, status="failed", reason=type(exc).__name__)
            exit_code = 1
    return exit_code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--products", default=",".join(DEFAULT_ORDER),
                        help=f"comma-separated: {', '.join(PRODUCTS)}; or 'all'")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--limit", type=int, default=None, help="only the first N granules (testing)")
    args = parser.parse_args(argv)
    if args.products.strip() == "all":
        keys = list(DEFAULT_ORDER) + ["omi_no2"]  # NO2 last: 7800 daily granules
    else:
        keys = [k.strip() for k in args.products.split(",") if k.strip()]
    unknown = [k for k in keys if k not in PRODUCTS]
    if unknown:
        parser.error(f"unknown products: {unknown}")
    return asyncio.run(run(keys, args.concurrency, args.limit))


if __name__ == "__main__":
    sys.exit(main())
