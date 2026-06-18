"""
AWS EventBridge — event bus and rule discovery, with failed invocation metrics.
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
            Statistics=["Sum"],
        )
        datapoints = resp.get("Datapoints", [])
        if not datapoints:
            return 0.0
        return float(sorted(datapoints, key=lambda x: x["Timestamp"])[-1].get("Sum", 0))
    except Exception as exc:
        logger.debug(f"[EventBridge] CW metric {metric_name} failed: {exc}")
        return 0.0


def discover_event_buses(session, region: str = "us-east-1") -> list[dict]:
    """
    Discover all EventBridge event buses.
    Returns list of event bus resource dicts.
    """
    try:
        events = session.client("events", region_name=region)
        resp = events.list_event_buses()
        buses: list[dict] = []

        for bus in resp.get("EventBuses", []):
            name = bus.get("Name", "")
            arn = bus.get("Arn", "")
            buses.append({
                "id": arn or name,
                "name": name,
                "resource_type": "event_bus",
                "provider": "aws",
                "region": region,
                "health": "healthy",
                "layer": "infrastructure",
                "metrics": {},
                "discovered_at": datetime.now(timezone.utc).isoformat(),
                "arn": arn,
                "policy": bus.get("Policy", ""),
            })

        logger.info(f"[EventBridge] Discovered {len(buses)} event buses in {region}")
        return buses
    except Exception as exc:
        logger.error(f"[EventBridge] Event bus discovery failed in {region}: {exc}")
        return []


def discover_rules(session, event_bus_name: str = "default", region: str = "us-east-1") -> list[dict]:
    """
    Discover EventBridge rules on an event bus.
    Returns list of rule resource dicts.
    """
    try:
        ev = session.client("events", region_name=region)
        paginator = ev.get_paginator("list_rules")
        rules: list[dict] = []

        for page in paginator.paginate(EventBusName=event_bus_name):
            for rule in page.get("Rules", []):
                state = rule.get("State", "DISABLED")
                health = "healthy" if state == "ENABLED" else "warning"
                rules.append({
                    "id": rule.get("Arn", rule.get("Name", "")),
                    "name": rule.get("Name", ""),
                    "resource_type": "event_rule",
                    "provider": "aws",
                    "region": region,
                    "health": health,
                    "layer": "infrastructure",
                    "metrics": {},
                    "discovered_at": datetime.now(timezone.utc).isoformat(),
                    "arn": rule.get("Arn", ""),
                    "description": rule.get("Description", ""),
                    "state": state,
                    "event_bus": event_bus_name,
                    "schedule_expression": rule.get("ScheduleExpression", ""),
                    "event_pattern": rule.get("EventPattern", ""),
                })

        logger.info(f"[EventBridge] Discovered {len(rules)} rules on bus '{event_bus_name}' in {region}")
        return rules
    except Exception as exc:
        logger.error(f"[EventBridge] Rule discovery failed for bus '{event_bus_name}' in {region}: {exc}")
        return []


def collect_rule_metrics(session, rule_name: str, region: str = "us-east-1") -> dict:
    """Collect CloudWatch metrics for an EventBridge rule."""
    try:
        cw = session.client("cloudwatch", region_name=region)
        dims = [{"Name": "RuleName", "Value": rule_name}]
        namespace = "AWS/Events"

        invocations = _cw_average(cw, namespace, "Invocations", dims)
        failed = _cw_average(cw, namespace, "FailedInvocations", dims)
        throttled = _cw_average(cw, namespace, "ThrottledRules", dims)

        return {
            "rule_name": rule_name,
            "invocations": invocations,
            "failed_invocations": failed,
            "throttled_rules": throttled,
            "failure_rate": (failed / max(invocations, 1)) * 100 if invocations > 0 else 0.0,
            "region": region,
            "collected_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.warning(f"[EventBridge] Metrics failed for rule '{rule_name}': {exc}")
        return {}


def discover_all(session, region: str = "us-east-1") -> list[dict]:
    """
    Discover all EventBridge event buses and their rules.
    Returns combined list of resource dicts.
    """
    buses = discover_event_buses(session, region)
    all_resources: list[dict] = list(buses)

    for bus in buses:
        rules = discover_rules(session, bus["name"], region)
        all_resources.extend(rules)

    return all_resources
