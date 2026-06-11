"""
Integrations API Router — connect cloud providers and query normalized telemetry.

Endpoints:
  POST /api/integrations/aws/connect
  POST /api/integrations/azure/connect
  POST /api/integrations/gcp/connect
  POST /api/integrations/kubernetes/connect
  GET  /api/integrations/resources
  GET  /api/integrations/topology
  GET  /api/integrations/alerts
  GET  /api/integrations/metrics
  POST /api/integrations/sync
  GET  /api/integrations/connections
  DELETE /api/integrations/connections/{connection_id}
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "data"


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AWSConnectRequest(BaseModel):
    connection_name: str
    role_arn: str = ""
    region: str = "us-east-1"
    external_id: Optional[str] = None


class AzureConnectRequest(BaseModel):
    connection_name: str
    tenant_id: str
    client_id: str
    client_secret: str
    subscription_id: str


class GCPConnectRequest(BaseModel):
    connection_name: str
    project_id: str
    service_account_json: dict = Field(default_factory=dict)


class KubernetesConnectRequest(BaseModel):
    connection_name: str
    kubeconfig: Optional[str] = None    # base64-encoded kubeconfig
    endpoint: Optional[str] = None
    token: Optional[str] = None
    ca_cert: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> Any:
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def _trigger_initial_discovery(provider: str, connection_id: str) -> None:
    """Run resource discovery asynchronously for a new connection."""
    try:
        from app.integrations.scheduler import sync_resources
        sync_resources()
    except Exception as exc:
        logger.warning(f"[Integrations] Initial discovery failed for {provider}/{connection_id}: {exc}")


# ---------------------------------------------------------------------------
# Connect endpoints
# ---------------------------------------------------------------------------

@router.post("/aws/connect")
def connect_aws(req: AWSConnectRequest, background_tasks: BackgroundTasks):
    """Register an AWS account via IAM Role ARN."""
    from app.integrations.aws.auth import validate_credentials
    from app.integrations.credential_store import save_connection

    config = {
        "connection_name": req.connection_name,
        "role_arn": req.role_arn,
        "region": req.region,
        "external_id": req.external_id or "",
    }

    ok, message = validate_credentials(config)
    if not ok:
        raise HTTPException(status_code=400, detail=f"AWS credential validation failed: {message}")

    save_connection("aws", req.connection_name, config)
    background_tasks.add_task(_trigger_initial_discovery, "aws", req.connection_name)

    return {
        "status": "connected",
        "provider": "aws",
        "connection_id": req.connection_name,
        "region": req.region,
        "message": message,
        "discovery": "started in background",
    }


@router.post("/azure/connect")
def connect_azure(req: AzureConnectRequest, background_tasks: BackgroundTasks):
    """Register an Azure subscription via Service Principal."""
    from app.integrations.azure.auth import validate_credentials
    from app.integrations.credential_store import save_connection

    config = {
        "connection_name": req.connection_name,
        "tenant_id": req.tenant_id,
        "client_id": req.client_id,
        "client_secret": req.client_secret,
        "subscription_id": req.subscription_id,
    }

    ok, message = validate_credentials(config)
    if not ok:
        raise HTTPException(status_code=400, detail=f"Azure credential validation failed: {message}")

    save_connection("azure", req.connection_name, config)
    background_tasks.add_task(_trigger_initial_discovery, "azure", req.connection_name)

    return {
        "status": "connected",
        "provider": "azure",
        "connection_id": req.connection_name,
        "subscription_id": req.subscription_id,
        "message": message,
        "discovery": "started in background",
    }


@router.post("/gcp/connect")
def connect_gcp(req: GCPConnectRequest, background_tasks: BackgroundTasks):
    """Register a GCP project via Service Account JSON."""
    from app.integrations.gcp.auth import validate_credentials
    from app.integrations.credential_store import save_connection

    config = {
        "connection_name": req.connection_name,
        "project_id": req.project_id,
        "service_account_json": req.service_account_json,
    }

    ok, message = validate_credentials(config)
    if not ok:
        raise HTTPException(status_code=400, detail=f"GCP credential validation failed: {message}")

    save_connection("gcp", req.connection_name, config)
    background_tasks.add_task(_trigger_initial_discovery, "gcp", req.connection_name)

    return {
        "status": "connected",
        "provider": "gcp",
        "connection_id": req.connection_name,
        "project_id": req.project_id,
        "message": message,
        "discovery": "started in background",
    }


@router.post("/kubernetes/connect")
def connect_kubernetes(req: KubernetesConnectRequest, background_tasks: BackgroundTasks):
    """Register a Kubernetes cluster via kubeconfig or endpoint+token."""
    from app.integrations.kubernetes.auth import validate_credentials
    from app.integrations.credential_store import save_connection

    config = {
        "connection_name": req.connection_name,
        "kubeconfig": req.kubeconfig or "",
        "endpoint": req.endpoint or "",
        "token": req.token or "",
        "ca_cert": req.ca_cert or "",
    }

    ok, message = validate_credentials(config)
    if not ok:
        raise HTTPException(status_code=400, detail=f"Kubernetes credential validation failed: {message}")

    save_connection("kubernetes", req.connection_name, config)
    background_tasks.add_task(_trigger_initial_discovery, "kubernetes", req.connection_name)

    return {
        "status": "connected",
        "provider": "kubernetes",
        "connection_id": req.connection_name,
        "message": message,
        "discovery": "started in background",
    }


# ---------------------------------------------------------------------------
# Query endpoints
# ---------------------------------------------------------------------------

@router.get("/resources")
def get_resources(
    provider: Optional[str] = Query(None, description="Filter by provider: aws|azure|gcp|kubernetes"),
    resource_type: Optional[str] = Query(None, description="Filter by resource_type"),
    health: Optional[str] = Query(None, description="Filter by health: healthy|warning|critical"),
    limit: int = Query(default=200, le=2000),
):
    """Return all discovered cloud resources."""
    data = _read_json(_DATA_DIR / "integrations" / "resources.json")
    resources: list[dict] = data.get("resources", [])

    if provider:
        resources = [r for r in resources if r.get("provider") == provider]
    if resource_type:
        resources = [r for r in resources if r.get("resource_type") == resource_type]
    if health:
        resources = [r for r in resources if r.get("health") == health]

    return {
        "resources": resources[:limit],
        "total": len(resources),
        "synced_at": data.get("synced_at", ""),
    }


@router.get("/topology")
def get_topology(provider: Optional[str] = Query(None)):
    """Return normalized topology edges from the dependency graph."""
    data = _read_json(_DATA_DIR / "dependencies" / "dependency_graph.json")
    edges = data.get("edges", [])
    cloud_edges = [e for e in edges if e.get("type") == "cloud_dependency"]
    if provider:
        cloud_edges = [e for e in cloud_edges if e.get("provider") == provider]
    return {
        "edges": cloud_edges,
        "total": len(cloud_edges),
    }


@router.get("/alerts")
def get_integration_alerts(
    provider: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(default=100, le=1000),
):
    """Return normalized alerts from all cloud providers."""
    data = _read_json(_DATA_DIR / "monitoring" / "alerts.json")
    alerts = data.get("alerts", [])
    cloud_alerts = [a for a in alerts if a.get("provider") in ("aws", "azure", "gcp", "kubernetes")]

    if provider:
        cloud_alerts = [a for a in cloud_alerts if a.get("provider") == provider]
    if severity:
        cloud_alerts = [a for a in cloud_alerts if a.get("severity") == severity]
    if status:
        cloud_alerts = [a for a in cloud_alerts if a.get("status") == status]

    return {
        "alerts": cloud_alerts[:limit],
        "total": len(cloud_alerts),
    }


@router.get("/metrics")
def get_integration_metrics(
    provider: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    limit: int = Query(default=200, le=2000),
):
    """Return normalized metrics from all cloud providers."""
    data = _read_json(_DATA_DIR / "monitoring" / "metrics.json")
    metrics = data.get("metrics", [])
    cloud_metrics = [m for m in metrics if m.get("provider") in ("aws", "azure", "gcp", "kubernetes")]

    if provider:
        cloud_metrics = [m for m in cloud_metrics if m.get("provider") == provider]
    if resource_type:
        cloud_metrics = [m for m in cloud_metrics if m.get("resource_type") == resource_type]

    return {
        "metrics": cloud_metrics[:limit],
        "total": len(cloud_metrics),
    }


# ---------------------------------------------------------------------------
# Sync endpoint
# ---------------------------------------------------------------------------

@router.post("/sync")
def trigger_sync():
    """Trigger an immediate full sync (resources + metrics + alerts) for all connections."""
    from app.integrations.scheduler import trigger_full_sync
    results = trigger_full_sync()
    return {
        "status": "completed",
        "results": results,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------

@router.get("/connections")
def list_connections(provider: Optional[str] = Query(None)):
    """List all configured cloud connections (no secrets returned)."""
    from app.integrations.credential_store import list_connections as _list
    connections = _list(provider=provider)
    return {"connections": connections, "total": len(connections)}


@router.delete("/connections/{connection_id}")
def delete_connection(connection_id: str, provider: str = Query(..., description="Provider: aws|azure|gcp|kubernetes")):
    """Remove a cloud connection and its stored credentials."""
    from app.integrations.credential_store import delete_connection as _delete
    deleted = _delete(provider, connection_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Connection '{connection_id}' not found for provider '{provider}'")
    return {"status": "deleted", "connection_id": connection_id, "provider": provider}
