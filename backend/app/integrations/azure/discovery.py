"""
Azure Resource Discovery — VMs, AKS, Azure SQL.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _make_resource(
    id: str,
    name: str,
    resource_type: str,
    provider: str = "azure",
    region: str = "eastus",
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


def discover_vms(credential, subscription_id: str) -> list[dict]:
    """Discover Azure Virtual Machines."""
    try:
        from azure.mgmt.compute import ComputeManagementClient
        client = ComputeManagementClient(credential, subscription_id)
        resources = []
        for vm in client.virtual_machines.list_all():
            location = vm.location or "unknown"
            power_state = "unknown"
            try:
                # Get instance view for power state (may require extra API call)
                rg = vm.id.split("/resourceGroups/")[1].split("/")[0] if vm.id else ""
                iv = client.virtual_machines.get(rg, vm.name, expand="instanceView")
                statuses = iv.instance_view.statuses if iv.instance_view else []
                for s in statuses:
                    if s.code and s.code.startswith("PowerState/"):
                        power_state = s.code.replace("PowerState/", "")
                        break
            except Exception:
                pass
            health = "healthy" if power_state == "running" else "critical" if power_state in ("stopped", "deallocated") else "warning"
            resources.append(_make_resource(
                id=vm.id or vm.name,
                name=vm.name,
                resource_type="azure_vm",
                region=location,
                health=health,
                extra={
                    "vm_size": vm.hardware_profile.vm_size if vm.hardware_profile else "",
                    "power_state": power_state,
                    "os_type": str(vm.storage_profile.os_disk.os_type) if vm.storage_profile and vm.storage_profile.os_disk else "",
                },
            ))
        logger.info(f"[Azure] Discovered {len(resources)} VMs")
        return resources
    except Exception as exc:
        logger.error(f"[Azure] VM discovery failed: {exc}")
        return []


def discover_aks(credential, subscription_id: str) -> list[dict]:
    """Discover Azure Kubernetes Service clusters."""
    try:
        from azure.mgmt.containerservice import ContainerServiceClient
        client = ContainerServiceClient(credential, subscription_id)
        resources = []
        for cluster in client.managed_clusters.list():
            power_state = cluster.power_state.code if cluster.power_state else "Unknown"
            health = "healthy" if power_state == "Running" else "critical" if power_state == "Stopped" else "warning"
            resources.append(_make_resource(
                id=cluster.id or cluster.name,
                name=cluster.name,
                resource_type="aks_cluster",
                region=cluster.location or "unknown",
                health=health,
                extra={
                    "k8s_version": cluster.kubernetes_version or "",
                    "node_count": sum(
                        p.count or 0 for p in (cluster.agent_pool_profiles or [])
                    ),
                    "power_state": power_state,
                    "fqdn": cluster.fqdn or "",
                },
            ))
        logger.info(f"[Azure] Discovered {len(resources)} AKS clusters")
        return resources
    except Exception as exc:
        logger.error(f"[Azure] AKS discovery failed: {exc}")
        return []


def discover_sql(credential, subscription_id: str) -> list[dict]:
    """Discover Azure SQL databases."""
    try:
        from azure.mgmt.sql import SqlManagementClient
        client = SqlManagementClient(credential, subscription_id)
        resources = []
        for server in client.servers.list():
            rg = server.id.split("/resourceGroups/")[1].split("/")[0] if server.id else ""
            try:
                for db in client.databases.list_by_server(rg, server.name):
                    if db.name == "master":
                        continue
                    status = db.status or "Unknown"
                    health = "healthy" if status == "Online" else "critical" if status in ("Offline", "Disabled") else "warning"
                    resources.append(_make_resource(
                        id=db.id or db.name,
                        name=f"{server.name}/{db.name}",
                        resource_type="azure_sql",
                        region=db.location or server.location or "unknown",
                        health=health,
                        extra={
                            "server": server.name,
                            "database": db.name,
                            "status": status,
                            "sku": db.sku.name if db.sku else "",
                        },
                    ))
            except Exception as exc:
                logger.warning(f"[Azure] SQL DB list failed for server '{server.name}': {exc}")
        logger.info(f"[Azure] Discovered {len(resources)} Azure SQL databases")
        return resources
    except Exception as exc:
        logger.error(f"[Azure] SQL discovery failed: {exc}")
        return []


def discover_all(credential, subscription_id: str) -> list[dict]:
    """Run all Azure discovery and return combined resource list."""
    resources: list[dict] = []
    resources.extend(discover_vms(credential, subscription_id))
    resources.extend(discover_aks(credential, subscription_id))
    resources.extend(discover_sql(credential, subscription_id))
    return resources
