"""
Azure Metrics Collection — Azure Monitor Metrics for VMs, SQL, and AKS.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.integrations.normalization.metrics import NormalizedMetric, normalize_azure_metrics

logger = logging.getLogger(__name__)


def _query_metric(metrics_client, resource_id: str, metric_names: list[str],
                  timespan_minutes: int = 10) -> dict:
    """Query Azure Monitor metrics and return name→average dict."""
    try:
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=timespan_minutes)
        result = metrics_client.query_resource(
            resource_uri=resource_id,
            metric_names=metric_names,
            timespan=(start, end),
            granularity=timedelta(minutes=5),
            aggregations=["Average"],
        )
        out = {}
        for metric in result.metrics:
            for ts in metric.timeseries:
                for dp in ts.data:
                    if dp.average is not None:
                        out[metric.name] = dp.average
                        break
        return out
    except Exception as exc:
        logger.debug(f"[Azure] Metric query failed for {resource_id}: {exc}")
        return {}


def collect_vm_metrics(credential, resource_id: str, region: str = "eastus") -> NormalizedMetric:
    """Collect Azure VM metrics — CPU and available memory."""
    try:
        from azure.monitor.query import MetricsQueryClient
        client = MetricsQueryClient(credential)
        values = _query_metric(client, resource_id, ["Percentage CPU", "Available Memory Bytes"])
        return normalize_azure_metrics(
            resource_id=resource_id,
            metric_results=values,
            region=region,
            resource_type="azure_vm",
        )
    except Exception as exc:
        logger.warning(f"[Azure] VM metrics failed for {resource_id}: {exc}")
        return NormalizedMetric(resource=resource_id, provider="azure", region=region, resource_type="azure_vm")


def collect_sql_metrics(credential, resource_id: str, region: str = "eastus") -> NormalizedMetric:
    """Collect Azure SQL Database metrics — CPU, storage, connections.

    Bug fixed: Azure Monitor returns 'cpu_percent' but the normalizer expects
    'Percentage CPU'. We now remap the raw keys before passing to normalize_azure_metrics.
    """
    try:
        from azure.monitor.query import MetricsQueryClient
        client = MetricsQueryClient(credential)
        raw = _query_metric(client, resource_id, ["cpu_percent", "storage_percent", "connection_successful"])
        # Remap Azure SQL metric names → normalizer-expected names
        remapped = {
            "Percentage CPU": raw.get("cpu_percent", 0.0),
            "storage_percent": raw.get("storage_percent", 0.0),
            "connection_successful": raw.get("connection_successful", 0.0),
        }
        return normalize_azure_metrics(
            resource_id=resource_id,
            metric_results=remapped,
            region=region,
            resource_type="azure_sql",
        )
    except Exception as exc:
        logger.warning(f"[Azure] SQL metrics failed for {resource_id}: {exc}")
        return NormalizedMetric(resource=resource_id, provider="azure", region=region, resource_type="azure_sql")


def collect_aks_metrics(credential, resource_id: str, cluster_name: str, region: str = "eastus") -> NormalizedMetric:
    """Collect AKS cluster-level metrics from Azure Monitor Container Insights.

    Uses the 'Insights.Container/clusters' namespace metrics.
    Falls back to 0.0 gracefully if Container Insights is not enabled.
    """
    try:
        from azure.monitor.query import MetricsQueryClient
        client = MetricsQueryClient(credential)
        # Container Insights namespace metrics for AKS clusters
        values = _query_metric(
            client,
            resource_id,
            ["node_cpu_usage_percentage", "node_memory_working_set_percentage"],
            timespan_minutes=10,
        )
        cpu = values.get("node_cpu_usage_percentage", 0.0)
        mem = values.get("node_memory_working_set_percentage", 0.0)
        return NormalizedMetric(
            resource=cluster_name,
            provider="azure",
            region=region,
            resource_type="aks_cluster",
            cpu=round(min(float(cpu), 100.0), 2),
            memory=round(min(float(mem), 100.0), 2),
        )
    except Exception as exc:
        logger.warning(f"[Azure] AKS metrics failed for {resource_id}: {exc}")
        return NormalizedMetric(resource=cluster_name, provider="azure", region=region, resource_type="aks_cluster")


def collect_metrics_for_resources(credential, resources: list[dict]) -> list[NormalizedMetric]:
    """Collect metrics for a list of discovered Azure resources."""
    metrics: list[NormalizedMetric] = []
    for res in resources:
        rt = res.get("resource_type", "")
        rid = res.get("id", "")
        region = res.get("region", "eastus")
        try:
            if rt == "azure_vm":
                metrics.append(collect_vm_metrics(credential, rid, region))
            elif rt == "azure_sql":
                metrics.append(collect_sql_metrics(credential, rid, region))
            elif rt == "aks_cluster":
                # AKS metrics require the resource ID and cluster name
                cluster_name = res.get("name", rid)
                metrics.append(collect_aks_metrics(credential, rid, cluster_name, region))
        except Exception as exc:
            logger.warning(f"[Azure] Metric collection failed for {rid}: {exc}")
    return metrics
