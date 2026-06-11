"""
Normalization models and helpers for cloud metrics.

All providers must convert their native metric responses to NormalizedMetric
before writing to the data store.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


class NormalizedMetric(BaseModel):
    resource: str               # resource id / name
    provider: str               # "aws" | "azure" | "gcp" | "kubernetes"
    region: str = "global"
    resource_type: str = "unknown"  # "ec2" | "vm" | "pod" | etc.
    cpu: float = 0.0            # percentage 0-100
    memory: float = 0.0         # percentage 0-100
    latency: float = 0.0        # milliseconds
    error_rate: float = 0.0     # percentage 0-100
    throughput: float = 0.0     # requests/second
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_monitoring_dict(self) -> dict:
        """Return a dict compatible with the existing monitoring/metrics.json schema."""
        return {
            "entity_id": self.resource,
            "metric": "composite",
            "provider": self.provider,
            "region": self.region,
            "resource_type": self.resource_type,
            "cpu": self.cpu,
            "memory": self.memory,
            "latency": self.latency,
            "error_rate": self.error_rate,
            "throughput": self.throughput,
            "timestamp": self.timestamp,
        }


def normalize_cloudwatch_metrics(
    resource_id: str,
    metric_results: dict,
    region: str = "us-east-1",
    resource_type: str = "ec2",
) -> NormalizedMetric:
    """Build NormalizedMetric from a dict of CloudWatch metric name→value."""
    return NormalizedMetric(
        resource=resource_id,
        provider="aws",
        region=region,
        resource_type=resource_type,
        cpu=float(metric_results.get("CPUUtilization", 0)),
        memory=float(metric_results.get("MemoryUtilization", metric_results.get("mem_used_percent", 0))),
        latency=float(metric_results.get("TargetResponseTime", metric_results.get("Latency", 0))) * 1000,  # s→ms
        error_rate=float(metric_results.get("HTTPCode_ELB_5XX_Count", metric_results.get("Errors", 0))),
        throughput=float(metric_results.get("RequestCount", metric_results.get("NetworkIn", 0))),
    )


def normalize_azure_metrics(
    resource_id: str,
    metric_results: dict,
    region: str = "eastus",
    resource_type: str = "vm",
) -> NormalizedMetric:
    """Build NormalizedMetric from Azure Monitor metric dict."""
    return NormalizedMetric(
        resource=resource_id,
        provider="azure",
        region=region,
        resource_type=resource_type,
        cpu=float(metric_results.get("Percentage CPU", metric_results.get("cpu_percent", 0))),
        memory=float(metric_results.get("Available Memory Bytes", 0)),
        latency=float(metric_results.get("Http Response Time", metric_results.get("latency_ms", 0))),
        error_rate=float(metric_results.get("Http 5xx", metric_results.get("error_rate", 0))),
        throughput=float(metric_results.get("Requests", metric_results.get("throughput", 0))),
    )


def normalize_gcp_metrics(
    resource_id: str,
    metric_results: dict,
    region: str = "us-central1",
    resource_type: str = "gce_instance",
) -> NormalizedMetric:
    """Build NormalizedMetric from GCP Monitoring metric dict."""
    return NormalizedMetric(
        resource=resource_id,
        provider="gcp",
        region=region,
        resource_type=resource_type,
        cpu=float(metric_results.get("compute.googleapis.com/instance/cpu/utilization", 0)) * 100,
        memory=float(metric_results.get("compute.googleapis.com/instance/memory/balloon/ram_used", 0)),
        latency=float(metric_results.get("loadbalancing.googleapis.com/https/backend_latencies", 0)),
        error_rate=float(metric_results.get("loadbalancing.googleapis.com/https/request_count", 0)),
        throughput=float(metric_results.get("compute.googleapis.com/instance/network/received_bytes_count", 0)),
    )


def normalize_k8s_metrics(
    pod_name: str,
    namespace: str,
    cpu_usage_m: float,
    memory_usage_bytes: float,
    cpu_limit_m: float = 1000.0,
    memory_limit_bytes: float = 1073741824.0,
) -> NormalizedMetric:
    """Build NormalizedMetric from Kubernetes Metrics API response."""
    cpu_pct = (cpu_usage_m / max(cpu_limit_m, 1)) * 100
    mem_pct = (memory_usage_bytes / max(memory_limit_bytes, 1)) * 100
    return NormalizedMetric(
        resource=f"{namespace}/{pod_name}",
        provider="kubernetes",
        region=namespace,
        resource_type="pod",
        cpu=round(min(cpu_pct, 100), 2),
        memory=round(min(mem_pct, 100), 2),
        latency=0.0,
        error_rate=0.0,
        throughput=0.0,
    )
