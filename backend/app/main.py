import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import dependencies, monitoring, incidents, intelligence, admin, copilot, integrations, rca_engine

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)


_DEP_FILES = [
    "dependencies/services.json",
    "dependencies/infrastructure.json",
    "dependencies/dependency_graph.json",
]


def _prebuild_dependency_files() -> None:
    """
    Pre-compute dependency graph data from parquet and persist to JSON files.
    On first run this takes a few seconds; on every subsequent startup the JSON
    files are already present so this returns immediately.
    Delete any of the three files to force a rebuild.
    """
    import logging
    log = logging.getLogger(__name__)

    from app.data_store import DATA_DIR, write_json
    from app import parquet_store

    missing = [f for f in _DEP_FILES if not (DATA_DIR / f).exists()]
    if not missing:
        log.info("[startup] Static dependency files already cached — skipping prebuild.")
        # Still warm in-memory parquet cache for RCA / incident analysis
        try:
            parquet_store._svc_host_map()
            parquet_store._metric_app()
            parquet_store._metric_cpu()
        except Exception:
            pass
        return

    log.info(f"[startup] Prebuilding {len(missing)} dependency file(s) from parquet (first-run only)…")
    for filename in missing:
        try:
            data = parquet_store.query(filename)
            write_json(filename, data)
            n = len(data.get("nodes", data.get("services", data.get("edges", []))))
            log.info(f"[startup]   ✓ {filename}  ({n} records)")
        except Exception as exc:
            log.warning(f"[startup]   ✗ {filename} failed: {exc}")

    log.info("[startup] Dependency files ready — API will now serve from JSON cache.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _prebuild_dependency_files)
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
app.include_router(rca_engine.router)


@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "autonomous-observability-api"}
