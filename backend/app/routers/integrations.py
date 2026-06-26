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

_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data"


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AWSConnectRequest(BaseModel):
    connection_name: str
    # Auth Mode 1: IAM Access Key (takes priority if both key and role_arn provided)
    access_key_id: Optional[str] = None
    secret_access_key: Optional[str] = None
    session_token: Optional[str] = None
    # Auth Mode 2: STS AssumeRole
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
        "access_key_id": req.access_key_id or "",
        "secret_access_key": req.secret_access_key or "",
        "session_token": req.session_token or "",
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


# ---------------------------------------------------------------------------
# New telemetry endpoints — Logs, Traces, Audit Events, Config Compliance
# ---------------------------------------------------------------------------

@router.get("/logs")
def get_integration_logs(
    source: Optional[str] = Query(None, description="Filter by source: cloudwatch_logs|vpc_flow_logs"),
    log_group: Optional[str] = Query(None, description="Filter by log group name"),
    limit: int = Query(default=200, le=2000),
):
    """Return CloudWatch log events and VPC Flow Log events."""
    data = _read_json(_DATA_DIR / "integrations" / "logs.json")
    all_events: list[dict] = data.get("log_events", []) + data.get("vpc_flow_events", [])

    if source:
        all_events = [e for e in all_events if e.get("source") == source]
    if log_group:
        all_events = [e for e in all_events if log_group in e.get("log_group", "")]

    return {
        "events": all_events[:limit],
        "total": len(all_events),
        "log_groups": data.get("log_groups", []),
        "updated_at": data.get("updated_at", ""),
    }


@router.get("/traces")
def get_integration_traces(
    has_error: Optional[bool] = Query(None, description="Filter traces with errors"),
    has_fault: Optional[bool] = Query(None, description="Filter traces with faults"),
    service: Optional[str] = Query(None, description="Filter by root service name"),
    limit: int = Query(default=100, le=1000),
):
    """Return X-Ray distributed traces and service map."""
    data = _read_json(_DATA_DIR / "integrations" / "traces.json")
    traces: list[dict] = data.get("traces", [])

    if has_error is not None:
        traces = [t for t in traces if t.get("has_error") == has_error]
    if has_fault is not None:
        traces = [t for t in traces if t.get("has_fault") == has_fault]
    if service:
        traces = [t for t in traces if service.lower() in (t.get("root_service", "") or "").lower()]

    return {
        "traces": traces[:limit],
        "total": len(traces),
        "service_map": data.get("service_map", []),
        "updated_at": data.get("updated_at", ""),
    }


@router.get("/audit-events")
def get_audit_events(
    severity: Optional[str] = Query(None, description="Filter by severity: critical|warning|info"),
    event_name: Optional[str] = Query(None, description="Filter by event name (partial match)"),
    username: Optional[str] = Query(None, description="Filter by IAM username"),
    limit: int = Query(default=200, le=2000),
):
    """Return CloudTrail audit events."""
    data = _read_json(_DATA_DIR / "integrations" / "audit_events.json")
    events: list[dict] = data.get("events", [])

    if severity:
        events = [e for e in events if e.get("severity") == severity]
    if event_name:
        events = [e for e in events if event_name.lower() in e.get("event_name", "").lower()]
    if username:
        events = [e for e in events if username.lower() in (e.get("username", "") or "").lower()]

    return {
        "events": events[:limit],
        "total": len(events),
        "updated_at": data.get("updated_at", ""),
    }


@router.get("/config-compliance")
def get_config_compliance(
    compliant: Optional[bool] = Query(None, description="Filter: true=compliant only, false=non-compliant only"),
    rule_name: Optional[str] = Query(None, description="Filter by rule name (partial match)"),
):
    """Return AWS Config rule compliance status."""
    data = _read_json(_DATA_DIR / "integrations" / "config_compliance.json")
    rules: list[dict] = data.get("rules", [])
    non_compliant: list[dict] = data.get("non_compliant_resources", [])

    if compliant is not None:
        rules = [r for r in rules if r.get("is_compliant") == compliant]
    if rule_name:
        rules = [r for r in rules if rule_name.lower() in r.get("rule_name", "").lower()]
        non_compliant = [r for r in non_compliant if rule_name.lower() in r.get("rule_name", "").lower()]

    return {
        "rules": rules,
        "non_compliant_resources": non_compliant,
        "total_rules": data.get("total_rules", 0),
        "non_compliant_rule_count": data.get("non_compliant_rule_count", 0),
        "updated_at": data.get("updated_at", ""),
    }
