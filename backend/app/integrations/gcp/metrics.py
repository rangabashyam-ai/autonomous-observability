"""
GCP Metrics Collection — Cloud Monitoring (Stackdriver).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.integrations.normalization.metrics import NormalizedMetric, normalize_gcp_metrics

logger = logging.getLogger(__name__)


def _query_metric(monitoring_client, project_id: str, metric_type: str,
                  resource_filter: str = "", minutes: int = 10) -> float:
    """Query a single GCP metric type and return the latest average value."""
    try:
        from google.cloud.monitoring_v3 import TimeInterval
        from google.protobuf.timestamp_pb2 import Timestamp
        import time

        now_seconds = int(time.time())
        interval = TimeInterval(
            end_time={"seconds": now_seconds},
            start_time={"seconds": now_seconds - minutes * 60},
        )
        filter_str = f'metric.type="{metric_type}"'
        if resource_filter:
            filter_str += f' AND {resource_filter}'

        results = monitoring_client.list_time_series(
            request={
                "name": f"projects/{project_id}",
                "filter": filter_str,
                "interval": interval,
                "view": "FULL",
            }
        )
        values = []
        for ts in results:
            for point in ts.points:
                val = point.value.double_value or point.value.int64_value or 0
                values.append(float(val))
        return sum(values) / len(values) if values else 0.0
    except Exception as exc:
        logger.debug(f"[GCP] Metric query failed ({metric_type}): {exc}")
        return 0.0


def collect_gce_metrics(credentials, project_id: str, instance_id: str, region: str) -> NormalizedMetric:
    try:
        from google.cloud import monitoring_v3
        client = monitoring_v3.MetricServiceClient(credentials=credentials)
        cpu = _query_metric(
            client, project_id,
            "compute.googleapis.com/instance/cpu/utilization",
            f'resource.labels.instance_id="{instance_id}"',
        ) * 100
        return normalize_gcp_metrics(
            resource_id=instance_id,
            metric_results={"compute.googleapis.com/instance/cpu/utilization": cpu / 100},
            region=region,
            resource_type="gce_instance",
        )
    except Exception as exc:
        logger.warning(f"[GCP] GCE metrics failed for {instance_id}: {exc}")
        return NormalizedMetric(resource=instance_id, provider="gcp", region=region, resource_type="gce_instance")


def collect_metrics_for_resources(credentials, resources: list[dict], project_id: str) -> list[NormalizedMetric]:
    metrics: list[NormalizedMetric] = []
    for res in resources:
        rt = res.get("resource_type", "")
        rid = res.get("id", res.get("name", ""))
        region = res.get("region", "us-central1")
        try:
            if rt == "gce_instance":
                instance_id = res.get("id", rid).split("/")[-1]
                metrics.append(collect_gce_metrics(credentials, project_id, instance_id, region))
        except Exception as exc:
            logger.warning(f"[GCP] Metric collection failed for {rid}: {exc}")
    return metrics
