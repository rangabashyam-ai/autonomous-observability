"""
AWS CloudWatch Logs — log group discovery, log event collection, and VPC Flow Logs.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

_LOOKBACK_MINUTES = 5
_MAX_LOG_GROUPS = 50
_MAX_EVENTS_PER_GROUP = 200
_ERROR_FILTER = "?ERROR ?WARN ?Exception ?error ?warn ?critical ?CRITICAL ?5xx ?500 ?502 ?503"


def discover_log_groups(session, region: str = "us-east-1", prefix: str = "") -> list[dict]:
    """
    Discover CloudWatch Log Groups.
    Returns list of log group metadata dicts.
    """
    try:
        logs = session.client("logs", region_name=region)
        paginator = logs.get_paginator("describe_log_groups")
        groups: list[dict] = []
        kwargs = {"limit": 50}
        if prefix:
            kwargs["logGroupNamePrefix"] = prefix

        for page in paginator.paginate(**kwargs):
            for lg in page.get("logGroups", []):
                groups.append({
                    "name": lg.get("logGroupName", ""),
                    "arn": lg.get("arn", ""),
                    "stored_bytes": lg.get("storedBytes", 0),
                    "retention_days": lg.get("retentionInDays"),
                    "created_at": datetime.fromtimestamp(
                        lg.get("creationTime", 0) / 1000, tz=timezone.utc
                    ).isoformat() if lg.get("creationTime") else "",
                })
                if len(groups) >= _MAX_LOG_GROUPS:
                    break
            if len(groups) >= _MAX_LOG_GROUPS:
                break

        logger.info(f"[Logs] Discovered {len(groups)} log groups in {region}")
        return groups
    except Exception as exc:
        logger.error(f"[Logs] Log group discovery failed in {region}: {exc}")
        return []


def collect_log_events(
    session,
    log_group_name: str,
    region: str = "us-east-1",
    lookback_minutes: int = _LOOKBACK_MINUTES,
    filter_pattern: str = _ERROR_FILTER,
    max_events: int = _MAX_EVENTS_PER_GROUP,
) -> list[dict]:
    """
    Collect recent log events from a CloudWatch Log Group, filtered for errors/warnings.
    """
    try:
        logs = session.client("logs", region_name=region)
        end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        start_ms = int((datetime.now(timezone.utc) - timedelta(minutes=lookback_minutes)).timestamp() * 1000)

        resp = logs.filter_log_events(
            logGroupName=log_group_name,
            startTime=start_ms,
            endTime=end_ms,
            filterPattern=filter_pattern,
            limit=max_events,
        )
        events: list[dict] = []
        for ev in resp.get("events", []):
            events.append({
                "log_group": log_group_name,
                "log_stream": ev.get("logStreamName", ""),
                "message": ev.get("message", ""),
                "timestamp": datetime.fromtimestamp(
                    ev.get("timestamp", 0) / 1000, tz=timezone.utc
                ).isoformat(),
                "ingestion_time": datetime.fromtimestamp(
                    ev.get("ingestionTime", 0) / 1000, tz=timezone.utc
                ).isoformat(),
                "provider": "aws",
                "region": region,
                "source": "cloudwatch_logs",
            })
        return events
    except Exception as exc:
        logger.debug(f"[Logs] Event collection failed for {log_group_name}: {exc}")
        return []


def collect_vpc_flow_logs(session, region: str = "us-east-1") -> list[dict]:
    """
    Discover VPC Flow Log destinations (CloudWatch Log Groups) and collect recent entries.
    VPC Flow Logs must be enabled and pointed to CloudWatch in the user's AWS account.
    """
    try:
        ec2 = session.client("ec2", region_name=region)
        resp = ec2.describe_flow_logs()
        flow_logs = resp.get("FlowLogs", [])
        vpc_log_groups: set[str] = set()

        for fl in flow_logs:
            if fl.get("LogDestinationType", "") in ("cloud-watch-logs", ""):
                group = fl.get("LogGroupName", "")
                if group:
                    vpc_log_groups.add(group)

        logger.info(f"[VPC Flow Logs] Found {len(vpc_log_groups)} flow log groups in {region}")

        all_events: list[dict] = []
        for group in vpc_log_groups:
            events = collect_log_events(
                session,
                group,
                region=region,
                lookback_minutes=_LOOKBACK_MINUTES,
                filter_pattern="",  # Collect all VPC flow log events
                max_events=100,
            )
            for ev in events:
                ev["source"] = "vpc_flow_logs"
            all_events.extend(events)

        return all_events
    except Exception as exc:
        logger.error(f"[VPC Flow Logs] Collection failed in {region}: {exc}")
        return []


def collect_all_logs(session, region: str = "us-east-1") -> dict:
    """
    Collect error/warning log events from all CloudWatch Log Groups + VPC Flow Logs.
    Returns combined payload for storage.
    """
    log_groups = discover_log_groups(session, region)
    app_events: list[dict] = []

    for group in log_groups:
        group_name = group["name"]
        # Collect from:
        #   - User-relevant AWS service log groups: Lambda, API Gateway, ECS, CodeBuild
        #   - All custom (non-/aws/) application log groups
        # Skip noisy internal AWS logs: /aws/rds/, /aws/systems-manager/, etc.
        is_relevant_aws_service = (
            group_name.startswith("/aws/lambda/")
            or group_name.startswith("/aws/apigateway/")
            or group_name.startswith("/aws/codebuild/")
            or group_name.startswith("/aws/ecs/")
        )
        is_custom_log_group = not group_name.startswith("/aws/")
        if is_relevant_aws_service or is_custom_log_group:
            events = collect_log_events(session, group_name, region)
            app_events.extend(events)

    vpc_events = collect_vpc_flow_logs(session, region)

    return {
        "log_groups": log_groups,
        "log_events": app_events,
        "vpc_flow_events": vpc_events,
        "total_events": len(app_events) + len(vpc_events),
        "region": region,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }
