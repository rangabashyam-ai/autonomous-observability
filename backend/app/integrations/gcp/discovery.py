"""
GCP Resource Discovery — Compute Engine, GKE, Cloud SQL.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _make_resource(
    id: str,
    name: str,
    resource_type: str,
    provider: str = "gcp",
    region: str = "us-central1",
    health: str = "healthy",
    extra: dict | None = None,
) -> dict:
    return {
        "id": id,
        "name": name,
        "resource_type": resource_type,
        "provider": provider,
        "region": region,
        "health": health,
        "layer": "infrastructure",
        "metrics": {},
        "discovered_at": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }


def discover_compute(credentials, project_id: str) -> list[dict]:
    """Discover Compute Engine instances across all zones."""
    try:
        from google.cloud import compute_v1
        client = compute_v1.InstancesClient(credentials=credentials)
        resources = []
        request = compute_v1.AggregatedListInstancesRequest(project=project_id)
        for zone, response in client.aggregated_list(request=request):
            for inst in response.instances or []:
                status = inst.status or "UNKNOWN"
                health = "healthy" if status == "RUNNING" else "critical" if status in ("TERMINATED", "SUSPENDED") else "warning"
                region = zone.replace("zones/", "").rsplit("-", 1)[0] if "zones/" in zone else zone
                resources.append(_make_resource(
                    id=str(inst.self_link or inst.name),
                    name=inst.name,
                    resource_type="gce_instance",
                    region=region,
                    health=health,
                    extra={
                        "zone": zone,
                        "machine_type": inst.machine_type.split("/")[-1] if inst.machine_type else "",
                        "status": status,
                        "network_ip": inst.network_interfaces[0].network_i_p if inst.network_interfaces else "",
                    },
                ))
        logger.info(f"[GCP] Discovered {len(resources)} Compute Engine instances")
        return resources
    except Exception as exc:
        logger.error(f"[GCP] Compute discovery failed: {exc}")
        return []


def discover_gke(credentials, project_id: str) -> list[dict]:
    """Discover GKE clusters."""
    try:
        from google.cloud import container_v1
        client = container_v1.ClusterManagerClient(credentials=credentials)
        response = client.list_clusters(parent=f"projects/{project_id}/locations/-")
        resources = []
        for cluster in response.clusters:
            status_code = cluster.status
            # container_v1.Cluster.Status: 2=RUNNING, 4=ERROR, etc.
            health = "healthy" if status_code == 2 else "critical" if status_code in (4, 5, 6) else "warning"
            region = cluster.location or "us-central1"
            resources.append(_make_resource(
                id=cluster.self_link or cluster.name,
                name=cluster.name,
                resource_type="gke_cluster",
                region=region,
                health=health,
                extra={
                    "k8s_version": cluster.current_master_version or "",
                    "node_count": cluster.current_node_count or 0,
                    "endpoint": cluster.endpoint or "",
                    "location": cluster.location or "",
                },
            ))
        logger.info(f"[GCP] Discovered {len(resources)} GKE clusters")
        return resources
    except Exception as exc:
        logger.error(f"[GCP] GKE discovery failed: {exc}")
        return []


def discover_cloudsql(credentials, project_id: str) -> list[dict]:
    """Discover Cloud SQL instances via the sqladmin REST API."""
    try:
        import google.auth.transport.requests
        import urllib.request
        import json

        request = google.auth.transport.requests.Request()
        credentials.refresh(request)
        access_token = credentials.token

        url = f"https://sqladmin.googleapis.com/sql/v1beta4/projects/{project_id}/instances"
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resources = []
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            for inst in data.get("items", []):
                state = inst.get("state", "UNKNOWN")
                health = "healthy" if state == "RUNNABLE" else "critical" if state in ("FAILED", "SUSPENDED") else "warning"
                region = inst.get("region", "us-central1")
                resources.append(_make_resource(
                    id=inst.get("selfLink", inst.get("name", "unknown")),
                    name=inst.get("name", "unknown"),
                    resource_type="cloud_sql",
                    region=region,
                    health=health,
                    extra={
                        "database_version": inst.get("databaseVersion", ""),
                        "tier": inst.get("settings", {}).get("tier", ""),
                        "state": state,
                        "ip_addresses": [ip.get("ipAddress") for ip in inst.get("ipAddresses", [])],
                    },
                ))
        logger.info(f"[GCP] Discovered {len(resources)} Cloud SQL instances")
        return resources
    except Exception as exc:
        logger.error(f"[GCP] Cloud SQL discovery failed: {exc}")
        return []


def discover_all(credentials, project_id: str) -> list[dict]:
    """Run all GCP discovery and return combined resource list."""
    resources: list[dict] = []
    resources.extend(discover_compute(credentials, project_id))
    resources.extend(discover_gke(credentials, project_id))
    resources.extend(discover_cloudsql(credentials, project_id))
    return resources
