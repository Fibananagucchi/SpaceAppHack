"""Live reachability checks of upstream sources (used by /api/v1/health?deep=true).

Only status, HTTP status class and latency are reported. No data values, no upstream
messages and never the token. Results are cached for 60 s so the public health
endpoint cannot be used to hammer NASA services.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from .config import Settings
from .state import utc_now

GIOVANNI_TS_URL = "https://api.giovanni.earthdata.nasa.gov/timeseries"
# A small, stable request: one month of MERRA-2 T2M at a fixed grid cell.
GIOVANNI_PROBE = {"data": "M2IMNXASM_5_12_4_T2M", "location": "[48.0,16.25]",
                  "time": "2020-01-01T00:00:00/2020-01-31T23:59:59"}
OPENDAP_PROBE_URL = ("https://opendap.earthdata.nasa.gov/collections/C1276812823-GES_DISC/granules/"
                     "M2IMNXASM.5.12.4%3AMERRA2_400.instM_2d_asm_Nx.202001.nc4.dmr")
EONET_PROBE_URL = "https://eonet.gsfc.nasa.gov/api/v3/categories"

_CACHE_TTL_S = 60.0
_cache: dict[str, Any] = {"at": 0.0, "result": None}


def _classify(status_code: int) -> str:
    if 200 <= status_code < 300:
        return "ok"
    if status_code in (401, 403):
        return "rejected"
    if status_code == 429:
        return "rate_limited"
    return "unavailable"


async def _probe(client: httpx.AsyncClient, url: str, *, params: dict[str, str] | None = None,
                 headers: dict[str, str] | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        response = await client.get(url, params=params, headers=headers)
    except httpx.TimeoutException:
        return {"status": "timeout", "latency_ms": None}
    except httpx.HTTPError:
        return {"status": "unavailable", "latency_ms": None}
    latency = round((time.perf_counter() - started) * 1000)
    return {"status": _classify(response.status_code), "http_status_class": f"{response.status_code // 100}xx",
            "latency_ms": latency}


async def deep_check(settings: Settings) -> dict[str, Any]:
    now = time.monotonic()
    if _cache["result"] is not None and now - _cache["at"] < _CACHE_TTL_S:
        return _cache["result"]
    auth = {"Authorization": f"Bearer {settings.earthdata_token}"} if settings.token_configured else None
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False) as client:
        tasks = {"eonet": _probe(client, EONET_PROBE_URL)}
        if auth:
            tasks["giovanni"] = _probe(client, GIOVANNI_TS_URL, params=GIOVANNI_PROBE, headers=auth)
            tasks["opendap"] = _probe(client, OPENDAP_PROBE_URL, headers=auth)
        results = dict(zip(tasks.keys(), await asyncio.gather(*tasks.values())))
    if not auth:
        results["giovanni"] = {"status": "not_configured"}
        results["opendap"] = {"status": "not_configured"}
    result = {"checked_at": utc_now(), "sources": results}
    _cache.update(at=now, result=result)
    return result
