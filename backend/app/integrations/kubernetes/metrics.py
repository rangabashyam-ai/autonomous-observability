"""
Kubernetes Metrics Collection — Metrics Server API.
"""

from __future__ import annotations

import logging

from app.integrations.normalization.metrics import NormalizedMetric, normalize_k8s_metrics

logger = logging.getLogger(__name__)


def _parse_cpu_millicores(cpu_str: str) -> float:
    """Parse Kubernetes CPU quantity to millicores."""
    if not cpu_str:
        return 0.0
    if cpu_str.endswith("m"):
        return float(cpu_str[:-1])
    try:
        return float(cpu_str) * 1000  # cores → millicores
    except ValueError:
        return 0.0


def _parse_memory_bytes(mem_str: str) -> float:
    """Parse Kubernetes memory quantity to bytes."""
    if not mem_str:
        return 0.0
    suffixes = {"Ki": 1024, "Mi": 1024**2, "Gi": 1024**3, "Ti": 1024**4,
                "K": 1000, "M": 1000**2, "G": 1000**3}
    for suffix, multiplier in suffixes.items():
        if mem_str.endswith(suffix):
            try:
                return float(mem_str[:-len(suffix)]) * multiplier
            except ValueError:
                return 0.0
    try:
        return float(mem_str)
    except ValueError:
        return 0.0


def collect_pod_metrics(api_client) -> list[NormalizedMetric]:
    """
    Query the Kubernetes Metrics Server API for pod CPU and memory usage.
    Returns empty list if Metrics Server is not installed.
    """
    metrics: list[NormalizedMetric] = []
    try:
        from kubernetes.client import CustomObjectsApi
        custom = CustomObjectsApi(api_client)
        pod_metrics = custom.list_cluster_custom_object(
            group="metrics.k8s.io",
            version="v1beta1",
            plural="pods",
        )
        for item in pod_metrics.get("items", []):
            metadata = item.get("metadata", {})
            pod_name = metadata.get("name", "unknown")
            namespace = metadata.get("namespace", "default")

            total_cpu_m = 0.0
            total_mem_bytes = 0.0
            for container in item.get("containers", []):
                usage = container.get("usage", {})
                total_cpu_m += _parse_cpu_millicores(usage.get("cpu", "0m"))
                total_mem_bytes += _parse_memory_bytes(usage.get("memory", "0"))

            metrics.append(normalize_k8s_metrics(
                pod_name=pod_name,
                namespace=namespace,
                cpu_usage_m=total_cpu_m,
                memory_usage_bytes=total_mem_bytes,
            ))

        logger.info(f"[K8s] Collected metrics for {len(metrics)} pods")
    except Exception as exc:
        logger.warning(f"[K8s] Pod metrics collection failed (Metrics Server may not be installed): {exc}")
    return metrics


def collect_node_metrics(api_client) -> list[NormalizedMetric]:
    """Query node-level metrics from the Metrics Server."""
    metrics: list[NormalizedMetric] = []
    try:
        from kubernetes.client import CustomObjectsApi
        custom = CustomObjectsApi(api_client)
        node_metrics = custom.list_cluster_custom_object(
            group="metrics.k8s.io",
            version="v1beta1",
            plural="nodes",
        )
        for item in node_metrics.get("items", []):
            node_name = item.get("metadata", {}).get("name", "unknown")
            usage = item.get("usage", {})
            cpu_m = _parse_cpu_millicores(usage.get("cpu", "0m"))
            mem_bytes = _parse_memory_bytes(usage.get("memory", "0"))
            metrics.append(normalize_k8s_metrics(
                pod_name=node_name,
                namespace="cluster",
                cpu_usage_m=cpu_m,
                memory_usage_bytes=mem_bytes,
                cpu_limit_m=32000,          # 32-core default estimate
                memory_limit_bytes=137438953472,  # 128 GB default estimate
            ))

        logger.info(f"[K8s] Collected metrics for {len(metrics)} nodes")
    except Exception as exc:
        logger.warning(f"[K8s] Node metrics collection failed: {exc}")
    return metrics


def collect_metrics_for_resources(api_client, resources: list[dict]) -> list[NormalizedMetric]:
    """Collect metrics for discovered Kubernetes resources."""
    metrics: list[NormalizedMetric] = []
    metrics.extend(collect_pod_metrics(api_client))
    metrics.extend(collect_node_metrics(api_client))
    return metrics
