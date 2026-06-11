"""
Azure Metrics Collection — Azure Monitor Metrics.
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
    try:
        from azure.monitor.query import MetricsQueryClient
        client = MetricsQueryClient(credential)
        values = _query_metric(client, resource_id, ["cpu_percent", "storage_percent", "connection_successful"])
        return normalize_azure_metrics(
            resource_id=resource_id,
            metric_results={"Percentage CPU": values.get("cpu_percent", 0)},
            region=region,
            resource_type="azure_sql",
        )
    except Exception as exc:
        logger.warning(f"[Azure] SQL metrics failed for {resource_id}: {exc}")
        return NormalizedMetric(resource=resource_id, provider="azure", region=region, resource_type="azure_sql")


def collect_metrics_for_resources(credential, resources: list[dict]) -> list[NormalizedMetric]:
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
        except Exception as exc:
            logger.warning(f"[Azure] Metric collection failed for {rid}: {exc}")
    return metrics
