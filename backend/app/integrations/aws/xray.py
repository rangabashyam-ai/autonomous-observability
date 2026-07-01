"""
AWS X-Ray — Distributed trace collection.
Fetches recent trace summaries and detailed segments.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

_LOOKBACK_MINUTES = 5
_MAX_TRACES = 100


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def collect_trace_summaries(session, region: str = "us-east-1", lookback_minutes: int = _LOOKBACK_MINUTES) -> list[dict]:
    """
    Fetch X-Ray trace summaries from the last `lookback_minutes` minutes.
    Returns a list of normalized trace dicts.
    """
    try:
        xray = session.client("xray", region_name=region)
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=lookback_minutes)

        paginator = xray.get_paginator("get_trace_summaries")
        traces: list[dict] = []

        for page in paginator.paginate(
            StartTime=start,
            EndTime=end,
            TimeRangeType="TraceId",
            Sampling=False,
        ):
            for summary in page.get("TraceSummaries", []):
                # Extract service list
                services = [
                    svc.get("Name", "unknown")
                    for svc in summary.get("ServiceIds", [])
                    if svc.get("Name")
                ]
                # Response time in seconds → ms
                response_time_ms = _safe_float(summary.get("ResponseTime")) * 1000

                trace = {
                    "trace_id": summary.get("Id", ""),
                    "provider": "aws",
                    "region": region,
                    "duration_ms": response_time_ms,
                    "has_error": summary.get("HasError", False),
                    "has_fault": summary.get("HasFault", False),
                    "has_throttle": summary.get("HasThrottle", False),
                    "http_status": summary.get("Http", {}).get("HttpStatus"),
                    "http_url": summary.get("Http", {}).get("HttpURL", ""),
                    "http_method": summary.get("Http", {}).get("HttpMethod", ""),
                    "services": services,
                    "root_service": services[0] if services else "unknown",
                    "timestamp": summary.get("StartTime", datetime.now(timezone.utc)).isoformat()
                    if hasattr(summary.get("StartTime"), "isoformat")
                    else str(summary.get("StartTime", "")),
                    "user": summary.get("Users", [{}])[0].get("UserName", "") if summary.get("Users") else "",
                }
                traces.append(trace)

                if len(traces) >= _MAX_TRACES:
                    break
            if len(traces) >= _MAX_TRACES:
                break

        logger.info(f"[X-Ray] Collected {len(traces)} trace summaries from {region}")
        return traces

    except Exception as exc:
        logger.error(f"[X-Ray] Trace collection failed in {region}: {exc}")
        return []


def collect_service_map(session, region: str = "us-east-1", lookback_minutes: int = 60) -> list[dict]:
    """
    Fetch X-Ray service map — shows call relationships between services.
    Returns list of service nodes with connection edges.
    """
    try:
        xray = session.client("xray", region_name=region)
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=lookback_minutes)

        resp = xray.get_service_graph(StartTime=start, EndTime=end)
        services = resp.get("Services", [])

        nodes: list[dict] = []
        for svc in services:
            node = {
                "service_id": svc.get("ReferenceId", 0),
                "name": svc.get("Name", "unknown"),
                "type": svc.get("Type", "unknown"),
                "account_id": svc.get("AccountId", ""),
                "edges": [
                    {
                        "target_id": edge.get("ReferenceId"),
                        "summary": {
                            "ok_count": edge.get("SummaryStatistics", {}).get("OkCount", 0),
                            "error_count": edge.get("SummaryStatistics", {}).get("ErrorStatistics", {}).get("TotalCount", 0),
                            "fault_count": edge.get("SummaryStatistics", {}).get("FaultStatistics", {}).get("TotalCount", 0),
                        },
                    }
                    for edge in svc.get("Edges", [])
                ],
                "summary": {
                    "ok_count": svc.get("SummaryStatistics", {}).get("OkCount", 0),
                    "error_count": svc.get("SummaryStatistics", {}).get("ErrorStatistics", {}).get("TotalCount", 0),
                    "fault_count": svc.get("SummaryStatistics", {}).get("FaultStatistics", {}).get("TotalCount", 0),
                    "total_count": svc.get("SummaryStatistics", {}).get("TotalCount", 0),
                },
            }
            nodes.append(node)

        logger.info(f"[X-Ray] Service map has {len(nodes)} services in {region}")
        return nodes

    except Exception as exc:
        logger.error(f"[X-Ray] Service map collection failed in {region}: {exc}")
        return []


def collect_all(session, region: str = "us-east-1") -> dict:
    """Collect traces and service map, returning combined payload."""
    traces = collect_trace_summaries(session, region)
    service_map = collect_service_map(session, region)
    return {
        "traces": traces,
        "service_map": service_map,
        "region": region,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }
