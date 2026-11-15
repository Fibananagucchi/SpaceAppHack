"""One shared HTTP client for all upstream calls (NASA Giovanni, Harmony, LP DAAC, EONET).

A single ``httpx.AsyncClient`` keeps connections alive between requests instead of opening a new TLS
connection per call. Call sites keep their own timeout and redirect policy through :func:`upstream`.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx

_LIMITS = httpx.Limits(max_connections=50, max_keepalive_connections=20, keepalive_expiry=30.0)
_state: dict[str, Any] = {"loop": None, "client": None}


def shared_client() -> httpx.AsyncClient:
    """The application-wide client, created on first use in the running event loop."""
    loop = asyncio.get_running_loop()
    client: httpx.AsyncClient | None = _state["client"]
    if client is None or client.is_closed or _state["loop"] is not loop:
        client = httpx.AsyncClient(limits=_LIMITS, timeout=30.0, follow_redirects=False)
        _state.update(loop=loop, client=client)
    return client


async def close_shared_client() -> None:
    client: httpx.AsyncClient | None = _state["client"]
    _state.update(loop=None, client=None)
    if client is not None and not client.is_closed:
        await client.aclose()


class _Bound:
    """The shared client with per-call-site defaults; per-request arguments still win."""

    def __init__(self, client: httpx.AsyncClient, defaults: dict[str, Any]) -> None:
        self._client = client
        self._defaults = defaults

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self._client.get(url, **{**self._defaults, **kwargs})


@asynccontextmanager
async def upstream(*, timeout: float = 30.0, follow_redirects: bool = False) -> AsyncIterator[_Bound]:
    """Drop-in for ``async with httpx.AsyncClient(...) as client`` that reuses the shared connection pool."""
    yield _Bound(shared_client(), {"timeout": timeout, "follow_redirects": follow_redirects})
