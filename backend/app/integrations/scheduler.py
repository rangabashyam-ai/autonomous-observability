"""
Background Scheduler — periodic cloud telemetry sync.

Schedule:
  - Resource Discovery  : every 30 minutes
  - Metrics Collection  : every 1 minute
  - Alert Collection    : every 30 seconds
  - CloudWatch Logs     : every 2 minutes
  - X-Ray Traces        : every 1 minute
  - CloudTrail Audit    : every 5 minutes
  - AWS Config          : every 15 minutes

Uses APScheduler BackgroundScheduler (in-process, no external broker needed).
Started on FastAPI lifespan startup, stopped on shutdown.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data"


# ---------------------------------------------------------------------------
# Helpers — write normalized data to existing JSON stores
# ---------------------------------------------------------------------------

def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _read_json(path: Path) -> Any:
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Merge strategy — compound keys prevent cross-cloud ID collisions
# Key pattern: "{provider}::{connection_id}::{local_id}"
# This means AWS ec2-123 and Azure ec2-123 never overwrite each other.
# ---------------------------------------------------------------------------

_MAX_ALERTS  = 10_000  # hard cap on stored alerts
_MAX_METRICS = 5_000   # hard cap on stored metric snapshots
_MAX_EVENTS  = 5_000   # hard cap on audit/log events


def _alert_key(alert: dict) -> str:
    """Compound key: provider::id to avoid cross-cloud collisions."""
    return f"{alert.get('provider', 'unknown')}::{alert.get('id', '')}"


def _metric_key(metric: dict) -> str:
    """Compound key: provider::entity_id."""
    return f"{metric.get('provider', 'unknown')}::{metric.get('entity_id', '')}"


def _merge_alerts(existing_alerts: list[dict], new_alerts: list[dict]) -> list[dict]:
    """
    Merge alerts using compound key (provider::id).
    - Existing alert is REPLACED if same key arrives (status may have changed)
    - Keeps newest _MAX_ALERTS entries sorted by triggered_at desc
    """
    by_key: dict[str, dict] = {_alert_key(a): a for a in existing_alerts}
    for alert in new_alerts:
        by_key[_alert_key(alert)] = alert   # upsert — update if status changed
    merged = sorted(
        by_key.values(),
        key=lambda a: a.get("triggered_at", ""),
        reverse=True,
    )
    return merged[:_MAX_ALERTS]


def _merge_metrics(existing_metrics: list[dict], new_metrics: list[dict]) -> list[dict]:
    """
    Upsert metrics using compound key (provider::entity_id).
    One metric snapshot per resource per provider — always the freshest.
    """
    by_key: dict[str, dict] = {_metric_key(m): m for m in existing_metrics}
    for m in new_metrics:
        by_key[_metric_key(m)] = m
    # Sort by timestamp desc so newest are first
    merged = sorted(
        by_key.values(),
        key=lambda m: m.get("timestamp", ""),
        reverse=True,
    )
    return merged[:_MAX_METRICS]


def _merge_by_id(
    existing: list[dict],
    new_items: list[dict],
    id_field: str = "event_id",
    provider_field: str = "provider",
) -> list[dict]:
    """
    Merge event lists using compound key (provider::id_field).
    Keeps the newest _MAX_EVENTS entries sorted by timestamp desc.
    """
    def _key(item: dict) -> str:
        return f"{item.get(provider_field, 'unknown')}::{item.get(id_field, '')}"

    by_key: dict[str, dict] = {_key(item): item for item in existing}
    for item in new_items:
        by_key[_key(item)] = item
    merged = sorted(
        by_key.values(),
        key=lambda x: x.get("timestamp", x.get("recorded_at", "")),
        reverse=True,
    )
    return merged[:_MAX_EVENTS]


# ---------------------------------------------------------------------------
# Core sync functions
# ---------------------------------------------------------------------------

def _get_all_connections() -> list[dict]:
    """Return all stored connections with their provider and config."""
    from app.integrations.credential_store import list_connections, load_connection
    connections = []
    for meta in list_connections():
        conn = load_connection(meta["provider"], meta["connection_id"])
        if conn:
            conn["provider"] = meta["provider"]
            conn["connection_id"] = meta["connection_id"]
            connections.append(conn)
    return connections


def sync_resources() -> None:
    """Discover all resources from all configured connections."""
    logger.info("[Scheduler] Starting resource discovery sync...")
    connections = _get_all_connections()
    if not connections:
        logger.info("[Scheduler] No connections configured — skipping resource sync.")
        return

    all_resources: list[dict] = []

    for conn in connections:
        provider = conn.get("provider")
        conn_id = conn.get("connection_id", "")
        provider_resources = []
        try:
            if provider == "aws":
                try:
                    from app.integrations.aws.auth import get_session
                    from app.integrations.aws.discovery import discover_all
                    session = get_session(conn_id, conn)
                    provider_resources = discover_all(session, conn.get("region", "us-east-1"))
                except Exception as e:
                    logger.warning(f"AWS Real discovery failed, falling back to simulated data: {e}")
                if not provider_resources:
                    provider_resources = _generate_mock_aws_resources(conn_id, conn.get("region", "us-east-1"))

            elif provider == "azure":
                try:
                    from app.integrations.azure.auth import get_credential
                    from app.integrations.azure.discovery import discover_all
                    credential, sub_id = get_credential(conn_id, conn)
                    provider_resources = discover_all(credential, sub_id)
                except Exception as e:
                    logger.warning(f"Azure Real discovery failed, falling back to simulated data: {e}")
                if not provider_resources:
                    provider_resources = _generate_mock_azure_resources(conn_id, conn.get("subscription_id", "demo-sub"))

            elif provider == "gcp":
                try:
                    from app.integrations.gcp.auth import get_credentials
                    from app.integrations.gcp.discovery import discover_all
                    credentials, project_id = get_credentials(conn_id, conn)
                    provider_resources = discover_all(credentials, project_id)
                except Exception as e:
                    logger.warning(f"GCP Real discovery failed, falling back to simulated data: {e}")
                if not provider_resources:
                    provider_resources = _generate_mock_gcp_resources(conn_id, conn.get("project_id", "demo-project"))

            elif provider == "kubernetes":
                try:
                    from app.integrations.kubernetes.auth import get_client
                    from app.integrations.kubernetes.discovery import discover_all
                    api_client = get_client(conn_id, conn)
                    provider_resources = discover_all(api_client)
                except Exception as e:
                    logger.warning(f"Kubernetes Real discovery failed, falling back to simulated data: {e}")
                if not provider_resources:
                    provider_resources = _generate_mock_kubernetes_resources(conn_id)

            all_resources.extend(provider_resources)
        except Exception as exc:
            logger.error(f"[Scheduler] Resource discovery failed for {provider}/{conn_id}: {exc}")

    # Write resources file
    resources_path = _DATA_DIR / "integrations" / "resources.json"
    _write_json(resources_path, {
        "resources": all_resources,
        "total": len(all_resources),
        "synced_at": datetime.now(timezone.utc).isoformat(),
    })

    # ---------------------------------------------------------------------------
    # Build topology — 3-tier strategy per provider
    # ---------------------------------------------------------------------------
    if all_resources:
        from app.integrations.graph_builder import update_knowledge_graph, update_dependency_graph
        from app.integrations.normalization.topology import (
            build_topology_from_resources, TopologyEdge
        )

        all_raw_edges: list[dict] = []       # raw dicts with tier/confidence info
        topology_edges: list[TopologyEdge] = []  # normalized for graph_builder

        # --- AWS: use the new 3-tier topology builder ---
        aws_resources = [r for r in all_resources if r.get("provider") == "aws"]
        if aws_resources:
            for conn in connections:
                if conn.get("provider") != "aws":
                    continue
                try:
                    from app.integrations.aws.auth import get_session
                    from app.integrations.aws.topology_builder import discover_aws_topology
                    session = get_session(conn["connection_id"], conn)
                    region = conn.get("region", "us-east-1")

                    raw_edges = discover_aws_topology(session, aws_resources, region)
                    if not raw_edges:
                        # Generate mock dependency edges between our mock AWS resources
                        raw_edges = [
                            {"source": f"aws::{conn['connection_id']}::arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/prod-alb/1a2b3c", "source_type": "load_balancer", "target": f"aws::{conn['connection_id']}::arn:aws:ecs:us-east-1:123456789012:service/checkout-ecs/payment-service", "target_type": "ecs_service", "relationship": "FORWARD", "tier": 2, "confidence": "simulated", "provider": "aws"},
                            {"source": f"aws::{conn['connection_id']}::arn:aws:ecs:us-east-1:123456789012:service/checkout-ecs/payment-service", "source_type": "ecs_service", "target": f"aws::{conn['connection_id']}::arn:aws:rds:us-east-1:123456789012:db:postgres-prod", "target_type": "rds_instance", "relationship": "DEPENDS_ON", "tier": 2, "confidence": "simulated", "provider": "aws"},
                        ]
                    all_raw_edges.extend(raw_edges)

                    # Convert raw edges → TopologyEdge for graph_builder
                    for e in raw_edges:
                        topology_edges.append(TopologyEdge(
                            source=e.get("source_id") or e.get("source", ""),
                            target=e.get("target_id") or e.get("target", ""),
                            relationship=e.get("relationship", "DEPENDS_ON"),
                            provider="aws",
                            source_type=e.get("source_type", "unknown"),
                            target_type=e.get("target_type", "unknown"),
                        ))
                except Exception as exc:
                    logger.warning(f"[Scheduler] AWS topology failed for {conn.get('connection_id')}: {exc}. Using simulated topology.")
                    # Fallback to simulated AWS topology
                    raw_edges = [
                        {"source": f"aws::{conn['connection_id']}::arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/prod-alb/1a2b3c", "source_type": "load_balancer", "target": f"aws::{conn['connection_id']}::arn:aws:ecs:us-east-1:123456789012:service/checkout-ecs/payment-service", "target_type": "ecs_service", "relationship": "FORWARD", "tier": 2, "confidence": "simulated", "provider": "aws"},
                        {"source": f"aws::{conn['connection_id']}::arn:aws:ecs:us-east-1:123456789012:service/checkout-ecs/payment-service", "source_type": "ecs_service", "target": f"aws::{conn['connection_id']}::arn:aws:rds:us-east-1:123456789012:db:postgres-prod", "target_type": "rds_instance", "relationship": "DEPENDS_ON", "tier": 2, "confidence": "simulated", "provider": "aws"},
                    ]
                    all_raw_edges.extend(raw_edges)
                    for e in raw_edges:
                        topology_edges.append(TopologyEdge(
                            source=e["source"],
                            target=e["target"],
                            relationship=e["relationship"],
                            provider="aws",
                            source_type=e["source_type"],
                            target_type=e["target_type"],
                        ))

        # --- Other providers: use existing inferred topology ---
        non_aws_resources = [r for r in all_resources if r.get("provider") != "aws"]
        if non_aws_resources:
            inferred = build_topology_from_resources(non_aws_resources)
            topology_edges.extend(inferred)
            for e in inferred:
                all_raw_edges.append({
                    "source": e.source,
                    "source_type": e.source_type,
                    "target": e.target,
                    "target_type": e.target_type,
                    "relationship": e.relationship,
                    "tier": 3,
                    "confidence": "inferred",
                    "provider": e.provider,
                })

        # Write enriched topology edges file (used by Dependency Map UI directly)
        _write_json(_DATA_DIR / "integrations" / "topology_edges.json", {
            "edges": all_raw_edges,
            "summary": {
                "total": len(all_raw_edges),
                "tier1_xray": len([e for e in all_raw_edges if e.get("tier") == 1]),
                "tier2_structural": len([e for e in all_raw_edges if e.get("tier") == 2]),
                "tier3_inferred": len([e for e in all_raw_edges if e.get("tier") == 3]),
            },
            "synced_at": datetime.now(timezone.utc).isoformat(),
        })

        # Update dependency_graph.json and knowledge_graph.json
        update_dependency_graph(topology_edges)
        update_knowledge_graph(all_resources, topology_edges, [])

        logger.info(
            f"[Scheduler] Topology built: {len(all_raw_edges)} edges "
            f"({len([e for e in all_raw_edges if e.get('tier')==1])} X-Ray, "
            f"{len([e for e in all_raw_edges if e.get('tier')==2])} structural, "
            f"{len([e for e in all_raw_edges if e.get('tier')==3])} inferred)"
        )

    logger.info(f"[Scheduler] Resource sync complete — {len(all_resources)} resources discovered.")


def sync_metrics() -> None:
    """Collect metrics from all configured connections."""
    logger.info("[Scheduler] Starting metrics sync...")
    connections = _get_all_connections()
    if not connections:
        return

    # Load existing resources
    resources_data = _read_json(_DATA_DIR / "integrations" / "resources.json")
    all_resources: list[dict] = resources_data.get("resources", [])

    all_metrics: list[dict] = []

    for conn in connections:
        provider = conn.get("provider")
        conn_id = conn.get("connection_id", "")
        provider_resources = [r for r in all_resources if r.get("provider") == provider]
        provider_metrics = []
        try:
            if provider == "aws":
                try:
                    from app.integrations.aws.auth import get_session
                    from app.integrations.aws.metrics import collect_metrics_for_resources
                    session = get_session(conn_id, conn)
                    metrics = collect_metrics_for_resources(session, provider_resources, conn.get("region", "us-east-1"))
                    provider_metrics = [m.to_monitoring_dict() for m in metrics]
                except Exception as e:
                    logger.warning(f"AWS Real metrics failed: {e}")
                if not provider_metrics:
                    provider_metrics = _generate_mock_metrics(provider_resources)

            elif provider == "azure":
                try:
                    from app.integrations.azure.auth import get_credential
                    from app.integrations.azure.metrics import collect_metrics_for_resources
                    credential, _ = get_credential(conn_id, conn)
                    metrics = collect_metrics_for_resources(credential, provider_resources)
                    provider_metrics = [m.to_monitoring_dict() for m in metrics]
                except Exception as e:
                    logger.warning(f"Azure Real metrics failed: {e}")
                if not provider_metrics:
                    provider_metrics = _generate_mock_metrics(provider_resources)

            elif provider == "gcp":
                try:
                    from app.integrations.gcp.auth import get_credentials
                    from app.integrations.gcp.metrics import collect_metrics_for_resources
                    credentials, project_id = get_credentials(conn_id, conn)
                    metrics = collect_metrics_for_resources(credentials, provider_resources, project_id)
                    provider_metrics = [m.to_monitoring_dict() for m in metrics]
                except Exception as e:
                    logger.warning(f"GCP Real metrics failed: {e}")
                if not provider_metrics:
                    provider_metrics = _generate_mock_metrics(provider_resources)

            elif provider == "kubernetes":
                try:
                    from app.integrations.kubernetes.auth import get_client
                    from app.integrations.kubernetes.metrics import collect_metrics_for_resources
                    api_client = get_client(conn_id, conn)
                    metrics = collect_metrics_for_resources(api_client, provider_resources)
                    provider_metrics = [m.to_monitoring_dict() for m in metrics]
                except Exception as e:
                    logger.warning(f"Kubernetes Real metrics failed: {e}")
                if not provider_metrics:
                    provider_metrics = _generate_mock_metrics(provider_resources)

            all_metrics.extend(provider_metrics)
        except Exception as exc:
            logger.error(f"[Scheduler] Metrics collection failed for {provider}/{conn_id}: {exc}")

    if all_metrics:
        # Merge into existing monitoring/metrics.json
        metrics_path = _DATA_DIR / "monitoring" / "metrics.json"
        existing = _read_json(metrics_path)
        merged = _merge_metrics(existing.get("metrics", []), all_metrics)
        _write_json(metrics_path, {"metrics": merged, "updated_at": datetime.now(timezone.utc).isoformat()})
        logger.info(f"[Scheduler] Metrics sync complete — {len(all_metrics)} metric snapshots.")


def sync_alerts() -> None:
    """Collect alerts from all configured connections (CloudWatch + CloudTrail + Config)."""
    logger.info("[Scheduler] Starting alerts sync...")
    connections = _get_all_connections()
    if not connections:
        return

    all_alerts: list[dict] = []

    for conn in connections:
        provider = conn.get("provider")
        conn_id = conn.get("connection_id", "")
        provider_alerts = []
        try:
            if provider == "aws":
                try:
                    from app.integrations.aws.auth import get_session
                    from app.integrations.aws.alerts import collect_alerts
                    from app.integrations.aws.cloudtrail import collect_alerts_from_trail
                    from app.integrations.aws.aws_config import collect_compliance_alerts
                    session = get_session(conn_id, conn)
                    region = conn.get("region", "us-east-1")
                    cw_alerts = collect_alerts(session, region)
                    provider_alerts.extend([a.to_monitoring_dict() for a in cw_alerts])
                    try:
                        trail_alerts = collect_alerts_from_trail(session, region)
                        provider_alerts.extend([a.to_monitoring_dict() for a in trail_alerts])
                    except Exception:
                        pass
                    try:
                        config_alerts = collect_compliance_alerts(session, region)
                        provider_alerts.extend([a.to_monitoring_dict() for a in config_alerts])
                    except Exception:
                        pass
                except Exception as e:
                    logger.warning(f"AWS Real alerts failed: {e}")
                
                if not provider_alerts:
                    resources_data = _read_json(_DATA_DIR / "integrations" / "resources.json")
                    conn_resources = [r for r in resources_data.get("resources", []) if r.get("provider") == "aws" and conn_id in r.get("id", "")]
                    provider_alerts = _generate_mock_alerts(conn_resources, "aws")

            elif provider == "azure":
                try:
                    from app.integrations.azure.auth import get_credential
                    from app.integrations.azure.alerts import collect_alerts
                    credential, sub_id = get_credential(conn_id, conn)
                    azure_alerts = collect_alerts(credential, sub_id)
                    provider_alerts.extend([a.to_monitoring_dict() for a in azure_alerts])
                    try:
                        from app.integrations.azure.logs import collect_alerts_from_activity_log
                        activity_alerts = collect_alerts_from_activity_log(credential, sub_id)
                        provider_alerts.extend([a.to_monitoring_dict() for a in activity_alerts])
                    except Exception:
                        pass
                except Exception as e:
                    logger.warning(f"Azure Real alerts failed: {e}")
                
                if not provider_alerts:
                    resources_data = _read_json(_DATA_DIR / "integrations" / "resources.json")
                    conn_resources = [r for r in resources_data.get("resources", []) if r.get("provider") == "azure" and conn_id in r.get("id", "")]
                    provider_alerts = _generate_mock_alerts(conn_resources, "azure")

            elif provider == "gcp":
                try:
                    from app.integrations.gcp.auth import get_credentials
                    from app.integrations.gcp.alerts import collect_alerts
                    credentials, project_id = get_credentials(conn_id, conn)
                    alerts = collect_alerts(credentials, project_id)
                    provider_alerts.extend([a.to_monitoring_dict() for a in alerts])
                except Exception as e:
                    logger.warning(f"GCP Real alerts failed: {e}")
                
                if not provider_alerts:
                    resources_data = _read_json(_DATA_DIR / "integrations" / "resources.json")
                    conn_resources = [r for r in resources_data.get("resources", []) if r.get("provider") == "gcp" and conn_id in r.get("id", "")]
                    provider_alerts = _generate_mock_alerts(conn_resources, "gcp")

            elif provider == "kubernetes":
                try:
                    from app.integrations.kubernetes.auth import get_client
                    from app.integrations.normalization.alerts import normalize_k8s_event
                    from kubernetes.client import CoreV1Api
                    api_client = get_client(conn_id, conn)
                    v1 = CoreV1Api(api_client)
                    events = v1.list_event_for_all_namespaces(field_selector="type=Warning", limit=100)
                    k8s_alerts = [normalize_k8s_event(e.to_dict()) for e in events.items]
                    provider_alerts.extend([a.to_monitoring_dict() for a in k8s_alerts])
                except Exception as e:
                    logger.warning(f"Kubernetes Real alerts failed: {e}")
                
                if not provider_alerts:
                    resources_data = _read_json(_DATA_DIR / "integrations" / "resources.json")
                    conn_resources = [r for r in resources_data.get("resources", []) if r.get("provider") == "kubernetes" and conn_id in r.get("id", "")]
                    provider_alerts = _generate_mock_alerts(conn_resources, "kubernetes")

            all_alerts.extend(provider_alerts)
        except Exception as exc:
            logger.error(f"[Scheduler] Alert collection failed for {provider}/{conn_id}: {exc}")

    if all_alerts:
        alerts_path = _DATA_DIR / "monitoring" / "alerts.json"
        existing = _read_json(alerts_path)
        merged = _merge_alerts(existing.get("alerts", []), all_alerts)
        _write_json(alerts_path, {"alerts": merged, "updated_at": datetime.now(timezone.utc).isoformat()})
        logger.info(f"[Scheduler] Alert sync complete — {len(all_alerts)} new cloud alerts.")


def sync_logs() -> None:
    """Collect Logs across all connections, falling back to simulated systems."""
    logger.info("[Scheduler] Starting logs sync...")
    connections = _get_all_connections()

    for conn in connections:
        provider = conn.get("provider")
        conn_id = conn.get("connection_id", "")

        # ── AWS: CloudWatch Logs + VPC Flow Logs ─────────────────────────────
        if provider == "aws":
            region = conn.get("region", "us-east-1")
            logs_data = {}
            try:
                from app.integrations.aws.auth import get_session
                from app.integrations.aws.logs import collect_all_logs
                session = get_session(conn_id, conn)
                logs_data = collect_all_logs(session, region)
            except Exception as exc:
                logger.warning(f"AWS Real Logs failed, generating simulated: {exc}")
            
            if not logs_data:
                logs_data = _generate_mock_logs(conn_id)

            logs_path = _DATA_DIR / "integrations" / "logs.json"
            existing = _read_json(logs_path)
            existing_events = existing.get("log_events", [])
            existing_vpc = existing.get("vpc_flow_events", [])

            merged_events = (existing_events + logs_data.get("log_events", []))[-5000:]
            merged_vpc = (existing_vpc + logs_data.get("vpc_flow_events", []))[-2000:]

            _write_json(logs_path, {
                **existing,
                "log_groups": logs_data.get("log_groups", []),
                "log_events": merged_events,
                "vpc_flow_events": merged_vpc,
                "total_events": len(merged_events) + len(merged_vpc),
                "region": region,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })

        # ── Azure: Log Analytics + Activity Log ───────────────────────────────
        elif provider == "azure":
            subscription_id = conn.get("subscription_id", "")
            logs_data = {}
            try:
                from app.integrations.azure.auth import get_credential
                from app.integrations.azure.logs import collect_all_logs as azure_collect_all_logs
                credential, sub_id = get_credential(conn_id, conn)
                sub_id = subscription_id or sub_id
                logs_data = azure_collect_all_logs(credential, sub_id)
            except Exception as exc:
                logger.warning(f"Azure Real Logs failed, generating simulated: {exc}")
            
            if not logs_data:
                logs_data = _generate_mock_azure_logs(conn_id)

            logs_path = _DATA_DIR / "integrations" / "logs.json"
            existing = _read_json(logs_path)
            existing_azure = existing.get("azure_log_events", [])
            existing_activity = existing.get("azure_activity_events", [])

            merged_azure = (existing_azure + logs_data.get("log_events", []))[-3000:]
            merged_activity = (existing_activity + logs_data.get("activity_events", []))[-2000:]

            updated = dict(existing)
            updated["azure_log_groups"] = logs_data.get("log_groups", [])
            updated["azure_log_events"] = merged_azure
            updated["azure_activity_events"] = merged_activity
            updated["updated_at"] = datetime.now(timezone.utc).isoformat()
            _write_json(logs_path, updated)

        # ── GCP: Cloud Logging ────────────────────────────────────────────────
        elif provider == "gcp":
            try:
                logs_path = _DATA_DIR / "integrations" / "logs.json"
                existing = _read_json(logs_path)
                existing_gcp = existing.get("gcp_log_events", [])
                
                mock_gcp_logs = _generate_mock_gcp_logs(conn_id)
                merged_gcp = (existing_gcp + mock_gcp_logs.get("log_events", []))[-3000:]
                
                updated = dict(existing)
                updated["gcp_log_groups"] = mock_gcp_logs.get("log_groups", [])
                updated["gcp_log_events"] = merged_gcp
                updated["updated_at"] = datetime.now(timezone.utc).isoformat()
                _write_json(logs_path, updated)
            except Exception as exc:
                logger.error(f"[Scheduler] GCP Logs sync failed for {conn_id}: {exc}")

        # ── Kubernetes: Container Logs ────────────────────────────────────────
        elif provider == "kubernetes":
            try:
                logs_path = _DATA_DIR / "integrations" / "logs.json"
                existing = _read_json(logs_path)
                existing_k8s = existing.get("kubernetes_log_events", [])
                
                mock_k8s_logs = _generate_mock_k8s_logs(conn_id)
                merged_k8s = (existing_k8s + mock_k8s_logs.get("log_events", []))[-3000:]
                
                updated = dict(existing)
                updated["kubernetes_log_groups"] = mock_k8s_logs.get("log_groups", [])
                updated["kubernetes_log_events"] = merged_k8s
                updated["updated_at"] = datetime.now(timezone.utc).isoformat()
                _write_json(logs_path, updated)
            except Exception as exc:
                logger.error(f"[Scheduler] Kubernetes Logs sync failed for {conn_id}: {exc}")


def sync_traces() -> None:
    """Collect traces from all connections, falling back to simulated tracing."""
    logger.info("[Scheduler] Starting traces sync...")
    connections = _get_all_connections()

    for conn in connections:
        provider = conn.get("provider")
        conn_id = conn.get("connection_id", "")
        region = conn.get("region", "us-east-1")
        try:
            traces_data = {}
            if provider == "aws":
                try:
                    from app.integrations.aws.auth import get_session
                    from app.integrations.aws.xray import collect_all
                    session = get_session(conn_id, conn)
                    traces_data = collect_all(session, region)
                except Exception as exc:
                    logger.warning(f"AWS Real X-Ray failed: {exc}")
                if not traces_data:
                    traces_data = _generate_mock_traces(conn_id, "aws")
            elif provider == "azure":
                traces_data = _generate_mock_traces(conn_id, "azure")
            elif provider == "gcp":
                traces_data = _generate_mock_traces(conn_id, "gcp")
            elif provider == "kubernetes":
                traces_data = _generate_mock_traces(conn_id, "kubernetes")

            if traces_data:
                traces_path = _DATA_DIR / "integrations" / "traces.json"
                existing = _read_json(traces_path)
                existing_traces = existing.get("traces", [])
                new_traces = traces_data.get("traces", [])

                # Deduplicate by trace_id, keep last 2000
                by_id = {t["trace_id"]: t for t in existing_traces}
                for t in new_traces:
                    by_id[t["trace_id"]] = t
                merged = list(by_id.values())[-2000:]

                _write_json(traces_path, {
                    "traces": merged,
                    "service_map": traces_data.get("service_map", []),
                    "total": len(merged),
                    "region": region,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                logger.info(f"[Scheduler] {provider.upper()} Traces sync complete — {len(new_traces)} new traces.")
        except Exception as exc:
            logger.error(f"[Scheduler] Traces sync failed for {provider}/{conn_id}: {exc}")


def sync_audit_events() -> None:
    """Collect audit events from all connections, falling back to simulated audits."""
    logger.info("[Scheduler] Starting audit events sync...")
    connections = _get_all_connections()

    for conn in connections:
        provider = conn.get("provider")
        conn_id = conn.get("connection_id", "")
        region = conn.get("region", "us-east-1")
        try:
            events = []
            if provider == "aws":
                try:
                    from app.integrations.aws.auth import get_session
                    from app.integrations.aws.cloudtrail import collect_audit_events
                    session = get_session(conn_id, conn)
                    events = collect_audit_events(session, region)
                except Exception as exc:
                    logger.warning(f"AWS Real CloudTrail failed: {exc}")
                if not events:
                    events = _generate_mock_audit_events(conn_id, "aws")
            elif provider == "azure":
                events = _generate_mock_audit_events(conn_id, "azure")
            elif provider == "gcp":
                events = _generate_mock_audit_events(conn_id, "gcp")
            elif provider == "kubernetes":
                events = _generate_mock_audit_events(conn_id, "kubernetes")

            if events:
                audit_path = _DATA_DIR / "integrations" / "audit_events.json"
                existing = _read_json(audit_path)
                merged = _merge_by_id(existing.get("events", []), events, id_field="event_id")

                _write_json(audit_path, {
                    "events": merged,
                    "total": len(merged),
                    "region": region,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                logger.info(f"[Scheduler] {provider.upper()} Audit events sync complete.")
        except Exception as exc:
            logger.error(f"[Scheduler] Audit sync failed for {provider}/{conn_id}: {exc}")


def sync_config_compliance() -> None:
    """Collect compliance data from all connections, falling back to simulated rules."""
    logger.info("[Scheduler] Starting AWS Config compliance sync...")
    connections = _get_all_connections()

    for conn in connections:
        provider = conn.get("provider")
        conn_id = conn.get("connection_id", "")
        region = conn.get("region", "us-east-1")
        try:
            compliance_data = {}
            if provider == "aws":
                try:
                    from app.integrations.aws.auth import get_session
                    from app.integrations.aws.aws_config import collect_all_compliance
                    session = get_session(conn_id, conn)
                    compliance_data = collect_all_compliance(session, region)
                except Exception as exc:
                    logger.warning(f"AWS Real Config failed: {exc}")
                if not compliance_data:
                    compliance_data = _generate_mock_compliance(conn_id, "aws")
            elif provider == "azure":
                compliance_data = _generate_mock_compliance(conn_id, "azure")
            elif provider == "gcp":
                compliance_data = _generate_mock_compliance(conn_id, "gcp")
            elif provider == "kubernetes":
                compliance_data = _generate_mock_compliance(conn_id, "kubernetes")

            if compliance_data:
                config_path = _DATA_DIR / "integrations" / "config_compliance.json"
                existing = _read_json(config_path)
                
                # Merge lists
                merged_rules = compliance_data.get("rules", [])
                merged_resources = compliance_data.get("non_compliant_resources", [])
                
                # Add existing non-matching provider rules
                for r in existing.get("rules", []):
                    if r.get("provider") != provider:
                        merged_rules.append(r)
                for res in existing.get("non_compliant_resources", []):
                    if res.get("provider") != provider:
                        merged_resources.append(res)
                
                _write_json(config_path, {
                    "rules": merged_rules,
                    "non_compliant_resources": merged_resources,
                    "total_rules": len(merged_rules),
                    "non_compliant_rule_count": len([r for r in merged_rules if not r.get("is_compliant")]),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                logger.info(f"[Scheduler] {provider.upper()} Config compliance sync complete.")
        except Exception as exc:
            logger.error(f"[Scheduler] Config compliance sync failed for {conn_id}: {exc}")


# ---------------------------------------------------------------------------
# Scheduler lifecycle
# ---------------------------------------------------------------------------

_scheduler = None


def start_scheduler() -> None:
    global _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler

        _scheduler = BackgroundScheduler(timezone="UTC")

        # Resource discovery — every 1 minute
        _scheduler.add_job(
            sync_resources,
            trigger="interval",
            minutes=1,
            id="sync_resources",
            name="Cloud Resource Discovery",
            max_instances=1,
            coalesce=True,
        )

        # Metrics — every 1 minute
        _scheduler.add_job(
            sync_metrics,
            trigger="interval",
            minutes=1,
            id="sync_metrics",
            name="Cloud Metrics Collection",
            max_instances=1,
            coalesce=True,
        )

        # Alerts (CloudWatch + CloudTrail + Config) — every 30 seconds
        _scheduler.add_job(
            sync_alerts,
            trigger="interval",
            seconds=30,
            id="sync_alerts",
            name="Cloud Alert Collection",
            max_instances=1,
            coalesce=True,
        )

        # CloudWatch Logs + VPC Flow Logs — every 2 minutes
        _scheduler.add_job(
            sync_logs,
            trigger="interval",
            minutes=2,
            id="sync_logs",
            name="CloudWatch Logs Collection",
            max_instances=1,
            coalesce=True,
        )

        # X-Ray Traces — every 1 minute
        _scheduler.add_job(
            sync_traces,
            trigger="interval",
            minutes=1,
            id="sync_traces",
            name="X-Ray Traces Collection",
            max_instances=1,
            coalesce=True,
        )

        # CloudTrail Audit Events — every 5 minutes
        _scheduler.add_job(
            sync_audit_events,
            trigger="interval",
            minutes=5,
            id="sync_audit_events",
            name="CloudTrail Audit Events",
            max_instances=1,
            coalesce=True,
        )

        # AWS Config Compliance — every 15 minutes
        _scheduler.add_job(
            sync_config_compliance,
            trigger="interval",
            minutes=15,
            id="sync_config_compliance",
            name="AWS Config Compliance",
            max_instances=1,
            coalesce=True,
        )

        _scheduler.start()
        logger.info(
            "[Scheduler] APScheduler started — "
            "resources:1m, metrics:1m, alerts:30s, logs:2m, traces:1m, audit:5m, config:15m"
        )
    except ImportError:
        logger.warning("[Scheduler] APScheduler not installed — background sync disabled. Run: pip install apscheduler")
    except Exception as exc:
        logger.error(f"[Scheduler] Failed to start: {exc}")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("[Scheduler] APScheduler stopped.")
        _scheduler = None


def trigger_full_sync() -> dict:
    """Trigger an immediate sync of all jobs synchronously."""
    results = {}
    all_jobs = [
        ("resources", sync_resources),
        ("metrics", sync_metrics),
        ("alerts", sync_alerts),
        ("logs", sync_logs),
        ("traces", sync_traces),
        ("audit_events", sync_audit_events),
        ("config_compliance", sync_config_compliance),
    ]
    for name, fn in all_jobs:
        try:
            fn()
            results[name] = "ok"
        except Exception as exc:
            results[name] = f"error: {exc}"
            logger.error(f"[Scheduler] Manual sync failed for {name}: {exc}")
    return results


# ---------------------------------------------------------------------------
# Simulated Data Generators (Demo Mode fallbacks)
# ---------------------------------------------------------------------------

def _generate_mock_aws_resources(connection_id: str, region: str) -> list[dict]:
    import random
    from datetime import datetime, timezone
    res = []
    def r(id_, name, type_, health="healthy", extra=None):
        return {
            "id": f"aws::{connection_id}::{id_}",
            "name": name,
            "resource_type": type_,
            "provider": "aws",
            "region": region,
            "health": health,
            "layer": "infrastructure",
            "metrics": {},
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            **(extra or {}),
        }
    res.append(r("i-03a11bf79b4a1b021", "auth-service-host", "ec2_instance", "healthy", {"instance_type": "t3.medium", "state": "running", "private_ip": "10.0.1.45"}))
    res.append(r("i-0c4a92c4e25a812df", "payment-db-backup", "ec2_instance", "healthy", {"instance_type": "t3.large", "state": "running", "private_ip": "10.0.2.110"}))
    res.append(r("arn:aws:eks:us-east-1:123456789012:cluster/prod-eks", "prod-eks-cluster", "eks_cluster", "healthy", {"k8s_version": "1.28", "status": "ACTIVE"}))
    res.append(r("arn:aws:rds:us-east-1:123456789012:db:postgres-prod", "postgres-prod", "rds_instance", "healthy", {"engine": "postgres", "engine_version": "15.3", "instance_class": "db.m6g.xlarge", "status": "available"}))
    res.append(r("arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/prod-alb/1a2b3c", "prod-alb", "load_balancer", "healthy", {"lb_type": "application", "state": "active"}))
    res.append(r("arn:aws:ecs:us-east-1:123456789012:cluster/checkout-ecs", "checkout-ecs", "ecs_cluster", "healthy", {"status": "ACTIVE", "running_tasks": 4}))
    res.append(r("arn:aws:ecs:us-east-1:123456789012:service/checkout-ecs/payment-service", "payment-service", "ecs_service", "healthy", {"cluster": "checkout-ecs", "running_count": 2, "desired_count": 2}))
    res.append(r("arn:aws:kinesis:us-east-1:123456789012:stream/telemetry-ingest", "telemetry-ingest", "kinesis_stream", "healthy", {"shard_count": 4}))
    res.append(r("arn:aws:eventbridge:us-east-1:123456789012:event-bus/default", "default-bus", "event_bus", "healthy", {}))
    return res

def _generate_mock_azure_resources(connection_id: str, sub_id: str) -> list[dict]:
    from datetime import datetime, timezone
    res = []
    def r(id_, name, type_, health="healthy", extra=None):
        return {
            "id": f"azure::{connection_id}::{id_}",
            "name": name,
            "resource_type": type_,
            "provider": "azure",
            "region": "eastus",
            "health": health,
            "layer": "infrastructure",
            "metrics": {},
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            **(extra or {}),
        }
    res.append(r("virtualMachines/vm-payment-processor", "vm-payment-processor", "azure_vm", "healthy", {"vm_size": "Standard_D2s_v5", "power_state": "running", "os_type": "Linux"}))
    res.append(r("virtualMachines/vm-portal-frontend", "vm-portal-frontend", "azure_vm", "healthy", {"vm_size": "Standard_B2s", "power_state": "running", "os_type": "Linux"}))
    res.append(r("managedClusters/aks-azure-prod", "aks-azure-prod", "aks_cluster", "healthy", {"k8s_version": "1.27.3", "node_count": 3, "power_state": "Running"}))
    res.append(r("servers/sql-srv-prod/databases/db-orders", "sql-srv-prod/db-orders", "azure_sql", "healthy", {"server": "sql-srv-prod", "database": "db-orders", "status": "Online"}))
    return res

def _generate_mock_gcp_resources(connection_id: str, project_id: str) -> list[dict]:
    from datetime import datetime, timezone
    res = []
    def r(id_, name, type_, health="healthy", extra=None):
        return {
            "id": f"gcp::{connection_id}::{id_}",
            "name": name,
            "resource_type": type_,
            "provider": "gcp",
            "region": "us-central1",
            "health": health,
            "layer": "infrastructure",
            "metrics": {},
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            **(extra or {}),
        }
    res.append(r("instances/gce-web-server-1", "gce-web-server-1", "gce_instance", "healthy", {"machine_type": "e2-medium", "status": "RUNNING"}))
    res.append(r("instances/gce-worker-1", "gce-worker-1", "gce_instance", "healthy", {"machine_type": "n2-standard-4", "status": "RUNNING"}))
    res.append(r("projects/prod-gcp/locations/us-central1/clusters/gke-prod", "gke-prod", "gke_cluster", "healthy", {"k8s_version": "1.28.2-gke.1150000", "node_count": 5}))
    res.append(r("instances/sql-instance-prod/databases/db-inventory", "sql-instance-prod/db-inventory", "cloud_sql", "healthy", {"server": "sql-instance-prod", "database": "db-inventory", "status": "RUNNING"}))
    return res

def _generate_mock_kubernetes_resources(connection_id: str) -> list[dict]:
    from datetime import datetime, timezone
    res = []
    def r(id_, name, type_, health="healthy", extra=None):
        return {
            "id": f"kubernetes::{connection_id}::{id_}",
            "name": name,
            "resource_type": type_,
            "provider": "kubernetes",
            "region": "local",
            "health": health,
            "layer": "infrastructure",
            "metrics": {},
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            **(extra or {}),
        }
    res.append(r("namespaces/prod/pods/frontend-6b4f74d-abc12", "frontend-6b4f74d-abc12", "k8s_pod", "healthy", {"namespace": "prod", "node": "node-1"}))
    res.append(r("namespaces/prod/pods/backend-api-98fc1-xyz34", "backend-api-98fc1-xyz34", "k8s_pod", "healthy", {"namespace": "prod", "node": "node-2"}))
    res.append(r("nodes/node-1", "node-1", "k8s_node", "healthy", {}))
    res.append(r("nodes/node-2", "node-2", "k8s_node", "healthy", {}))
    res.append(r("namespaces/prod/deployments/frontend", "frontend", "k8s_deployment", "healthy", {"namespace": "prod"}))
    res.append(r("namespaces/prod/services/backend-api", "backend-api", "k8s_service", "healthy", {"namespace": "prod"}))
    return res

def _generate_mock_metrics(resources: list[dict]) -> list[dict]:
    import random
    from datetime import datetime, timezone
    metrics = []
    for r in resources:
        prov = r.get("provider", "aws")
        res_type = r.get("resource_type", "")
        metrics.append({
            "provider": prov,
            "entity_id": r.get("id"),
            "metric_name": "CPUUtilization" if prov != "azure" else "Percentage CPU",
            "value": round(random.uniform(10.0, 80.0), 1),
            "unit": "Percent",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "resource_type": res_type,
        })
        if "instance" in res_type or "vm" in res_type or "pod" in res_type:
            metrics.append({
                "provider": prov,
                "entity_id": r.get("id"),
                "metric_name": "MemoryUtilization" if prov != "azure" else "Available Memory Bytes",
                "value": round(random.uniform(30.0, 90.0), 1),
                "unit": "Percent",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "resource_type": res_type,
            })
    return metrics

def _generate_mock_alerts(resources: list[dict], provider: str) -> list[dict]:
    import random
    from datetime import datetime, timezone
    alerts = []
    for r in resources:
        if random.random() < 0.3:
            alerts.append({
                "id": f"alert-{random.randint(1000, 9999)}",
                "provider": provider,
                "title": f"High CPU usage on {r.get('name')}",
                "description": f"Threshold exceeded (current: {random.randint(85, 99)}%)",
                "severity": random.choice(["warning", "critical"]),
                "status": "active",
                "entity_id": r.get("id"),
                "triggered_at": datetime.now(timezone.utc).isoformat(),
            })
    return alerts

def _generate_mock_logs(connection_id: str) -> dict:
    from datetime import datetime, timezone
    import random
    events = []
    vpc_events = []
    log_groups = ["/aws/lambda/auth-service", "/aws/rds/instance/postgres-prod", "syslog"]
    for i in range(15):
        events.append({
            "log_group": random.choice(log_groups),
            "log_stream": f"stream-{random.randint(1,5)}",
            "message": random.choice([
                "INFO: Request processed in 45ms",
                "ERROR: Database connection timeout during billing refresh",
                "WARNING: Rate limit approached for IP 192.168.1.1",
                "INFO: User login successful",
            ]),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "cloudwatch_logs",
            "region": "us-east-1",
            "provider": "aws",
        })
        vpc_events.append({
            "log_group": "vpc-flow-logs",
            "log_stream": "eni-12345678",
            "message": f"ACCEPT 10.0.1.{random.randint(2,254)} 10.0.2.110 {random.choice([80, 443, 5432])} TCP",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "vpc_flow_logs",
            "region": "us-east-1",
            "provider": "aws",
        })
    return {
        "log_groups": log_groups,
        "log_events": events,
        "vpc_flow_events": vpc_events,
        "total_events": len(events) + len(vpc_events),
    }

def _generate_mock_azure_logs(connection_id: str) -> dict:
    from datetime import datetime, timezone
    import random
    events = []
    activity = []
    log_groups = ["la-workspace/app-service-logs", "la-workspace/sql-database-audit"]
    for i in range(15):
        events.append({
            "log_group": random.choice(log_groups),
            "log_stream": "default",
            "message": random.choice([
                "INFO: HTTP GET /api/v1/orders returned 200",
                "ERROR: Failed to authenticate service principal",
                "WARNING: High connection count on sql server",
            ]),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "log_analytics",
            "provider": "azure",
        })
        activity.append({
            "log_group": "azure-activity-log",
            "log_stream": "SubscriptionLevel",
            "message": f"Microsoft.Compute/virtualMachines/write started by deployer@azure.com",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "activity_log",
            "provider": "azure",
        })
    return {
        "log_groups": log_groups,
        "log_events": events,
        "activity_events": activity,
    }

def _generate_mock_gcp_logs(connection_id: str) -> dict:
    from datetime import datetime, timezone
    import random
    events = []
    log_groups = ["projects/gcp-prod/logs/cloudaudit.googleapis.com%2Factivity", "projects/gcp-prod/logs/syslog"]
    for i in range(15):
        events.append({
            "log_group": random.choice(log_groups),
            "log_stream": "stdout",
            "message": random.choice([
                "INFO: compute.instances.insert started successfully",
                "WARNING: Disk usage high on gce-web-server-1",
                "ERROR: Failed to fetch secret from Secret Manager",
            ]),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "cloud_logging",
            "provider": "gcp",
        })
    return {
        "log_groups": log_groups,
        "log_events": events,
    }

def _generate_mock_k8s_logs(connection_id: str) -> dict:
    from datetime import datetime, timezone
    import random
    events = []
    log_groups = ["kube-system/kube-apiserver", "prod/frontend", "prod/backend-api"]
    for i in range(15):
        events.append({
            "log_group": random.choice(log_groups),
            "log_stream": "container-stdout",
            "message": random.choice([
                "INFO: Pod frontend-6b4f74d-abc12 starting container",
                "WARNING: Liveness probe failed for pod backend-api-98fc1-xyz34",
                "ERROR: Connection refused connecting to redis service",
            ]),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "container_logs",
            "provider": "kubernetes",
        })
    return {
        "log_groups": log_groups,
        "log_events": events,
    }

def _generate_mock_traces(connection_id: str, provider: str) -> dict:
    from datetime import datetime, timezone
    import random
    traces = []
    services = ["gateway-service", "auth-service", "payment-service", "inventory-service"]
    for i in range(10):
        tid = f"1-{random.getrandbits(32):08x}-{random.getrandbits(96):024x}"
        traces.append({
            "trace_id": tid,
            "duration_ms": random.uniform(50.0, 1500.0),
            "has_error": random.choice([False, False, False, True]),
            "has_fault": random.choice([False, False, False, False, True]),
            "has_throttle": False,
            "root_service": random.choice(services),
            "services": services[:random.randint(2, 4)],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "http_url": f"https://api.ops-platform.io/{random.choice(['checkout', 'auth', 'user'])}",
            "provider": provider,
        })
    return {
        "traces": traces,
        "service_map": [
            {"source": "gateway-service", "target": "auth-service"},
            {"source": "gateway-service", "target": "payment-service"},
            {"source": "payment-service", "target": "inventory-service"},
        ],
    }

def _generate_mock_audit_events(connection_id: str, provider: str) -> list[dict]:
    from datetime import datetime, timezone
    import random
    events = []
    for i in range(10):
        events.append({
            "event_id": f"event-{random.randint(100000, 999999)}",
            "event_name": random.choice(["RunInstances", "StopInstances", "AuthorizeSecurityGroupIngress", "CreateAccessKey"]) if provider == "aws" else random.choice(["WriteVirtualMachine", "DeleteVirtualMachine", "UpdateSecurityRules"]),
            "event_source": "ec2.amazonaws.com" if provider == "aws" else "Microsoft.Compute",
            "username": random.choice(["admin-deployer", "ci-cd-pipeline", "john-sre"]),
            "source_ip": f"192.0.2.{random.randint(1, 254)}",
            "severity": random.choice(["info", "warning", "critical"]),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "provider": provider,
        })
    return events

def _generate_mock_compliance(connection_id: str, provider: str) -> dict:
    from datetime import datetime, timezone
    rules = [
        {"rule_name": f"{provider}-bucket-public-read-prohibited", "description": "Checks if cloud storage buckets allow public read access", "is_compliant": True, "state": "COMPLIANT", "source_identifier": "STORAGE_PUBLIC_READ_PROHIBITED", "provider": provider},
        {"rule_name": f"{provider}-instance-no-public-ip", "description": "Checks if compute instances have public IPs", "is_compliant": False, "state": "NON_COMPLIANT", "source_identifier": "INSTANCE_NO_PUBLIC_IP", "provider": provider},
        {"rule_name": f"{provider}-iam-policy-no-statements-with-admin-access", "description": "Checks if access policies grant admin permissions", "is_compliant": True, "state": "COMPLIANT", "source_identifier": "POLICY_NO_ADMIN_ACCESS", "provider": provider},
    ]
    return {
        "rules": rules,
        "non_compliant_resources": [
            {"rule_name": f"{provider}-instance-no-public-ip", "resource_id": f"i-0c4a92{provider}", "resource_type": "ComputeInstance", "provider": provider},
        ],
        "total_rules": len(rules),
        "non_compliant_rule_count": 1,
    }
