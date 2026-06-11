"""
Kubernetes Resource Discovery — Namespaces, Nodes, Pods, Services, Deployments, Ingress.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _make_resource(
    id: str,
    name: str,
    resource_type: str,
    namespace: str = "default",
    health: str = "healthy",
    extra: dict | None = None,
) -> dict:
    return {
        "id": id,
        "name": name,
        "resource_type": resource_type,
        "provider": "kubernetes",
        "region": namespace,
        "namespace": namespace,
        "health": health,
        "layer": "infrastructure",
        "metrics": {},
        "discovered_at": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }


def _pod_health(phase: str, conditions: list) -> str:
    if phase == "Running":
        ready = next((c for c in conditions if c.type == "Ready"), None)
        if ready and ready.status == "True":
            return "healthy"
        return "warning"
    elif phase in ("Failed", "Unknown"):
        return "critical"
    elif phase == "Pending":
        return "warning"
    return "healthy"


def discover_namespaces(api_client) -> list[dict]:
    try:
        from kubernetes.client import CoreV1Api
        v1 = CoreV1Api(api_client)
        ns_list = v1.list_namespace()
        resources = []
        for ns in ns_list.items:
            phase = ns.status.phase if ns.status else "Unknown"
            health = "healthy" if phase == "Active" else "warning"
            uid = ns.metadata.uid or ns.metadata.name
            resources.append(_make_resource(
                id=f"ns-{uid}",
                name=ns.metadata.name,
                resource_type="k8s_namespace",
                namespace=ns.metadata.name,
                health=health,
                extra={"phase": phase},
            ))
        logger.info(f"[K8s] Discovered {len(resources)} namespaces")
        return resources
    except Exception as exc:
        logger.error(f"[K8s] Namespace discovery failed: {exc}")
        return []


def discover_nodes(api_client) -> list[dict]:
    try:
        from kubernetes.client import CoreV1Api
        v1 = CoreV1Api(api_client)
        node_list = v1.list_node()
        resources = []
        for node in node_list.items:
            conditions = node.status.conditions if node.status else []
            ready = next((c for c in conditions if c.type == "Ready"), None)
            health = "healthy" if ready and ready.status == "True" else "critical"
            uid = node.metadata.uid or node.metadata.name
            info = node.status.node_info if node.status else None
            resources.append(_make_resource(
                id=f"node-{uid}",
                name=node.metadata.name,
                resource_type="k8s_node",
                namespace="cluster",
                health=health,
                extra={
                    "os_image": info.os_image if info else "",
                    "kernel_version": info.kernel_version if info else "",
                    "kubelet_version": info.kubelet_version if info else "",
                    "container_runtime": info.container_runtime_version if info else "",
                },
            ))
        logger.info(f"[K8s] Discovered {len(resources)} nodes")
        return resources
    except Exception as exc:
        logger.error(f"[K8s] Node discovery failed: {exc}")
        return []


def discover_pods(api_client) -> list[dict]:
    try:
        from kubernetes.client import CoreV1Api
        v1 = CoreV1Api(api_client)
        pod_list = v1.list_pod_for_all_namespaces()
        resources = []
        for pod in pod_list.items:
            ns = pod.metadata.namespace or "default"
            phase = pod.status.phase if pod.status else "Unknown"
            conditions = pod.status.conditions if pod.status and pod.status.conditions else []
            health = _pod_health(phase, conditions)
            uid = pod.metadata.uid or pod.metadata.name
            resources.append(_make_resource(
                id=f"pod-{uid}",
                name=pod.metadata.name,
                resource_type="k8s_pod",
                namespace=ns,
                health=health,
                extra={
                    "phase": phase,
                    "node_name": pod.spec.node_name if pod.spec else "",
                    "containers": [c.name for c in (pod.spec.containers or [])] if pod.spec else [],
                },
            ))
        logger.info(f"[K8s] Discovered {len(resources)} pods")
        return resources
    except Exception as exc:
        logger.error(f"[K8s] Pod discovery failed: {exc}")
        return []


def discover_services(api_client) -> list[dict]:
    try:
        from kubernetes.client import CoreV1Api
        v1 = CoreV1Api(api_client)
        svc_list = v1.list_service_for_all_namespaces()
        resources = []
        for svc in svc_list.items:
            ns = svc.metadata.namespace or "default"
            uid = svc.metadata.uid or svc.metadata.name
            resources.append(_make_resource(
                id=f"svc-{uid}",
                name=svc.metadata.name,
                resource_type="k8s_service",
                namespace=ns,
                health="healthy",
                extra={
                    "type": svc.spec.type if svc.spec else "ClusterIP",
                    "cluster_ip": svc.spec.cluster_ip if svc.spec else "",
                    "ports": [
                        {"port": p.port, "target_port": str(p.target_port), "protocol": p.protocol}
                        for p in (svc.spec.ports or [])
                    ] if svc.spec else [],
                },
            ))
        logger.info(f"[K8s] Discovered {len(resources)} services")
        return resources
    except Exception as exc:
        logger.error(f"[K8s] Service discovery failed: {exc}")
        return []


def discover_deployments(api_client) -> list[dict]:
    try:
        from kubernetes.client import AppsV1Api
        apps = AppsV1Api(api_client)
        dep_list = apps.list_deployment_for_all_namespaces()
        resources = []
        for dep in dep_list.items:
            ns = dep.metadata.namespace or "default"
            uid = dep.metadata.uid or dep.metadata.name
            desired = dep.spec.replicas if dep.spec else 0
            ready = dep.status.ready_replicas if dep.status and dep.status.ready_replicas else 0
            health = "healthy" if ready == desired and desired > 0 else "critical" if ready == 0 else "warning"
            resources.append(_make_resource(
                id=f"dep-{uid}",
                name=dep.metadata.name,
                resource_type="k8s_deployment",
                namespace=ns,
                health=health,
                extra={
                    "replicas_desired": desired,
                    "replicas_ready": ready,
                    "replicas_available": dep.status.available_replicas if dep.status else 0,
                },
            ))
        logger.info(f"[K8s] Discovered {len(resources)} deployments")
        return resources
    except Exception as exc:
        logger.error(f"[K8s] Deployment discovery failed: {exc}")
        return []


def discover_ingress(api_client) -> list[dict]:
    try:
        from kubernetes.client import NetworkingV1Api
        networking = NetworkingV1Api(api_client)
        ingress_list = networking.list_ingress_for_all_namespaces()
        resources = []
        for ing in ingress_list.items:
            ns = ing.metadata.namespace or "default"
            uid = ing.metadata.uid or ing.metadata.name
            lb_ips = []
            if ing.status and ing.status.load_balancer and ing.status.load_balancer.ingress:
                lb_ips = [i.ip or i.hostname for i in ing.status.load_balancer.ingress if i.ip or i.hostname]
            resources.append(_make_resource(
                id=f"ing-{uid}",
                name=ing.metadata.name,
                resource_type="k8s_ingress",
                namespace=ns,
                health="healthy",
                extra={
                    "load_balancer_ips": lb_ips,
                    "rules_count": len(ing.spec.rules) if ing.spec and ing.spec.rules else 0,
                },
            ))
        logger.info(f"[K8s] Discovered {len(resources)} ingress resources")
        return resources
    except Exception as exc:
        logger.error(f"[K8s] Ingress discovery failed: {exc}")
        return []


def discover_all(api_client) -> list[dict]:
    """Run all Kubernetes discovery and return combined resource list."""
    resources: list[dict] = []
    resources.extend(discover_namespaces(api_client))
    resources.extend(discover_nodes(api_client))
    resources.extend(discover_pods(api_client))
    resources.extend(discover_services(api_client))
    resources.extend(discover_deployments(api_client))
    resources.extend(discover_ingress(api_client))
    return resources
