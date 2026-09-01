"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.api import router
from routes.proxy_api import router as proxy_router
from proxy_server import proxy_server_instance
from settings import allowed_origins


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application startup & shutdown lifecycle."""
    try:
        await proxy_server_instance.start()
    except Exception as e:
        print(f"Proxy server start notice: {e}")
    yield
    await proxy_server_instance.stop()


app = FastAPI(
    title="Reqerer — HTTP Request Testing Platform",
    description="High-performance HTTP testing and benchmarking platform with Interceptor Proxy.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(router)
app.include_router(proxy_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
