"""Open ingest endpoints for the external VM to push observability data.

The frontend reads this data through existing GET routes (with VM-store fallback)
or dedicated /api/vm/* read endpoints. No computation is required on the frontend.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException

from app import vm_data_store

router = APIRouter(prefix="/api/vm/ingest", tags=["VM Ingest"])


@router.get("/status")
def ingest_status():
    return vm_data_store.status()


@router.post("/monitoring/dashboard")
def ingest_monitoring_dashboard(payload: dict[str, Any] = Body(...)):
    """Push executive / service / technical / infrastructure dashboard payload."""
    return vm_data_store.set("monitoring/dashboard", payload)


@router.post("/dependencies/graph")
def ingest_dependency_graph(payload: dict[str, Any] = Body(...)):
    """Push { nodes: [], edges: [] } dependency graph."""
    if "nodes" not in payload and "edges" not in payload:
        raise HTTPException(status_code=400, detail="Expected nodes and/or edges")
    return vm_data_store.set("dependencies/graph", payload)


@router.post("/overview")
def ingest_overview(payload: dict[str, Any] = Body(...)):
    """Push platform overview (summary, recent_incidents, early_detections, etc.)."""
    return vm_data_store.set("overview", payload)


@router.post("/early-detection")
def ingest_early_detection(payload: dict[str, Any] = Body(...)):
    """Push early-detection analysis result (detections, summary, feeds)."""
    return vm_data_store.set("early-detection", payload)


@router.post("/ops/entities")
def ingest_ops_entities(payload: dict[str, Any] = Body(...)):
    """Push { entities: OpsEntity[] }."""
    entities = payload.get("entities", payload if isinstance(payload, list) else [])
    return vm_data_store.set("ops/entities", {"entities": entities, "total": len(entities)})


@router.post("/ops/sections")
def ingest_ops_sections(payload: dict[str, Any] = Body(...)):
    """Push pre-shaped table rows for an ops section.

    Body: { dashboard_id, derive_key, rows: [], columns?: [] }
    """
    dashboard_id = payload.get("dashboard_id")
    derive_key = payload.get("derive_key")
    if not dashboard_id or not derive_key:
        raise HTTPException(status_code=400, detail="dashboard_id and derive_key required")
    store_key = f"ops/sections/{dashboard_id}/{derive_key}"
    return vm_data_store.set(store_key, payload)


@router.post("/timeseries")
def ingest_timeseries(payload: dict[str, Any] = Body(...)):
    """Push time-series points: { metric, entity_id?, points: [{t, v}] }."""
    metric = payload.get("metric")
    if not metric:
        raise HTTPException(status_code=400, detail="metric is required")
    store_key = f"timeseries/{metric}"
    entity_id = payload.get("entity_id")
    if entity_id:
        store_key = f"timeseries/{metric}/{entity_id}"
    return vm_data_store.set(store_key, payload)


@router.post("/incidents")
def ingest_incidents(payload: dict[str, Any] = Body(...)):
    """Push incident list (bank format). Body: { incidents: [] } or raw array."""
    incidents = payload.get("incidents", payload if isinstance(payload, list) else [])
    return vm_data_store.set("incidents", {"incidents": incidents, "count": len(incidents)})


@router.post("/alerts")
def ingest_alerts(payload: dict[str, Any] = Body(...)):
    """Push alert list. Body: { alerts: [] } or raw array."""
    alerts = payload.get("alerts", payload if isinstance(payload, list) else [])
    return vm_data_store.set("alerts", {"alerts": alerts, "count": len(alerts)})


@router.post("/widgets/{dashboard_id}")
def ingest_dashboard_widgets(dashboard_id: str, payload: dict[str, Any] = Body(...)):
    """Push pre-computed widget payloads for a dashboard (executive, service-ops, etc.)."""
    return vm_data_store.set(f"{dashboard_id}/widgets", payload)


@router.delete("/clear")
def clear_vm_data():
    vm_data_store.clear()
    return {"status": "cleared"}
