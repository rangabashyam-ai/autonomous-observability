"""
AWS CloudTrail — Audit event and API call collection.
Collects recent management events from CloudTrail lookup_events API.
High-severity events (e.g., DeleteBucket, StopInstances) are also
surfaced as NormalizedAlerts.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.integrations.normalization.alerts import NormalizedAlert

logger = logging.getLogger(__name__)

_LOOKBACK_MINUTES = 60  # CloudTrail lookback window per sync
_MAX_EVENTS = 200

# API calls that indicate high-impact changes → converted to alerts
_HIGH_SEVERITY_EVENTS = {
    "DeleteBucket", "DeleteDBInstance", "TerminateInstances", "StopInstances",
    "DeleteStack", "DeleteCluster", "DeleteSecret", "DeleteKey",
    "DetachRolePolicy", "DeleteRolePolicy", "UpdateAssumeRolePolicy",
    "DeleteTrail", "StopLogging", "DisableAlarmActions",
    "AuthorizeSecurityGroupIngress", "RevokeSecurityGroupIngress",
    "CreateNetworkAclEntry", "DeleteNetworkAclEntry",
}

_WARNING_EVENTS = {
    "RebootInstances", "ModifyDBInstance", "UpdateStack",
    "PutBucketPolicy", "PutBucketAcl", "PutRolePolicy",
    "CreateUser", "CreateAccessKey", "DeleteUser", "DeleteAccessKey",
}


def _get_severity(event_name: str) -> str:
    if event_name in _HIGH_SEVERITY_EVENTS:
        return "critical"
    if event_name in _WARNING_EVENTS:
        return "warning"
    return "info"


def collect_audit_events(
    session,
    region: str = "us-east-1",
    lookback_minutes: int = _LOOKBACK_MINUTES,
) -> list[dict]:
    """
    Collect recent CloudTrail management API events.
    Returns a list of normalized audit event dicts.
    """
    try:
        ct = session.client("cloudtrail", region_name=region)
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=lookback_minutes)

        paginator = ct.get_paginator("lookup_events")
        events: list[dict] = []

        for page in paginator.paginate(
            StartTime=start,
            EndTime=end,
            LookupAttributes=[{"AttributeKey": "ReadOnly", "AttributeValue": "false"}],  # write events only
        ):
            for ev in page.get("Events", []):
                resources = [
                    {"type": r.get("ResourceType", ""), "name": r.get("ResourceName", "")}
                    for r in ev.get("Resources", [])
                ]
                event_name = ev.get("EventName", "unknown")
                event_time = ev.get("EventTime", datetime.now(timezone.utc))

                audit_event = {
                    "event_id": ev.get("EventId", ""),
                    "event_name": event_name,
                    "event_source": ev.get("EventSource", ""),
                    "username": ev.get("Username", ""),
                    "source_ip": ev.get("SourceIPAddress", ""),
                    "user_agent": ev.get("UserAgent", ""),
                    "resources": resources,
                    "severity": _get_severity(event_name),
                    "provider": "aws",
                    "region": region,
                    "timestamp": event_time.isoformat() if hasattr(event_time, "isoformat") else str(event_time),
                    "source": "cloudtrail",
                }
                events.append(audit_event)

                if len(events) >= _MAX_EVENTS:
                    break
            if len(events) >= _MAX_EVENTS:
                break

        logger.info(f"[CloudTrail] Collected {len(events)} audit events from {region}")
        return events
    except Exception as exc:
        logger.error(f"[CloudTrail] Event collection failed in {region}: {exc}")
        return []


def collect_alerts_from_trail(
    session,
    region: str = "us-east-1",
    lookback_minutes: int = _LOOKBACK_MINUTES,
) -> list[NormalizedAlert]:
    """
    Return high-impact CloudTrail events as NormalizedAlerts.
    """
    events = collect_audit_events(session, region, lookback_minutes)
    alerts: list[NormalizedAlert] = []

    for ev in events:
        if ev["severity"] in ("critical", "warning"):
            resource = ev["resources"][0]["name"] if ev["resources"] else ev["username"] or "aws-account"
            alerts.append(NormalizedAlert(
                alert_id=f"cloudtrail-{ev['event_id']}",
                alert_type=f"CloudTrail: {ev['event_name']}",
                severity=ev["severity"],
                resource=resource,
                provider="aws",
                region=region,
                timestamp=ev["timestamp"],
                title=f"{ev['event_name']} by {ev['username'] or 'unknown'}",
                description=f"API call from {ev['source_ip']} via {ev['event_source']}",
                status="open",
                raw=ev,
            ))

    logger.info(f"[CloudTrail] Produced {len(alerts)} alerts from audit events in {region}")
    return alerts
