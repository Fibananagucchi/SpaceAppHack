"""Real monthly series for one grid cell: from the Europe cube or from Giovanni.

Source rule (DECISIONS [агенти], step 1): a point inside the Europe domain is read from
the prepared Europe cube when that variable's cube is ``ready`` (same product files as
the trend map, NASA GES DISC OPeNDAP); otherwise the series comes live from the
NASA Giovanni time-series service. The source is always named in the provenance.

Units are converted here, in one place, following the product documentation:
* MERRA-2 / AIRS temperature: K - 273.15 -> °C
* GPM IMERG monthly precipitation: mean rate in mm/hr (file attribute) x 24 x days -> mm/month
* GLDAS-2.1 Evap_tavg: mean rate kg m-2 s-1 x 86400 x days -> mm/month (GLDAS-2 README)
* GLDAS-2.1 Qs_acc: monthly mean of 3-hour accumulations (kg m-2 per 3 h) x 8 x days -> mm/month (GLDAS-2 README)
* GLDAS-2.1 soil moisture: kg m-2, unchanged
* OMI NO2: molecules/cm2 / 1e15; daily values averaged to months with >= 10 valid days
Missing values stay NaN with a reason. Nothing is interpolated or filled.
"""

from __future__ import annotations

import calendar
import json
import math
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from . import catalog, storage
from .config import Settings
from .state import StateStore, utc_now

GIOVANNI_TS_URL = "https://api.giovanni.earthdata.nasa.gov/timeseries"
GIOVANNI_CACHE_TTL_S = 24 * 3600
MIN_VALID_DAYS = 10


class SourceError(Exception):
    """An upstream source could not deliver the series. Never carries upstream text to clients."""

    def __init__(self, source: str, kind: str, retry_after_s: int | None = None) -> None:
        super().__init__(f"{source}: {kind}")
        self.source = source
        self.kind = kind            # timeout | unavailable | rejected | rate_limited
        self.retry_after_s = retry_after_s


@dataclass
class MonthlySeries:
    times: list[str]                         # contiguous months "YYYY-MM"
    values: np.ndarray                       # display units, NaN = missing
    missing_reasons: list[str | None]        # per month, None when valid
    grid_cell: dict[str, float]
    provenance: dict[str, Any]
    aggregation: dict[str, Any] | None = None
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------------------------
def days_in_month(month: str) -> int:
    return calendar.monthrange(int(month[:4]), int(month[5:7]))[1]


def to_display_units(variable_id: str, times: list[str], values: np.ndarray) -> np.ndarray:
    v = np.asarray(values, dtype=float)
    days = np.array([days_in_month(t) for t in times], dtype=float)
    if variable_id in ("t2m", "airs_surface_air_temp"):
        return v - 273.15
    if variable_id == "precip":
        return v * 24.0 * days
    if variable_id == "evapotranspiration":
        return v * 86400.0 * days
    if variable_id == "surface_runoff":
        return v * 8.0 * days
    if variable_id == "no2_tropo":
        return v / 1e15
    return v  # soil_moisture: kg m-2


def month_range(first: str, last: str) -> list[str]:
    y, m = int(first[:4]), int(first[5:7])
    out: list[str] = []
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def _in_europe(lat: float, lon: float) -> bool:
    west, south, east, north = storage.EUROPE_BBOX
    return south <= lat <= north and west <= lon <= east


# ---------------------------------------------------------------------------------------------
# Europe cube
# ---------------------------------------------------------------------------------------------
def cube_ready(data_dir: Path, variable_id: str) -> bool:
    status = storage.read_json(storage.cube_dir(data_dir, variable_id) / "status.json") or {}
    return status.get("status") == "ready" and (storage.cube_dir(data_dir, variable_id) / "data.npy").is_file()


def from_cube(data_dir: Path, variable_id: str, lat: float, lon: float) -> MonthlySeries | None:
    folder = storage.cube_dir(data_dir, variable_id)
    meta = storage.read_json(folder / "meta.json")
    if not meta:
        return None
    lats = np.asarray(meta["lat"])
    lons = np.asarray(meta["lon"])
    variable = catalog.get_variable(variable_id)
    res = variable["native_resolution"]
    i = int(np.argmin(np.abs(lats - lat)))
    j = int(np.argmin(np.abs(lons - lon)))
    if abs(lats[i] - lat) > res["lat_deg"] / 2 + 1e-6 or abs(lons[j] - lon) > res["lon_deg"] / 2 + 1e-6:
        return None  # point is outside the cube grid (edge of the domain)
    cube = np.load(folder / "data.npy", mmap_mode="r")
    raw = np.asarray(cube[i, j, :], dtype=float)
    times: list[str] = meta["times"]
    no_granule = set(meta.get("months_without_granule", [])) | set(meta.get("months_with_failed_downloads", []))
    reasons: list[str | None] = []
    valid_days = None
    if (folder / "valid_days.npy").is_file():
        valid_days = np.asarray(np.load(folder / "valid_days.npy", mmap_mode="r")[i, j, :])
    for k, tm in enumerate(times):
        if math.isfinite(raw[k]):
            reasons.append(None)
        elif tm in no_granule:
            reasons.append("no_granule")
        elif valid_days is not None:
            reasons.append("too_few_valid_days")
        else:
            reasons.append("fill_value")
    values = to_display_units(variable_id, times, raw)
    product = meta["product"]
    return MonthlySeries(
        times=times, values=values, missing_reasons=reasons,
        grid_cell={"center_lat": round(float(lats[i]), 5), "center_lon": round(float(lons[j]), 5),
                   "lat_res": res["lat_deg"], "lon_res": res["lon_deg"]},
        provenance={"source_service": "europe_cube",
                    "upstream": "NASA GES DISC cloud OPeNDAP (prepared Europe cube)",
                    "product": product["short_name"], "version": product["version"],
                    "doi": variable["source"]["doi"], "retrieved_at": meta.get("assembled_at"),
                    "from_cache": True},
        aggregation=({"from": "daily", "rule": f"mean of valid days; month missing if fewer than {MIN_VALID_DAYS} "
                                               f"valid days"} if valid_days is not None else None),
    )


# ---------------------------------------------------------------------------------------------
# Giovanni
# ---------------------------------------------------------------------------------------------
def parse_giovanni_csv(text: str) -> tuple[dict[str, str], list[tuple[str, float]]]:
    header: dict[str, str] = {}
    rows: list[tuple[str, float]] = []
    in_data = False
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("Timestamp"):
            in_data = True
            continue
        key, _, value = line.partition(",")
        if in_data and key[:2] in ("19", "20"):
            try:
                rows.append((key[:10], float(value)))
            except ValueError:
                rows.append((key[:10], float("nan")))
        elif not in_data:
            header[key] = value
    return header, rows


def _monthly_from_rows(rows: list[tuple[str, float]], undef: float, daily: bool
                       ) -> tuple[list[str], np.ndarray, list[str | None], int]:
    def is_fill(v: float) -> bool:
        return not math.isfinite(v) or math.isclose(v, undef, rel_tol=1e-5)

    if not rows:
        return [], np.array([]), [], 0
    months = month_range(rows[0][0][:7], rows[-1][0][:7])
    index = {m: k for k, m in enumerate(months)}
    values = np.full(len(months), np.nan)
    reasons: list[str | None] = ["no_granule"] * len(months)
    if daily:
        sums = np.zeros(len(months))
        counts = np.zeros(len(months), dtype=int)
        for day, v in rows:
            k = index[day[:7]]
            reasons[k] = "too_few_valid_days"
            if not is_fill(v):
                sums[k] += v
                counts[k] += 1
        enough = counts >= MIN_VALID_DAYS
        values[enough] = sums[enough] / counts[enough]
        for k in np.where(enough)[0]:
            reasons[k] = None
    else:
        for day, v in rows:
            k = index[day[:7]]
            if is_fill(v):
                reasons[k] = "fill_value"
            else:
                values[k] = v
                reasons[k] = None
    return months, values, reasons, len(rows)


async def fetch_giovanni(settings: Settings, store: StateStore, variable_id: str, lat: float, lon: float
                         ) -> MonthlySeries:
    variable = catalog.get_variable(variable_id)
    internal = variable["_internal"]
    giovanni_id = internal["giovanni_id"]
    cache_key = f"giovanni|{giovanni_id}|{lat:.4f}|{lon:.4f}"
    cached = store.get_cached_series(cache_key, max_age_s=GIOVANNI_CACHE_TTL_S)
    if cached:
        payload, retrieved_at = cached
        from_cache = True
    else:
        if not settings.token_configured:
            raise SourceError("giovanni", "rejected")
        start = variable["coverage"]["start"] + "-01T00:00:00"
        end = date.today().strftime("%Y-%m-%dT23:59:59")
        params = {"data": giovanni_id, "location": f"[{lat:.4f},{lon:.4f}]", "time": f"{start}/{end}"}
        headers = {"Authorization": f"Bearer {settings.earthdata_token}"}
        try:
            async with httpx.AsyncClient(timeout=settings.upstream_timeout_s) as client:
                response = await client.get(GIOVANNI_TS_URL, params=params, headers=headers)
        except httpx.TimeoutException as exc:
            raise SourceError("giovanni", "timeout") from exc
        except httpx.HTTPError as exc:
            raise SourceError("giovanni", "unavailable") from exc
        if response.status_code in (401, 403):
            raise SourceError("giovanni", "rejected")
        if response.status_code == 429:
            raise SourceError("giovanni", "rate_limited", retry_after_s=60)
        if response.status_code == 404:
            payload = {"no_data": True}
        elif response.status_code != 200:
            raise SourceError("giovanni", "unavailable")
        else:
            header, rows = parse_giovanni_csv(response.text)
            payload = {"header": header, "rows": rows}
        retrieved_at = utc_now()
        store.put_cached_series(cache_key, payload, source="giovanni", product=giovanni_id, retrieved_at=retrieved_at)
        from_cache = False

    res = variable["native_resolution"]
    provenance = {"source_service": "giovanni_time_series", "upstream": "NASA Giovanni in the Cloud — Time Series",
                  "product": variable["source"]["product"], "version": variable["source"]["version"],
                  "doi": variable["source"]["doi"], "retrieved_at": retrieved_at, "from_cache": from_cache}
    if payload.get("no_data"):
        return MonthlySeries([], np.array([]), [], {"center_lat": lat, "center_lon": lon,
                                                    "lat_res": res["lat_deg"], "lon_res": res["lon_deg"]},
                             provenance, notes=["source_reported_no_data_for_location"])
    header, rows = payload["header"], [tuple(r) for r in payload["rows"]]
    daily = variable["native_resolution"]["time"] == "daily"
    undef = float(header.get("undef", "nan"))
    months, raw, reasons, _ = _monthly_from_rows(rows, undef, daily)
    values = to_display_units(variable_id, months, raw)
    cell = {"center_lat": round(float(header.get("lat", lat)), 5), "center_lon": round(float(header.get("lon", lon)), 5),
            "lat_res": res["lat_deg"], "lon_res": res["lon_deg"]}
    aggregation = ({"from": "daily", "rule": f"mean of valid days; month missing if fewer than {MIN_VALID_DAYS} "
                                             f"valid days"} if daily else None)
    return MonthlySeries(months, values, reasons, cell, provenance, aggregation)


async def get_point_series(settings: Settings, store: StateStore, variable_id: str, lat: float, lon: float
                           ) -> MonthlySeries:
    if _in_europe(lat, lon) and cube_ready(settings.data_dir, variable_id):
        series = from_cube(settings.data_dir, variable_id, lat, lon)
        if series is not None:
            return series
    return await fetch_giovanni(settings, store, variable_id, lat, lon)


# ---------------------------------------------------------------------------------------------
# Areas (step 3)
# ---------------------------------------------------------------------------------------------
AREA_MIN_CELL_FRACTION = 0.5     # a month is valid if >= 50 % of the cells with data are valid
HARMONY_POLL_S = 10
HARMONY_TIMEOUT_S = 30 * 60
HARMONY_MAX_POLL_FAILURES = 5


class AreaTooSmall(Exception):
    """No grid-cell centre of the product lies inside the requested box."""


def bbox_in_europe(bbox: tuple[float, float, float, float]) -> bool:
    west, south, east, north = bbox
    e_west, e_south, e_east, e_north = storage.EUROPE_BBOX
    return e_west <= west and east <= e_east and e_south <= south and north <= e_north


def area_from_cube(data_dir: Path, variable_id: str, bbox: tuple[float, float, float, float]
                   ) -> tuple[MonthlySeries, dict[str, Any]]:
    """Area-weighted (cos latitude) monthly mean of the cube cells whose centre lies inside bbox."""
    folder = storage.cube_dir(data_dir, variable_id)
    meta = storage.read_json(folder / "meta.json")
    variable = catalog.get_variable(variable_id)
    res = variable["native_resolution"]
    west, south, east, north = bbox
    lats = np.asarray(meta["lat"])
    lons = np.asarray(meta["lon"])
    li = np.where((lats >= south) & (lats <= north))[0]
    lj = np.where((lons >= west) & (lons <= east))[0]
    if li.size == 0 or lj.size == 0:
        raise AreaTooSmall()
    cube = np.load(folder / "data.npy", mmap_mode="r")
    block = np.asarray(cube[li[0]:li[-1] + 1, lj[0]:lj[-1] + 1, :], dtype="float64")
    times: list[str] = meta["times"]
    weights = np.cos(np.deg2rad(lats[li]))[:, None] * np.ones((1, lj.size))
    has_data = np.isfinite(block).any(axis=2)
    n_with_data = int(has_data.sum())
    values = np.full(len(times), np.nan)
    reasons: list[str | None] = []
    no_granule = set(meta.get("months_without_granule", [])) | set(meta.get("months_with_failed_downloads", []))
    for k, tm in enumerate(times):
        field_ = block[:, :, k]
        valid = np.isfinite(field_) & has_data
        if n_with_data and valid.sum() >= AREA_MIN_CELL_FRACTION * n_with_data:
            w = weights[valid]
            values[k] = float(np.sum(field_[valid] * w) / np.sum(w))
            reasons.append(None)
        else:
            reasons.append("no_granule" if tm in no_granule else "too_few_cells_with_data")
    product = meta["product"]
    averaging = ("area-weighted (cos latitude) mean of grid cells whose centre lies inside the box; a month is "
                 f"valid only if at least {int(AREA_MIN_CELL_FRACTION * 100)} % of the cells with data are valid")
    resolved = {
        "type": "area", "requested": {"bbox": list(bbox)},
        "bbox_used": [round(float(lons[lj[0]] - res["lon_deg"] / 2), 5), round(float(lats[li[0]] - res["lat_deg"] / 2), 5),
                      round(float(lons[lj[-1]] + res["lon_deg"] / 2), 5), round(float(lats[li[-1]] + res["lat_deg"] / 2), 5)],
        "cells_total": int(li.size * lj.size), "cells_with_data": n_with_data,
        "grid": {"lat_res": res["lat_deg"], "lon_res": res["lon_deg"]},
        "averaging": averaging,
    }
    aggregation: dict[str, Any] = {"spatial": averaging}
    if (folder / "valid_days.npy").is_file():
        aggregation.update({"from": "daily", "rule": f"mean of valid days; month missing if fewer than "
                                                     f"{MIN_VALID_DAYS} valid days (per cell, before the area mean)"})
    series = MonthlySeries(
        times=times, values=to_display_units(variable_id, times, values), missing_reasons=reasons,
        grid_cell={}, provenance={"source_service": "europe_cube",
                                  "upstream": "NASA GES DISC cloud OPeNDAP (prepared Europe cube)",
                                  "product": product["short_name"], "version": product["version"],
                                  "doi": variable["source"]["doi"], "retrieved_at": meta.get("assembled_at"),
                                  "from_cache": True},
        aggregation=aggregation,
    )
    if n_with_data == 0:
        series.notes.append("source_reported_no_data_for_location")
    return series, resolved


def parse_harmony_csv(text: str) -> tuple[float | None, list[tuple[str, float]]]:
    fill: float | None = None
    rows: list[tuple[str, float]] = []
    for line in text.splitlines():
        line = line.strip()
        if line.lower().startswith("fill value"):
            try:
                fill = float(line.split(",", 1)[1])
            except (IndexError, ValueError):
                fill = None
            continue
        key, _, value = line.partition(",")
        if key[:2] in ("19", "20") and value:
            try:
                rows.append((key[:10], float(value)))
            except ValueError:
                rows.append((key[:10], float("nan")))
    return fill, rows


def harmony_cache_key(variable_id: str, bbox: tuple[float, float, float, float]) -> str:
    giovanni_id = catalog.get_variable(variable_id)["_internal"]["giovanni_id"]
    # A cached area mean belongs to the exact requested box, not a rounded neighbour.
    # Versioning avoids reusing old entries whose original bounds were not stored.
    coordinates = [0.0 if value == 0 else float(value) for value in bbox]
    return f"harmony-v2|{giovanni_id}|{json.dumps(coordinates, separators=(',', ':'), allow_nan=False)}"


def harmony_area_cached(store: StateStore, variable_id: str, bbox: tuple[float, float, float, float]) -> bool:
    return store.get_cached_series(harmony_cache_key(variable_id, bbox), max_age_s=GIOVANNI_CACHE_TTL_S) is not None


async def fetch_harmony_area(settings: Settings, store: StateStore, variable_id: str,
                             bbox: tuple[float, float, float, float], on_stage=None) -> MonthlySeries:
    """Area mean from NASA Harmony (Giovanni averaging service). Slow (minutes): run as a job."""
    import asyncio

    variable = catalog.get_variable(variable_id)
    internal = variable["_internal"]
    west, south, east, north = bbox
    cache_key = harmony_cache_key(variable_id, bbox)
    cached = store.get_cached_series(cache_key, max_age_s=GIOVANNI_CACHE_TTL_S)
    if cached:
        payload, retrieved_at = cached
        from_cache = True
    else:
        if not settings.token_configured:
            raise SourceError("harmony", "rejected")
        headers = {"Authorization": f"Bearer {settings.earthdata_token}"}
        start = variable["coverage"]["start"] + "-01T00:00:00Z"
        end = date.today().strftime("%Y-%m-%dT23:59:59Z")
        url = (f"https://harmony.earthdata.nasa.gov/{internal['collection_concept_id']}"
               "/ogc-api-coverages/1.0.0/collections/parameter_vars/coverage/rangeset")
        params = [("subset", f"lat({south}:{north})"), ("subset", f"lon({west}:{east})"),
                  ("subset", f'time("{start}":"{end}")'), ("variable", internal["giovanni_id"]),
                  ("average", "area"), ("format", "text/csv")]
        try:
            async with httpx.AsyncClient(timeout=settings.upstream_timeout_s) as client:
                submit = await client.get(url, params=params, headers=headers, follow_redirects=False)
                if submit.status_code in (401, 403):
                    raise SourceError("harmony", "rejected")
                if submit.status_code == 429:
                    raise SourceError("harmony", "rate_limited", retry_after_s=60)
                location = submit.headers.get("Location", "")
                if submit.status_code != 303 or not location:
                    raise SourceError("harmony", "unavailable")
                job_url = location if location.startswith("http") else f"https://harmony.earthdata.nasa.gov{location}"
                if on_stage:
                    on_stage("waiting_for_source")
                waited = 0
                transient_failures = 0
                while True:
                    # Polling tolerates short network hiccups (connection resets were seen on CMR/Harmony);
                    # only repeated failures fail the job.
                    try:
                        status_resp = await client.get(job_url, headers=headers)
                        ok = status_resp.status_code == 200
                    except httpx.HTTPError:
                        ok = False
                    if not ok:
                        transient_failures += 1
                        if transient_failures > HARMONY_MAX_POLL_FAILURES:
                            raise SourceError("harmony", "unavailable")
                        await asyncio.sleep(HARMONY_POLL_S)
                        waited += HARMONY_POLL_S
                        continue
                    transient_failures = 0
                    job = status_resp.json()
                    state = job.get("status")
                    if state == "successful":
                        break
                    if state in ("failed", "canceled", "complete_with_errors"):
                        raise SourceError("harmony", "unavailable")
                    if waited >= HARMONY_TIMEOUT_S:
                        raise SourceError("harmony", "timeout")
                    await asyncio.sleep(HARMONY_POLL_S)
                    waited += HARMONY_POLL_S
                links = [link for link in job.get("links", []) if link.get("rel") == "data"]
                if not links:
                    raise SourceError("harmony", "unavailable")
                if on_stage:
                    on_stage("downloading")
                data = await client.get(links[0]["href"], headers=headers, follow_redirects=True)
                if data.status_code != 200:
                    raise SourceError("harmony", "unavailable")
        except httpx.TimeoutException as exc:
            raise SourceError("harmony", "timeout") from exc
        except httpx.HTTPError as exc:
            raise SourceError("harmony", "unavailable") from exc
        fill, rows = parse_harmony_csv(data.text)
        payload = {"fill": fill, "rows": rows}
        retrieved_at = utc_now()
        store.put_cached_series(cache_key, payload, source="harmony", product=internal["giovanni_id"],
                                retrieved_at=retrieved_at)
        from_cache = False

    rows = [tuple(r) for r in payload["rows"]]
    fill = payload["fill"] if payload["fill"] is not None else float("nan")
    daily = variable["native_resolution"]["time"] == "daily"
    months, raw, reasons, _ = _monthly_from_rows(rows, fill, daily)
    aggregation: dict[str, Any] = {"spatial": "area mean computed by the NASA Giovanni averaging service (Harmony)"}
    if daily:
        aggregation.update({"from": "daily", "rule": f"mean of valid days of the area mean; month missing if "
                                                     f"fewer than {MIN_VALID_DAYS} valid days"})
    return MonthlySeries(
        times=months, values=to_display_units(variable_id, months, raw), missing_reasons=reasons, grid_cell={},
        provenance={"source_service": "harmony_area_average",
                    "upstream": "NASA Harmony — Giovanni averaging service (area mean)",
                    "product": variable["source"]["product"], "version": variable["source"]["version"],
                    "doi": variable["source"]["doi"], "retrieved_at": retrieved_at, "from_cache": from_cache},
        aggregation=aggregation,
    )


# ---------------------------------------------------------------------------------------------
# MODIS for any point (step 4): background job with cache (team decision 13:13)
# ---------------------------------------------------------------------------------------------
MODIS_CACHE_TTL_S = 7 * 24 * 3600
MODIS_CONCURRENCY = 8
CMR_GRANULES_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"


def modis_pixel(lat: float, lon: float, res: float = 0.05) -> tuple[int, int, float, float]:
    row = min(int((90.0 - lat) / res), int(180 / res) - 1)
    col = min(int((lon + 180.0) / res), int(360 / res) - 1)
    return row, col, round(90.0 - (row + 0.5) * res, 5), round(-180.0 + (col + 0.5) * res, 5)


def modis_cache_key(variable_id: str, lat: float, lon: float) -> str:
    row, col, _, _ = modis_pixel(lat, lon)
    return f"modis|{variable_id}|{row}|{col}"


def modis_cached(store: StateStore, variable_id: str, lat: float, lon: float) -> bool:
    return store.get_cached_series(modis_cache_key(variable_id, lat, lon), max_age_s=MODIS_CACHE_TTL_S) is not None


def _modis_value(variable_id: str, raw: float) -> float:
    internal = catalog.get_variable(variable_id)["_internal"]
    lo, hi = internal["valid_range"]
    if not math.isfinite(raw) or raw == internal["fill_value"] or raw < lo or raw > hi:
        return float("nan")
    return raw / internal["scale_divisor"] if internal.get("scale_divisor") else raw * internal["scale_multiplier"]


async def _list_granules(client: httpx.AsyncClient, collection: str) -> list[tuple[str, str]]:
    import asyncio

    out: list[tuple[str, str]] = []
    search_after = None
    while True:
        headers = {"CMR-Search-After": search_after} if search_after else None
        for attempt in range(6):
            try:
                r = await client.get(CMR_GRANULES_URL, headers=headers, timeout=60,
                                     params={"collection_concept_id": collection, "page_size": 2000,
                                             "sort_key": "start_date"})
                if r.status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            await asyncio.sleep(2 + 2 * attempt)
        else:
            raise SourceError("cmr", "unavailable")
        entries = r.json()["feed"]["entry"]
        for e in entries:
            links = [link["href"] for link in e.get("links", []) if "opendap.earthdata.nasa.gov" in link.get("href", "")]
            if links:
                out.append((e["time_start"][:7], links[0]))
        search_after = r.headers.get("CMR-Search-After")
        if not entries or not search_after:
            return out


async def fetch_modis_point(settings: Settings, store: StateStore, variable_id: str, lat: float, lon: float,
                            progress=None) -> MonthlySeries:
    """Monthly MODIS CMG (0.05°) series for one pixel from NASA LP DAAC cloud OPeNDAP."""
    import asyncio
    import io
    from urllib.parse import quote

    import h5py

    variable = catalog.get_variable(variable_id)
    internal = variable["_internal"]
    row, col, clat, clon = modis_pixel(lat, lon)
    cache_key = modis_cache_key(variable_id, lat, lon)
    cached = store.get_cached_series(cache_key, max_age_s=MODIS_CACHE_TTL_S)
    if cached:
        payload, retrieved_at = cached
        from_cache = True
    else:
        if not settings.token_configured:
            raise SourceError("lpdaac", "rejected")
        headers = {"Authorization": f"Bearer {settings.earthdata_token}"}
        constraint = quote(f"{internal['dataset_path']}[{row}][{col}]", safe="/;:")
        dataset_key = internal["dataset_path"].lstrip("/")
        async with httpx.AsyncClient(timeout=settings.upstream_timeout_s, follow_redirects=True) as client:
            granules = await _list_granules(client, internal["collection_concept_id"])
            if not granules:
                raise SourceError("lpdaac", "unavailable")
            semaphore = asyncio.Semaphore(MODIS_CONCURRENCY)
            done = 0
            rejected = False

            async def one(month: str, url: str) -> tuple[str, float | None]:
                nonlocal done, rejected
                async with semaphore:
                    value: float | None = None
                    for attempt in range(3):
                        try:
                            r = await client.get(f"{url}.dap.nc4?dap4.ce={constraint}", headers=headers)
                            if r.status_code in (401, 403):
                                rejected = True
                                break
                            if r.status_code == 200:
                                with h5py.File(io.BytesIO(r.content), "r") as f:
                                    value = float(np.asarray(f[dataset_key][...]).ravel()[0])
                                break
                        except (httpx.HTTPError, OSError, KeyError):
                            pass
                        await asyncio.sleep(1 + attempt)
                    done += 1
                    if progress and (done % 10 == 0 or done == len(granules)):
                        progress(done, len(granules), "months")
                    return month, value

            results = await asyncio.gather(*(one(m, u) for m, u in granules))
            if rejected:
                raise SourceError("lpdaac", "rejected")
        payload = {"rows": [[m, v] for m, v in results]}
        retrieved_at = utc_now()
        failed = sum(1 for _, v in results if v is None)
        if failed > len(results) * 0.5:
            raise SourceError("lpdaac", "unavailable")
        store.put_cached_series(cache_key, payload, source="lpdaac_opendap", product=variable["source"]["product"],
                                retrieved_at=retrieved_at)
        from_cache = False

    rows = sorted((m, v) for m, v in payload["rows"])
    months = month_range(rows[0][0], rows[-1][0])
    by_month = dict(rows)
    values = np.full(len(months), np.nan)
    reasons: list[str | None] = []
    for k, m in enumerate(months):
        if m not in by_month:
            reasons.append("no_granule")
        elif by_month[m] is None:
            reasons.append("download_failed")
        else:
            v = _modis_value(variable_id, float(by_month[m]))
            values[k] = v
            reasons.append(None if math.isfinite(v) else "fill_value")
    if internal.get("to_celsius"):
        values = values - 273.15
    return MonthlySeries(
        times=months, values=values, missing_reasons=reasons,
        grid_cell={"center_lat": clat, "center_lon": clon, "lat_res": 0.05, "lon_res": 0.05},
        provenance={"source_service": "lpdaac_opendap", "upstream": "NASA LP DAAC cloud OPeNDAP (MODIS CMG pixel)",
                    "product": variable["source"]["product"], "version": variable["source"]["version"],
                    "doi": variable["source"]["doi"], "retrieved_at": retrieved_at, "from_cache": from_cache},
    )
