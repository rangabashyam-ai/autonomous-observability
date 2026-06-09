import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import dependencies, monitoring, incidents, intelligence, admin, copilot

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

app = FastAPI(
    title="Autonomous IT Operations Intelligence Platform",
    description="MVP API for synthetic observability, dependency mapping, and incident intelligence",
    version="0.2.0",
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


@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "autonomous-observability-api"}
