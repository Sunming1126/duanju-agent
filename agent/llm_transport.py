"""Worker-scoped HTTP pool; standalone callers keep an owned, short-lived client."""
from contextlib import asynccontextmanager
from contextvars import ContextVar

import httpx

_pool = ContextVar('plotloom_http_pool', default=None)


@asynccontextmanager
async def worker_connections(concurrent):
    limits = httpx.Limits(max_connections=concurrent, max_keepalive_connections=concurrent, keepalive_expiry=60)
    async with httpx.AsyncClient(limits=limits) as client:
        token = _pool.set(client)
        try:
            yield
        finally:
            _pool.reset(token)


@asynccontextmanager
async def request_client(timeout):
    client = _pool.get()
    if client is not None:
        yield client
    else:
        async with httpx.AsyncClient(timeout=timeout) as owned:
            yield owned
