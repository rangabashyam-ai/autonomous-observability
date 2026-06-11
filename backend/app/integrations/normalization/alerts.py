"""
Normalization models and helpers for cloud alerts.

All providers (AWS, Azure, GCP, Kubernetes) must convert their native
alert/alarm objects to NormalizedAlert before writing to the data store.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


class NormalizedAlert(BaseModel):
    alert_id: str
    alert_type: str
    severity: str               # "critical" | "warning" | "info"
    resource: str               # resource id / name
    provider: str               # "aws" | "azure" | "gcp" | "kubernetes"
    region: str
    timestamp: str              # ISO-8601
    title: str = ""
    description: str = ""
    status: str = "open"        # "open" | "acknowledged" | "resolved"
    raw: dict = Field(default_factory=dict)  # original provider payload

    # Fields expected by existing /api/monitoring/alerts consumers
    @property
    def entity_id(self) -> str:
        return self.resource

    def to_monitoring_dict(self) -> dict:
        """Return a dict compatible with the existing monitoring/alerts.json schema."""
        return {
            "id": self.alert_id,
            "title": self.title or f"{self.alert_type} on {self.resource}",
            "severity": self.severity,
            "status": self.status,
            "entity_id": self.resource,
            "triggered_at": self.timestamp,
            "provider": self.provider,
            "region": self.region,
            "alert_type": self.alert_type,
            "description": self.description,
            # Legacy fields kept for UI compatibility
            "source": self.provider,
        }


# Severity mapping helpers

_AWS_STATE_MAP = {
    "ALARM": "critical",
    "INSUFFICIENT_DATA": "warning",
    "OK": "info",
}

_AZURE_SEVERITY_MAP = {
    0: "critical",
    1: "critical",
    2: "warning",
    3: "info",
    4: "info",
}

_GCP_SEVERITY_MAP = {
    "CRITICAL": "critical",
    "ERROR": "critical",
    "WARNING": "warning",
    "NOTICE": "info",
    "INFO": "info",
    "DEBUG": "info",
}


def normalize_aws_alarm(alarm: dict, region: str = "us-east-1") -> NormalizedAlert:
    """Convert a CloudWatch Alarm dict to NormalizedAlert."""
    state = alarm.get("StateValue", "INSUFFICIENT_DATA")
    return NormalizedAlert(
        alert_id=f"aws-{alarm.get('AlarmArn', alarm.get('AlarmName', 'unknown'))}",
        alert_type=alarm.get("AlarmName", "CloudWatch Alarm"),
        severity=_AWS_STATE_MAP.get(state, "warning"),
        resource=alarm.get("Dimensions", [{}])[0].get("Value", alarm.get("AlarmName", "unknown")) if alarm.get("Dimensions") else alarm.get("AlarmName", "unknown"),
        provider="aws",
        region=region,
        timestamp=alarm.get("StateUpdatedTimestamp", datetime.now(timezone.utc).isoformat()),
        title=alarm.get("AlarmName", ""),
        description=alarm.get("AlarmDescription", ""),
        status="open" if state == "ALARM" else ("resolved" if state == "OK" else "acknowledged"),
        raw=alarm,
    )


def normalize_azure_alert(alert: dict, region: str = "global") -> NormalizedAlert:
    """Convert an Azure Monitor fired alert to NormalizedAlert."""
    props = alert.get("properties", {})
    severity_num = props.get("severity", 2)
    if isinstance(severity_num, str):
        try:
            severity_num = int(severity_num.replace("Sev", ""))
        except ValueError:
            severity_num = 2
    return NormalizedAlert(
        alert_id=f"azure-{alert.get('id', alert.get('name', 'unknown'))}",
        alert_type=props.get("alertRule", "Azure Monitor Alert"),
        severity=_AZURE_SEVERITY_MAP.get(severity_num, "warning"),
        resource=props.get("targetResourceName", props.get("essentials", {}).get("targetResourceName", "unknown")),
        provider="azure",
        region=region,
        timestamp=props.get("startDateTime", props.get("essentials", {}).get("startDateTime", datetime.now(timezone.utc).isoformat())),
        title=props.get("alertRule", alert.get("name", "")),
        description=props.get("description", ""),
        status="open" if props.get("monitorCondition", "Fired") == "Fired" else "resolved",
        raw=alert,
    )


def normalize_gcp_alert(incident: dict, region: str = "global") -> NormalizedAlert:
    """Convert a GCP Monitoring incident to NormalizedAlert."""
    severity_raw = incident.get("severity", "WARNING")
    return NormalizedAlert(
        alert_id=f"gcp-{incident.get('name', incident.get('incidentId', 'unknown'))}",
        alert_type=incident.get("conditionName", "GCP Monitoring Alert"),
        severity=_GCP_SEVERITY_MAP.get(severity_raw.upper(), "warning"),
        resource=incident.get("resourceName", incident.get("resource", {}).get("labels", {}).get("instance_id", "unknown")),
        provider="gcp",
        region=region,
        timestamp=incident.get("startedAt", datetime.now(timezone.utc).isoformat()),
        title=incident.get("summary", incident.get("conditionName", "")),
        description=incident.get("documentation", {}).get("content", ""),
        status="open" if incident.get("state", "open") == "open" else "resolved",
        raw=incident,
    )


def normalize_k8s_event(event: dict) -> NormalizedAlert:
    """Convert a Kubernetes Event object to NormalizedAlert."""
    obj_ref = event.get("involvedObject", {})
    reason = event.get("reason", "Unknown")
    event_type = event.get("type", "Normal")
    severity = "critical" if event_type == "Warning" and reason in ("OOMKilling", "CrashLoopBackOff", "Failed") else \
               "warning" if event_type == "Warning" else "info"
    return NormalizedAlert(
        alert_id=f"k8s-{event.get('metadata', {}).get('uid', 'unknown')}",
        alert_type=reason,
        severity=severity,
        resource=f"{obj_ref.get('namespace', 'default')}/{obj_ref.get('name', 'unknown')}",
        provider="kubernetes",
        region=obj_ref.get("namespace", "default"),
        timestamp=event.get("lastTimestamp") or event.get("eventTime") or datetime.now(timezone.utc).isoformat(),
        title=f"{reason}: {obj_ref.get('name', '')}",
        description=event.get("message", ""),
        status="open" if event_type == "Warning" else "info",
        raw=event,
    )
