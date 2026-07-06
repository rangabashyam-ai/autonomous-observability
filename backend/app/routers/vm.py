from fastapi import APIRouter, HTTPException, Query
from typing import Optional
import os
import requests
import logging

from app.minio_intel_store import MinioIntelUnavailable
from app.minio_intel_store import fetch_alerts as fetch_minio_alerts
from app.minio_intel_store import fetch_incidents as fetch_minio_incidents
from app.minio_intel_store import incidents_parquet_available, alerts_parquet_available
from app.minio_intel_store import http_unavailable
from app import vm_data_store
from app.data_availability import is_ui_data_available

log = logging.getLogger("api")

router = APIRouter()

VM_API_URL = os.getenv("VM_API_URL", "http://127.0.0.1:8080")


def _fetch_incidents_from_vm_api(
    status: Optional[str],
    cmdb_id: Optional[str],
    limit: int,
) -> list[dict]:
    """Fallback: proxy to the external VM service on :8080."""
    try:
        params: dict = {"limit": limit}
        if status:
            params["status"] = status
        if cmdb_id:
            params["cmdb_id"] = cmdb_id
        for path in ("/api/incidents", "/incidents"):
            res = requests.get(f"{VM_API_URL}{path}", params=params, timeout=8)
            if res.status_code != 200:
                continue
            data = res.json()
            if isinstance(data, list):
                return data[:limit]
            incidents = data.get("incidents", [])
            if incidents:
                return incidents[:limit]
    except requests.exceptions.RequestException as exc:
        log.warning("VM API incidents fallback failed: %s", exc)
    return []


def _resolve_incidents(
    status: Optional[str],
    cmdb_id: Optional[str],
    limit: int,
) -> tuple[list[dict], str]:
    # 1. MinIO — primary store the VM pushes into
    try:
        incidents = fetch_minio_incidents(status=status, cmdb_id=cmdb_id, limit=limit)
        if incidents:
            return incidents, "minio_parquet"
    except MinioIntelUnavailable:
        pass

    # 2. Local VM ingest buffer
    pushed = vm_data_store.get("incidents")
    if pushed:
        incidents = pushed.get("incidents", [])
        if incidents:
            return incidents[:limit], "vm_push"

    # 3. Direct VM API proxy
    incidents = _fetch_incidents_from_vm_api(status, cmdb_id, limit)
    if incidents:
        return incidents, "vm_api"

    return [], "none"


def _resolve_alerts(state: Optional[str], limit: int) -> tuple[list[dict], str]:
    try:
        alerts = fetch_minio_alerts(limit=limit)
        if alerts:
            if state:
                alerts = [a for a in alerts if a.get("status") == state or a.get("state") == state]
            return alerts[:limit], "minio_parquet"
    except MinioIntelUnavailable:
        pass

    pushed = vm_data_store.get("alerts")
    if pushed:
        alerts = pushed.get("alerts", [])
        if alerts:
            return alerts[:limit], "vm_push"

    return [], "none"


@router.get("/incidents")
def get_vm_incidents(
    cmdb_id: Optional[str] = Query(None, description="Filter by component name"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(200, description="Limit records"),
    raw: bool = Query(False, description="Return raw array directly"),
):
    incidents, source = _resolve_incidents(status, cmdb_id, limit)
    available = len(incidents) > 0 or incidents_parquet_available()

    if raw:
        return incidents
    return {
        "status": "success",
        "source": source,
        "count": len(incidents),
        "incidents": incidents,
        "dataset_available": available,
    }


@router.get("/alerts")
def get_vm_alerts(
    state: Optional[str] = Query(None, description="Filter state"),
    limit: int = Query(500, description="Limit records"),
    raw: bool = Query(False, description="Return raw array directly"),
):
    alerts, source = _resolve_alerts(state, limit)
    available = len(alerts) > 0 or alerts_parquet_available()

    if raw:
        return alerts
    return {
        "status": "success",
        "source": source,
        "count": len(alerts),
        "alerts": alerts,
        "dataset_available": available,
    }


@router.get("/traces/get_trace_by_id")
def get_vm_trace_by_id(trace_id: str = Query(..., description="The trace ID to fetch")):
    try:
        url = f"{VM_API_URL}/traces/get_trace_by_id"
        params = {"trace_id": trace_id}
        log.info("Proxying trace request to VM: %s with ID: %s", url, trace_id)
        res = requests.get(url, params=params, timeout=10)
        res.raise_for_status()
        return res.json()
    except requests.exceptions.RequestException as e:
        log.warning("Failed to fetch trace from VM API (%s).", e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch trace from VM: {e}")


@router.get("/traces/spans")
def get_vm_trace_spans(trace_id: str = Query(..., description="The trace ID to fetch")):
    """Return flat span list — frontend displays without OTLP parsing."""
    from app.trace_parser import parse_otlp_trace

    try:
        url = f"{VM_API_URL}/traces/get_trace_by_id"
        res = requests.get(url, params={"trace_id": trace_id}, timeout=15)
        res.raise_for_status()
        payload = res.json()
    except requests.exceptions.RequestException as e:
        log.warning("Failed to fetch trace from VM API (%s).", e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch trace from VM: {e}")

    spans = parse_otlp_trace(payload)
    return {
        "trace_id": trace_id,
        "spans": spans,
        "span_count": len(spans),
        "source": "vm",
        "dataset_available": len(spans) > 0,
    }


@router.get("/status")
def vm_service_status():
    from app import parquet_store

    incidents, inc_source = _resolve_incidents(None, None, 1)
    return {
        "parquet_available": parquet_store.is_dataset_available(),
        "minio_incidents_available": incidents_parquet_available(),
        "minio_alerts_available": alerts_parquet_available(),
        "ui_data_available": is_ui_data_available(),
        "incidents_source": inc_source,
        "incidents_count_preview": len(incidents),
        **vm_data_store.status(),
    }
