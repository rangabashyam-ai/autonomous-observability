"""
AWS Container Insights — ECS and EKS metrics from CloudWatch ContainerInsights namespace.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.integrations.normalization.metrics import NormalizedMetric

logger = logging.getLogger(__name__)

_LOOKBACK_MINUTES = 5
_PERIOD = 300


def _cw_average(cw, namespace: str, metric_name: str, dimensions: list[dict]) -> float:
    try:
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=_LOOKBACK_MINUTES)
        resp = cw.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            Dimensions=dimensions,
            StartTime=start,
            EndTime=end,
            Period=_PERIOD,
            Statistics=["Average"],
        )
        datapoints = resp.get("Datapoints", [])
        if not datapoints:
            return 0.0
        return float(sorted(datapoints, key=lambda x: x["Timestamp"])[-1].get("Average", 0))
    except Exception as exc:
        logger.debug(f"[ContainerInsights] {metric_name} failed: {exc}")
        return 0.0


def collect_ecs_service_metrics(session, cluster_name: str, service_name: str, region: str = "us-east-1") -> NormalizedMetric:
    """Collect CPU and memory for an ECS Service from Container Insights."""
    cw = session.client("cloudwatch", region_name=region)
    namespace = "ECS/ContainerInsights"
    dims = [
        {"Name": "ClusterName", "Value": cluster_name},
        {"Name": "ServiceName", "Value": service_name},
    ]
    cpu = _cw_average(cw, namespace, "CpuUtilized", dims)
    cpu_reserved = _cw_average(cw, namespace, "CpuReserved", dims)
    mem = _cw_average(cw, namespace, "MemoryUtilized", dims)
    mem_reserved = _cw_average(cw, namespace, "MemoryReserved", dims)

    cpu_pct = (cpu / max(cpu_reserved, 1)) * 100 if cpu_reserved > 0 else 0.0
    mem_pct = (mem / max(mem_reserved, 1)) * 100 if mem_reserved > 0 else 0.0

    return NormalizedMetric(
        resource=f"{cluster_name}/{service_name}",
        provider="aws",
        region=region,
        resource_type="ecs_service",
        cpu=round(min(cpu_pct, 100), 2),
        memory=round(min(mem_pct, 100), 2),
    )


def collect_ecs_task_metrics(session, cluster_name: str, task_id: str, region: str = "us-east-1") -> NormalizedMetric:
    """Collect CPU and memory for an ECS Task."""
    cw = session.client("cloudwatch", region_name=region)
    namespace = "ECS/ContainerInsights"
    dims = [
        {"Name": "ClusterName", "Value": cluster_name},
        {"Name": "TaskId", "Value": task_id},
    ]
    cpu = _cw_average(cw, namespace, "CpuUtilized", dims)
    mem = _cw_average(cw, namespace, "MemoryUtilized", dims)
    return NormalizedMetric(
        resource=f"{cluster_name}/task/{task_id}",
        provider="aws",
        region=region,
        resource_type="ecs_task",
        cpu=round(min(cpu, 100), 2),
        memory=round(min(mem, 100), 2),
    )


def collect_eks_node_metrics(session, cluster_name: str, node_name: str, region: str = "us-east-1") -> NormalizedMetric:
    """Collect CPU and memory for an EKS Node from Container Insights."""
    cw = session.client("cloudwatch", region_name=region)
    namespace = "ContainerInsights"
    dims = [
        {"Name": "ClusterName", "Value": cluster_name},
        {"Name": "NodeName", "Value": node_name},
    ]
    cpu = _cw_average(cw, namespace, "node_cpu_utilization", dims)
    mem = _cw_average(cw, namespace, "node_memory_utilization", dims)
    return NormalizedMetric(
        resource=f"{cluster_name}/node/{node_name}",
        provider="aws",
        region=region,
        resource_type="eks_node",
        cpu=round(min(cpu, 100), 2),
        memory=round(min(mem, 100), 2),
    )


def discover_ecs_services(session, region: str = "us-east-1") -> list[dict]:
    """
    Discover all ECS clusters and their services.
    Returns list of (cluster_name, service_name) dicts for metric collection.
    """
    try:
        ecs = session.client("ecs", region_name=region)
        clusters_resp = ecs.list_clusters()
        cluster_arns = clusters_resp.get("clusterArns", [])
        services_info: list[dict] = []

        for cluster_arn in cluster_arns:
            cluster_name = cluster_arn.split("/")[-1]
            try:
                paginator = ecs.get_paginator("list_services")
                for page in paginator.paginate(cluster=cluster_arn):
                    service_arns = page.get("serviceArns", [])
                    for svc_arn in service_arns:
                        svc_name = svc_arn.split("/")[-1]
                        services_info.append({
                            "cluster_name": cluster_name,
                            "cluster_arn": cluster_arn,
                            "service_name": svc_name,
                            "service_arn": svc_arn,
                        })
            except Exception as exc:
                logger.warning(f"[ContainerInsights] Failed listing services in {cluster_name}: {exc}")

        logger.info(f"[ContainerInsights] Found {len(services_info)} ECS services across {len(cluster_arns)} clusters in {region}")
        return services_info
    except Exception as exc:
        logger.error(f"[ContainerInsights] ECS service discovery failed: {exc}")
        return []


def collect_all_container_metrics(session, region: str = "us-east-1") -> list[NormalizedMetric]:
    """Collect Container Insights metrics for all ECS services."""
    metrics: list[NormalizedMetric] = []
    services = discover_ecs_services(session, region)
    for svc in services:
        try:
            m = collect_ecs_service_metrics(session, svc["cluster_name"], svc["service_name"], region)
            metrics.append(m)
        except Exception as exc:
            logger.warning(f"[ContainerInsights] Metric collection failed for {svc}: {exc}")
    return metrics
