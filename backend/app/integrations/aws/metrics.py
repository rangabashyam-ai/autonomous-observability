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


def collect_alb_metrics(session, lb_arn: str, region: str = "us-east-1") -> NormalizedMetric:
    """Collect ALB metrics — TargetResponseTime, RequestCount, HTTPCode_ELB_5XX_Count.

    CloudWatch requires the ARN suffix as the LoadBalancer dimension value, NOT the
    plain load-balancer name.  Example suffix: 'app/my-alb/50dc6c495c0c9188'.
    ARN format: arn:aws:elasticloadbalancing:<region>:<acct>:loadbalancer/<suffix>
    """
    cw = session.client("cloudwatch", region_name=region)
    # Extract the CloudWatch-compatible suffix from the full ARN.
    # Falls back to the raw value so plain names still work (e.g. NLBs).
    if "loadbalancer/" in lb_arn:
        cw_lb_id = lb_arn.split("loadbalancer/", 1)[1]
    else:
        cw_lb_id = lb_arn
    dims = [{"Name": "LoadBalancer", "Value": cw_lb_id}]
    latency = _cloudwatch_average(cw, "AWS/ApplicationELB", "TargetResponseTime", dims) * 1000
    requests = _cloudwatch_average(cw, "AWS/ApplicationELB", "RequestCount", dims)
    errors = _cloudwatch_average(cw, "AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", dims)
    error_rate = (errors / max(requests, 1)) * 100 if requests > 0 else 0.0
    return normalize_cloudwatch_metrics(
        resource_id=lb_arn,
        metric_results={
            "TargetResponseTime": latency / 1000,   # back to seconds for normalizer
            "RequestCount": requests,
            "HTTPCode_ELB_5XX_Count": error_rate,
        },
        region=region,
        resource_type="load_balancer",
    )


def collect_ecs_metrics(session, cluster_name: str, service_name: str, region: str = "us-east-1") -> NormalizedMetric:
    """Collect ECS Service metrics via Container Insights."""
    from app.integrations.aws.container_insights import collect_ecs_service_metrics
    return collect_ecs_service_metrics(session, cluster_name, service_name, region)


def collect_eks_metrics(session, cluster_name: str, region: str = "us-east-1") -> NormalizedMetric:
    """Collect EKS cluster-level metrics via Container Insights.

    Requires Container Insights to be enabled on the cluster.
    Falls back to 0.0 gracefully if not enabled.
    """
    from app.integrations.aws.container_insights import collect_eks_node_metrics
    cw = session.client("cloudwatch", region_name=region)
    # Fetch cluster-level aggregated CPU and memory from ContainerInsights namespace
    namespace = "ContainerInsights"
    dims = [{"Name": "ClusterName", "Value": cluster_name}]
    cpu = _cloudwatch_average(cw, namespace, "node_cpu_utilization", dims)
    mem = _cloudwatch_average(cw, namespace, "node_memory_utilization", dims)
    return NormalizedMetric(
        resource=cluster_name,
        provider="aws",
        region=region,
        resource_type="eks_cluster",
        cpu=round(min(cpu, 100), 2),
        memory=round(min(mem, 100), 2),
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
                # Pass the full ARN (stored in res["id"] by discovery.py) so that
                # collect_alb_metrics can extract the correct CloudWatch dimension suffix.
                lb_arn = res.get("id", rid)
                metrics.append(collect_alb_metrics(session, lb_arn, region))
            elif rt == "ecs_service":
                cluster = res.get("cluster", "")
                if cluster:
                    metrics.append(collect_ecs_metrics(session, cluster, rid, region))
            elif rt == "eks_cluster":
                # Collect cluster-level CPU/memory from Container Insights.
                # Returns 0.0 gracefully if Container Insights is not enabled.
                metrics.append(collect_eks_metrics(session, rid, region))
        except Exception as exc:
            logger.warning(f"[AWS] Metric collection failed for {rid}: {exc}")
    return metrics

