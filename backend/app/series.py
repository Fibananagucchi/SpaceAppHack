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
