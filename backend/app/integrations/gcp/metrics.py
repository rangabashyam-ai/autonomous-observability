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


def collect_gke_metrics(credentials, project_id: str, cluster_name: str, region: str) -> NormalizedMetric:
    try:
        from google.cloud import monitoring_v3
        client = monitoring_v3.MetricServiceClient(credentials=credentials)
        cpu = _query_metric(
            client, project_id,
            "kubernetes.io/cluster/cpu/core_usage_time",
            f'resource.labels.cluster_name="{cluster_name}"',
        ) * 100
        return normalize_gcp_metrics(
            resource_id=cluster_name,
            metric_results={"kubernetes.io/cluster/cpu/core_usage_time": cpu / 100},
            region=region,
            resource_type="gke_cluster",
        )
    except Exception as exc:
        logger.warning(f"[GCP] GKE metrics failed for {cluster_name}: {exc}")
        return NormalizedMetric(resource=cluster_name, provider="gcp", region=region, resource_type="gke_cluster")


def collect_cloudsql_metrics(credentials, project_id: str, instance_id: str, region: str) -> NormalizedMetric:
    try:
        from google.cloud import monitoring_v3
        client = monitoring_v3.MetricServiceClient(credentials=credentials)
        cpu = _query_metric(
            client, project_id,
            "cloudsql.googleapis.com/database/cpu/utilization",
            f'resource.labels.database_id="{project_id}:{instance_id}"',
        ) * 100
        return normalize_gcp_metrics(
            resource_id=instance_id,
            metric_results={"cloudsql.googleapis.com/database/cpu/utilization": cpu / 100},
            region=region,
            resource_type="cloud_sql",
        )
    except Exception as exc:
        logger.warning(f"[GCP] Cloud SQL metrics failed for {instance_id}: {exc}")
        return NormalizedMetric(resource=instance_id, provider="gcp", region=region, resource_type="cloud_sql")


def collect_pubsub_metrics(credentials, project_id: str, topic_id: str, region: str) -> NormalizedMetric:
    try:
        from google.cloud import monitoring_v3
        client = monitoring_v3.MetricServiceClient(credentials=credentials)
        msg_count = _query_metric(
            client, project_id,
            "pubsub.googleapis.com/topic/send_request_count",
            f'resource.labels.topic_id="{topic_id}"',
        )
        return normalize_gcp_metrics(
            resource_id=topic_id,
            metric_results={"pubsub.googleapis.com/topic/send_request_count": msg_count},
            region=region,
            resource_type="pubsub_topic",
        )
    except Exception as exc:
        logger.warning(f"[GCP] Pub/Sub metrics failed for {topic_id}: {exc}")
        return NormalizedMetric(resource=topic_id, provider="gcp", region=region, resource_type="pubsub_topic")


def collect_lb_metrics(credentials, project_id: str, rule_name: str, region: str) -> NormalizedMetric:
    try:
        from google.cloud import monitoring_v3
        client = monitoring_v3.MetricServiceClient(credentials=credentials)
        req_count = _query_metric(
            client, project_id,
            "loadbalancing.googleapis.com/https/request_count",
            f'resource.labels.forwarding_rule_name="{rule_name}"',
        )
        return normalize_gcp_metrics(
            resource_id=rule_name,
            metric_results={"loadbalancing.googleapis.com/https/request_count": req_count},
            region=region,
            resource_type="load_balancer",
        )
    except Exception as exc:
        logger.warning(f"[GCP] Load Balancer metrics failed for {rule_name}: {exc}")
        return NormalizedMetric(resource=rule_name, provider="gcp", region=region, resource_type="load_balancer")


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
            elif rt == "gke_cluster":
                cluster_name = res.get("name", rid)
                metrics.append(collect_gke_metrics(credentials, project_id, cluster_name, region))
            elif rt == "cloud_sql":
                instance_name = res.get("name", rid)
                metrics.append(collect_cloudsql_metrics(credentials, project_id, instance_name, region))
            elif rt == "pubsub_topic":
                topic_id = res.get("name", rid)
                metrics.append(collect_pubsub_metrics(credentials, project_id, topic_id, region))
            elif rt == "load_balancer":
                rule_name = res.get("name", rid)
                metrics.append(collect_lb_metrics(credentials, project_id, rule_name, region))
        except Exception as exc:
            logger.warning(f"[GCP] Metric collection failed for {rid}: {exc}")
    return metrics
