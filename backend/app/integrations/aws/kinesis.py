"""
AWS Kinesis Data Streams — stream discovery and shard-level metrics.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

_METRIC_PERIOD = 300
_LOOKBACK_MINUTES = 10


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
            Period=_METRIC_PERIOD,
            Statistics=["Average"],
        )
        datapoints = resp.get("Datapoints", [])
        if not datapoints:
            return 0.0
        return float(sorted(datapoints, key=lambda x: x["Timestamp"])[-1].get("Average", 0))
    except Exception as exc:
        logger.debug(f"[Kinesis] CW metric {metric_name} failed: {exc}")
        return 0.0


def discover_streams(session, region: str = "us-east-1") -> list[dict]:
    """
    Discover all Kinesis Data Streams and their configuration.
    Returns list of stream resource dicts.
    """
    try:
        kinesis = session.client("kinesis", region_name=region)
        paginator = kinesis.get_paginator("list_streams")
        streams: list[dict] = []

        for page in paginator.paginate():
            for stream_name in page.get("StreamNames", []):
                try:
                    detail = kinesis.describe_stream_summary(StreamName=stream_name)
                    summary = detail.get("StreamDescriptionSummary", {})
                    status = summary.get("StreamStatus", "UNKNOWN")
                    health = "healthy" if status == "ACTIVE" else "critical" if status in ("DELETING",) else "warning"

                    streams.append({
                        "id": summary.get("StreamARN", stream_name),
                        "name": stream_name,
                        "resource_type": "kinesis_stream",
                        "provider": "aws",
                        "region": region,
                        "health": health,
                        "layer": "infrastructure",
                        "metrics": {},
                        "discovered_at": datetime.now(timezone.utc).isoformat(),
                        "shard_count": summary.get("OpenShardCount", 0),
                        "retention_hours": summary.get("RetentionPeriodHours", 24),
                        "status": status,
                        "stream_arn": summary.get("StreamARN", ""),
                        "encryption_type": summary.get("EncryptionType", "NONE"),
                    })
                except Exception as exc:
                    logger.warning(f"[Kinesis] Failed to describe stream '{stream_name}': {exc}")

        logger.info(f"[Kinesis] Discovered {len(streams)} streams in {region}")
        return streams
    except Exception as exc:
        logger.error(f"[Kinesis] Stream discovery failed in {region}: {exc}")
        return []


def collect_stream_metrics(session, stream_name: str, region: str = "us-east-1") -> dict:
    """
    Collect CloudWatch metrics for a Kinesis stream.
    """
    try:
        cw = session.client("cloudwatch", region_name=region)
        dims = [{"Name": "StreamName", "Value": stream_name}]
        namespace = "AWS/Kinesis"

        iterator_age_ms = _cw_average(cw, namespace, "GetRecords.IteratorAgeMilliseconds", dims)
        incoming_records = _cw_average(cw, namespace, "IncomingRecords", dims)
        incoming_bytes = _cw_average(cw, namespace, "IncomingBytes", dims)
        read_bytes = _cw_average(cw, namespace, "GetRecords.Bytes", dims)
        throttled_records = _cw_average(cw, namespace, "ReadProvisionedThroughputExceeded", dims)

        return {
            "stream_name": stream_name,
            "iterator_age_ms": iterator_age_ms,
            "incoming_records_per_sec": incoming_records,
            "incoming_bytes_per_sec": incoming_bytes,
            "read_bytes_per_sec": read_bytes,
            "throttled_reads": throttled_records,
            "region": region,
            "collected_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.warning(f"[Kinesis] Metrics failed for stream '{stream_name}': {exc}")
        return {}


def collect_all_stream_metrics(session, region: str = "us-east-1") -> list[dict]:
    """Discover streams and collect metrics for all of them."""
    streams = discover_streams(session, region)
    metrics: list[dict] = []
    for stream in streams:
        m = collect_stream_metrics(session, stream["name"], region)
        if m:
            metrics.append(m)
    return metrics
