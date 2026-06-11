"""
Background Scheduler — periodic cloud telemetry sync.

Schedule:
  - Resource Discovery  : every 30 minutes
  - Metrics Collection  : every 1 minute
  - Alert Collection    : every 30 seconds

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

_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "data"


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


def _merge_alerts(existing_alerts: list[dict], new_alerts: list[dict]) -> list[dict]:
    """Merge new cloud alerts with existing list, deduplicating by id."""
    existing_ids = {a.get("id") for a in existing_alerts}
    merged = list(existing_alerts)
    for alert in new_alerts:
        if alert.get("id") not in existing_ids:
            merged.append(alert)
            existing_ids.add(alert.get("id"))
    return merged


def _merge_metrics(existing_metrics: list[dict], new_metrics: list[dict]) -> list[dict]:
    """Upsert metrics by entity_id — replace existing entry if found."""
    by_entity = {m.get("entity_id"): m for m in existing_metrics}
    for m in new_metrics:
        by_entity[m.get("entity_id")] = m
    return list(by_entity.values())


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

    # Build and persist topology
    if all_resources:
        from app.integrations.normalization.topology import build_topology_from_resources
        from app.integrations.graph_builder import update_knowledge_graph, update_dependency_graph
        topology_edges = build_topology_from_resources(all_resources)
        update_dependency_graph(topology_edges)
        update_knowledge_graph(all_resources, topology_edges, [])

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
    """Collect alerts from all configured connections."""
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
                session = get_session(conn_id, conn)
                alerts = collect_alerts(session, conn.get("region", "us-east-1"))
                all_alerts.extend([a.to_monitoring_dict() for a in alerts])

            elif provider == "azure":
                from app.integrations.azure.auth import get_credential
                from app.integrations.azure.alerts import collect_alerts
                credential, sub_id = get_credential(conn_id, conn)
                alerts = collect_alerts(credential, sub_id)
                all_alerts.extend([a.to_monitoring_dict() for a in alerts])

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


# ---------------------------------------------------------------------------
# Scheduler lifecycle
# ---------------------------------------------------------------------------

_scheduler = None


def start_scheduler() -> None:
    global _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler

        _scheduler = BackgroundScheduler(timezone="UTC")

        # Resource discovery — every 30 minutes
        _scheduler.add_job(
            sync_resources,
            trigger="interval",
            minutes=30,
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

        # Alerts — every 30 seconds
        _scheduler.add_job(
            sync_alerts,
            trigger="interval",
            seconds=30,
            id="sync_alerts",
            name="Cloud Alert Collection",
            max_instances=1,
            coalesce=True,
        )

        _scheduler.start()
        logger.info("[Scheduler] APScheduler started — resource:30m, metrics:1m, alerts:30s")
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
    """Trigger an immediate sync of all three jobs synchronously."""
    results = {}
    for name, fn in [("resources", sync_resources), ("metrics", sync_metrics), ("alerts", sync_alerts)]:
        try:
            fn()
            results[name] = "ok"
        except Exception as exc:
            results[name] = f"error: {exc}"
            logger.error(f"[Scheduler] Manual sync failed for {name}: {exc}")
    return results
