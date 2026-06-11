"""
AWS Metrics Collection — CloudWatch metrics for EC2, EKS, RDS, ALB.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.integrations.normalization.metrics import NormalizedMetric, normalize_cloudwatch_metrics

logger = logging.getLogger(__name__)

_METRIC_PERIOD = 300       # 5-minute granularity
_LOOKBACK_MINUTES = 10     # fetch last 10 minutes


def _cloudwatch_average(cw_client, namespace: str, metric_name: str,
                         dimensions: list[dict], period: int = _METRIC_PERIOD) -> float:
    """Fetch latest average value for a single CloudWatch metric."""
    try:
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=_LOOKBACK_MINUTES)
        resp = cw_client.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            Dimensions=dimensions,
            StartTime=start,
            EndTime=end,
            Period=period,
            Statistics=["Average"],
        )
        datapoints = resp.get("Datapoints", [])
        if not datapoints:
            return 0.0
        latest = sorted(datapoints, key=lambda x: x["Timestamp"])[-1]
        return float(latest.get("Average", 0))
    except Exception as exc:
        logger.debug(f"[AWS] CloudWatch metric {metric_name} failed: {exc}")
        return 0.0


def collect_ec2_metrics(session, instance_id: str, region: str = "us-east-1") -> NormalizedMetric:
    cw = session.client("cloudwatch", region_name=region)
    dims = [{"Name": "InstanceId", "Value": instance_id}]
    cpu = _cloudwatch_average(cw, "AWS/EC2", "CPUUtilization", dims)
    return normalize_cloudwatch_metrics(
        resource_id=instance_id,
        metric_results={"CPUUtilization": cpu},
        region=region,
        resource_type="ec2_instance",
    )


def collect_rds_metrics(session, db_identifier: str, region: str = "us-east-1") -> NormalizedMetric:
    cw = session.client("cloudwatch", region_name=region)
    dims = [{"Name": "DBInstanceIdentifier", "Value": db_identifier}]
    cpu = _cloudwatch_average(cw, "AWS/RDS", "CPUUtilization", dims)
    latency = _cloudwatch_average(cw, "AWS/RDS", "ReadLatency", dims)
    connections = _cloudwatch_average(cw, "AWS/RDS", "DatabaseConnections", dims)
    return normalize_cloudwatch_metrics(
        resource_id=db_identifier,
        metric_results={
            "CPUUtilization": cpu,
            "Latency": latency,
            "DatabaseConnections": connections,
        },
        region=region,
        resource_type="rds_instance",
    )


def collect_alb_metrics(session, lb_name: str, region: str = "us-east-1") -> NormalizedMetric:
    """Collect ALB metrics — TargetResponseTime, RequestCount, HTTPCode_ELB_5XX_Count."""
    cw = session.client("cloudwatch", region_name=region)
    dims = [{"Name": "LoadBalancer", "Value": lb_name}]
    latency = _cloudwatch_average(cw, "AWS/ApplicationELB", "TargetResponseTime", dims) * 1000
    requests = _cloudwatch_average(cw, "AWS/ApplicationELB", "RequestCount", dims)
    errors = _cloudwatch_average(cw, "AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", dims)
    error_rate = (errors / max(requests, 1)) * 100 if requests > 0 else 0.0
    return normalize_cloudwatch_metrics(
        resource_id=lb_name,
        metric_results={
            "TargetResponseTime": latency / 1000,   # back to seconds for normalizer
            "RequestCount": requests,
            "HTTPCode_ELB_5XX_Count": error_rate,
        },
        region=region,
        resource_type="load_balancer",
    )


def collect_metrics_for_resources(session, resources: list[dict], region: str = "us-east-1") -> list[NormalizedMetric]:
    """Collect metrics for a list of discovered resources."""
    metrics: list[NormalizedMetric] = []
    for res in resources:
        rt = res.get("resource_type", "")
        rid = res.get("name", res.get("id", ""))
        try:
            if rt == "ec2_instance":
                metrics.append(collect_ec2_metrics(session, res["id"], region))
            elif rt == "rds_instance":
                metrics.append(collect_rds_metrics(session, rid, region))
            elif rt == "load_balancer":
                metrics.append(collect_alb_metrics(session, rid, region))
        except Exception as exc:
            logger.warning(f"[AWS] Metric collection failed for {rid}: {exc}")
    return metrics
