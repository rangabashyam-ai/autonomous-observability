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
        try:
            if provider == "aws":
                from app.integrations.aws.auth import get_session
                from app.integrations.aws.discovery import discover_all
                session = get_session(conn_id, conn)
                resources = discover_all(session, conn.get("region", "us-east-1"))
                all_resources.extend(resources)

            elif provider == "azure":
                from app.integrations.azure.auth import get_credential
                from app.integrations.azure.discovery import discover_all
                credential, sub_id = get_credential(conn_id, conn)
                resources = discover_all(credential, sub_id)
                all_resources.extend(resources)

            elif provider == "gcp":
                from app.integrations.gcp.auth import get_credentials
                from app.integrations.gcp.discovery import discover_all
                credentials, project_id = get_credentials(conn_id, conn)
                resources = discover_all(credentials, project_id)
                all_resources.extend(resources)

            elif provider == "kubernetes":
                from app.integrations.kubernetes.auth import get_client
                from app.integrations.kubernetes.discovery import discover_all
                api_client = get_client(conn_id, conn)
                resources = discover_all(api_client)
                all_resources.extend(resources)

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
                    logger.error(f"[Scheduler] AWS topology failed for {conn.get('connection_id')}: {exc}")

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
        try:
            if provider == "aws":
                from app.integrations.aws.auth import get_session
                from app.integrations.aws.metrics import collect_metrics_for_resources
                session = get_session(conn_id, conn)
                metrics = collect_metrics_for_resources(session, provider_resources, conn.get("region", "us-east-1"))
                all_metrics.extend([m.to_monitoring_dict() for m in metrics])

            elif provider == "azure":
                from app.integrations.azure.auth import get_credential
                from app.integrations.azure.metrics import collect_metrics_for_resources
                credential, _ = get_credential(conn_id, conn)
                metrics = collect_metrics_for_resources(credential, provider_resources)
                all_metrics.extend([m.to_monitoring_dict() for m in metrics])

            elif provider == "gcp":
                from app.integrations.gcp.auth import get_credentials
                from app.integrations.gcp.metrics import collect_metrics_for_resources
                credentials, project_id = get_credentials(conn_id, conn)
                metrics = collect_metrics_for_resources(credentials, provider_resources, project_id)
                all_metrics.extend([m.to_monitoring_dict() for m in metrics])

            elif provider == "kubernetes":
                from app.integrations.kubernetes.auth import get_client
                from app.integrations.kubernetes.metrics import collect_metrics_for_resources
                api_client = get_client(conn_id, conn)
                metrics = collect_metrics_for_resources(api_client, provider_resources)
                all_metrics.extend([m.to_monitoring_dict() for m in metrics])

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
        try:
            if provider == "aws":
                from app.integrations.aws.auth import get_session
                from app.integrations.aws.alerts import collect_alerts
                from app.integrations.aws.cloudtrail import collect_alerts_from_trail
                from app.integrations.aws.aws_config import collect_compliance_alerts
                session = get_session(conn_id, conn)
                region = conn.get("region", "us-east-1")

                # CloudWatch alarms
                cw_alerts = collect_alerts(session, region)
                all_alerts.extend([a.to_monitoring_dict() for a in cw_alerts])

                # CloudTrail high-impact events → alerts
                try:
                    trail_alerts = collect_alerts_from_trail(session, region)
                    all_alerts.extend([a.to_monitoring_dict() for a in trail_alerts])
                except Exception as exc:
                    logger.warning(f"[Scheduler] CloudTrail alerts failed: {exc}")

                # AWS Config non-compliant resources → alerts
                try:
                    config_alerts = collect_compliance_alerts(session, region)
                    all_alerts.extend([a.to_monitoring_dict() for a in config_alerts])
                except Exception as exc:
                    logger.warning(f"[Scheduler] Config alerts failed: {exc}")

            elif provider == "azure":
                from app.integrations.azure.auth import get_credential
                from app.integrations.azure.alerts import collect_alerts
                credential, sub_id = get_credential(conn_id, conn)
                # Azure Monitor fired alerts
                azure_alerts = collect_alerts(credential, sub_id)
                all_alerts.extend([a.to_monitoring_dict() for a in azure_alerts])
                # Azure Activity Log high-severity events → alerts
                try:
                    from app.integrations.azure.logs import collect_alerts_from_activity_log
                    activity_alerts = collect_alerts_from_activity_log(credential, sub_id)
                    all_alerts.extend([a.to_monitoring_dict() for a in activity_alerts])
                except Exception as exc:
                    logger.warning(f"[Scheduler] Azure Activity Log alerts failed: {exc}")

            elif provider == "gcp":
                from app.integrations.gcp.auth import get_credentials
                from app.integrations.gcp.alerts import collect_alerts
                credentials, project_id = get_credentials(conn_id, conn)
                alerts = collect_alerts(credentials, project_id)
                all_alerts.extend([a.to_monitoring_dict() for a in alerts])

            elif provider == "kubernetes":
                # K8s uses events as alerts
                from app.integrations.kubernetes.auth import get_client
                from app.integrations.normalization.alerts import normalize_k8s_event
                api_client = get_client(conn_id, conn)
                try:
                    from kubernetes.client import CoreV1Api
                    v1 = CoreV1Api(api_client)
                    events = v1.list_event_for_all_namespaces(field_selector="type=Warning", limit=100)
                    k8s_alerts = [normalize_k8s_event(e.to_dict()) for e in events.items]
                    all_alerts.extend([a.to_monitoring_dict() for a in k8s_alerts])
                except Exception as exc:
                    logger.warning(f"[Scheduler] K8s event collection failed: {exc}")

        except Exception as exc:
            logger.error(f"[Scheduler] Alert collection failed for {provider}/{conn_id}: {exc}")

    if all_alerts:
        alerts_path = _DATA_DIR / "monitoring" / "alerts.json"
        existing = _read_json(alerts_path)
        merged = _merge_alerts(existing.get("alerts", []), all_alerts)
        _write_json(alerts_path, {"alerts": merged, "updated_at": datetime.now(timezone.utc).isoformat()})
        logger.info(f"[Scheduler] Alert sync complete — {len(all_alerts)} new cloud alerts.")


def sync_logs() -> None:
    """Collect CloudWatch Logs (AWS) and Log Analytics + Activity Log (Azure) from all connections."""
    logger.info("[Scheduler] Starting logs sync (AWS + Azure)...")
    connections = _get_all_connections()

    for conn in connections:
        provider = conn.get("provider")
        conn_id = conn.get("connection_id", "")

        # ── AWS: CloudWatch Logs + VPC Flow Logs ─────────────────────────────
        if provider == "aws":
            region = conn.get("region", "us-east-1")
            try:
                from app.integrations.aws.auth import get_session
                from app.integrations.aws.logs import collect_all_logs
                session = get_session(conn_id, conn)
                logs_data = collect_all_logs(session, region)

                logs_path = _DATA_DIR / "integrations" / "logs.json"
                existing = _read_json(logs_path)
                existing_events = existing.get("log_events", [])
                existing_vpc = existing.get("vpc_flow_events", [])

                merged_events = (existing_events + logs_data.get("log_events", []))[-5000:]
                merged_vpc = (existing_vpc + logs_data.get("vpc_flow_events", []))[-2000:]

                _write_json(logs_path, {
                    "log_groups": logs_data.get("log_groups", []),
                    "log_events": merged_events,
                    "vpc_flow_events": merged_vpc,
                    "total_events": len(merged_events) + len(merged_vpc),
                    "region": region,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                logger.info(f"[Scheduler] AWS Logs sync complete — {logs_data.get('total_events', 0)} new events.")
            except Exception as exc:
                logger.error(f"[Scheduler] AWS Logs sync failed for {conn_id}: {exc}")

        # ── Azure: Log Analytics + Activity Log ───────────────────────────────
        elif provider == "azure":
            subscription_id = conn.get("subscription_id", "")
            try:
                from app.integrations.azure.auth import get_credential
                from app.integrations.azure.logs import collect_all_logs as azure_collect_all_logs
                credential, sub_id = get_credential(conn_id, conn)
                sub_id = subscription_id or sub_id
                logs_data = azure_collect_all_logs(credential, sub_id)

                # Merge into shared logs.json under azure_log_events key
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

                logger.info(
                    f"[Scheduler] Azure Logs sync complete — "
                    f"{len(logs_data.get('log_events', []))} LA events, "
                    f"{len(logs_data.get('activity_events', []))} activity events."
                )
            except Exception as exc:
                logger.error(f"[Scheduler] Azure Logs sync failed for {conn_id}: {exc}")


def sync_traces() -> None:
    """Collect X-Ray distributed traces from all AWS connections."""
    logger.info("[Scheduler] Starting X-Ray traces sync...")
    connections = _get_all_connections()

    for conn in connections:
        if conn.get("provider") != "aws":
            continue
        conn_id = conn.get("connection_id", "")
        region = conn.get("region", "us-east-1")
        try:
            from app.integrations.aws.auth import get_session
            from app.integrations.aws.xray import collect_all
            session = get_session(conn_id, conn)
            xray_data = collect_all(session, region)

            traces_path = _DATA_DIR / "integrations" / "traces.json"
            existing = _read_json(traces_path)
            existing_traces = existing.get("traces", [])
            new_traces = xray_data.get("traces", [])

            # Deduplicate by trace_id, keep last 2000
            by_id = {t["trace_id"]: t for t in existing_traces}
            for t in new_traces:
                by_id[t["trace_id"]] = t
            merged = list(by_id.values())[-2000:]

            _write_json(traces_path, {
                "traces": merged,
                "service_map": xray_data.get("service_map", []),
                "total": len(merged),
                "region": region,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            logger.info(f"[Scheduler] X-Ray sync complete — {len(new_traces)} new traces.")
        except Exception as exc:
            logger.error(f"[Scheduler] X-Ray sync failed for {conn_id}: {exc}")


def sync_audit_events() -> None:
    """Collect CloudTrail audit events from all AWS connections."""
    logger.info("[Scheduler] Starting CloudTrail audit sync...")
    connections = _get_all_connections()

    for conn in connections:
        if conn.get("provider") != "aws":
            continue
        conn_id = conn.get("connection_id", "")
        region = conn.get("region", "us-east-1")
        try:
            from app.integrations.aws.auth import get_session
            from app.integrations.aws.cloudtrail import collect_audit_events
            session = get_session(conn_id, conn)
            events = collect_audit_events(session, region)

            audit_path = _DATA_DIR / "integrations" / "audit_events.json"
            existing = _read_json(audit_path)
            merged = _merge_by_id(existing.get("events", []), events, id_field="event_id")

            _write_json(audit_path, {
                "events": merged,
                "total": len(merged),
                "region": region,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            logger.info(f"[Scheduler] CloudTrail audit sync complete — {len(events)} new events.")
        except Exception as exc:
            logger.error(f"[Scheduler] CloudTrail audit sync failed for {conn_id}: {exc}")


def sync_config_compliance() -> None:
    """Collect AWS Config compliance data from all AWS connections."""
    logger.info("[Scheduler] Starting AWS Config compliance sync...")
    connections = _get_all_connections()

    for conn in connections:
        if conn.get("provider") != "aws":
            continue
        conn_id = conn.get("connection_id", "")
        region = conn.get("region", "us-east-1")
        try:
            from app.integrations.aws.auth import get_session
            from app.integrations.aws.aws_config import collect_all_compliance
            session = get_session(conn_id, conn)
            compliance_data = collect_all_compliance(session, region)

            _write_json(_DATA_DIR / "integrations" / "config_compliance.json", {
                **compliance_data,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            logger.info(f"[Scheduler] Config compliance sync complete — {compliance_data.get('total_rules', 0)} rules checked.")
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
