import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import dependencies, monitoring, incidents, intelligence, admin, copilot, integrations, otel, vm

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)


def _warm_parquet_cache() -> None:
    """Pre-load parquet files into memory so the first HTTP request is instant."""
    import logging
    log = logging.getLogger(__name__)
    try:
        from app import parquet_store
        log.info("[startup] Pre-warming parquet cache...")
        parquet_store._svc_host_map()
        parquet_store._metric_app()
        parquet_store._metric_cpu()
        
        log.info("[startup] Warming logical query cache...")
        for filename in parquet_store._ROUTES.keys():
            parquet_store.query(filename)
            
        log.info("[startup] Parquet cache ready.")
    except Exception as exc:
        log.warning(f"[startup] Parquet pre-warm failed (non-fatal): {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio, logging
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _warm_parquet_cache)
    from app.integrations.scheduler import start_scheduler, stop_scheduler
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Autonomous IT Operations Intelligence Platform",
    description="MVP API for synthetic observability, dependency mapping, and incident intelligence",
    version="0.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dependencies.router)
app.include_router(monitoring.router)
app.include_router(incidents.router)
app.include_router(intelligence.router)
app.include_router(admin.router)
app.include_router(copilot.router)
app.include_router(integrations.router)
app.include_router(otel.router)
app.include_router(vm.router, prefix="/api/vm", tags=["VM"])


@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "autonomous-observability-api"}
