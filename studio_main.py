"""Public Plotloom process, without legacy administration endpoints."""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from agent.studio_api import router, store

@asynccontextmanager
async def lifespan(app):
    store.recover_interrupted()
    yield

app = FastAPI(title="Plotloom", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

@app.middleware("http")
async def chinese_market(request: Request, call_next):
    request.state.site_market = "china"
    return await call_next(request)

app.include_router(router)
