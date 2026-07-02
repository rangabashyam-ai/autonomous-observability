"""
Azure Logs Collection — Log Analytics Workspace + Azure Activity Log.

Data sources:
  - Log Analytics: App and system logs queried via Log Analytics Query API
  - Activity Log:  Azure Management API events (equivalent of AWS CloudTrail)
                   Surfaced as NormalizedAlerts for destructive/critical operations.
"""

from __future__ import annotations

import json
import logging
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

from app.integrations.normalization.alerts import NormalizedAlert

logger = logging.getLogger(__name__)

_LOOKBACK_MINUTES = 30
_MAX_LOG_EVENTS = 500
_MAX_ACTIVITY_EVENTS = 200

# Activity log operations that map to critical/warning severity
_CRITICAL_OPERATIONS = {
    "Microsoft.Compute/virtualMachines/delete",
    "Microsoft.Sql/servers/databases/delete",
    "Microsoft.ContainerService/managedClusters/delete",
    "Microsoft.KeyVault/vaults/delete",
    "Microsoft.Storage/storageAccounts/delete",
    "Microsoft.Network/virtualNetworks/delete",
    "Microsoft.Authorization/roleAssignments/delete",
}

_WARNING_OPERATIONS = {
    "Microsoft.Compute/virtualMachines/deallocate",
    "Microsoft.Compute/virtualMachines/restart",
    "Microsoft.Sql/servers/databases/pause",
    "Microsoft.Authorization/roleAssignments/write",
    "Microsoft.Network/networkSecurityGroups/securityRules/write",
    "Microsoft.Network/networkSecurityGroups/securityRules/delete",
}


def _get_token(credential) -> str:
    """Get a Bearer token for Azure Management API."""
    token = credential.get_token("https://management.azure.com/.default")
    return token.token


def _az_get(url: str, token: str, timeout: int = 15) -> dict:
    """Simple authenticated GET to Azure Management REST API."""
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


# ---------------------------------------------------------------------------
# Log Analytics
# ---------------------------------------------------------------------------

def discover_log_analytics_workspaces(credential, subscription_id: str) -> list[dict]:
    """Discover all Log Analytics workspaces in the subscription."""
    try:
        token = _get_token(credential)
        url = (
            f"https://management.azure.com/subscriptions/{subscription_id}"
            f"/providers/Microsoft.OperationalInsights/workspaces"
            f"?api-version=2022-10-01"
        )
        data = _az_get(url, token)
        workspaces = []
        for ws in data.get("value", []):
            workspaces.append({
                "id": ws.get("id", ""),
                "name": ws.get("name", ""),
                "location": ws.get("location", ""),
                "customer_id": ws.get("properties", {}).get("customerId", ""),
                "sku": ws.get("properties", {}).get("sku", {}).get("name", ""),
                "retention_days": ws.get("properties", {}).get("retentionInDays", 30),
            })
        logger.info(f"[Azure Logs] Found {len(workspaces)} Log Analytics workspaces")
        return workspaces
    except Exception as exc:
        logger.error(f"[Azure Logs] Workspace discovery failed: {exc}")
        return []


def query_log_analytics(credential, workspace_id: str, lookback_minutes: int = _LOOKBACK_MINUTES) -> list[dict]:
    """
    Query Log Analytics workspace for recent error/warning events.
    Uses the Log Analytics Query API.
    workspace_id: the customerId (GUID) of the workspace.
    """
    try:
        token = credential.get_token("https://api.loganalytics.io/.default").token
        query = (
            f"union isfuzzy=true AppExceptions, AppTraces, AzureDiagnostics "
            f"| where TimeGenerated > ago({lookback_minutes}m) "
            f"| where SeverityLevel >= 2 or Level in ('Error', 'Warning', 'Critical') "
            f"| project TimeGenerated, OperationName, Level, Message, ResourceId "
            f"| top 200 by TimeGenerated desc"
        )
        url = f"https://api.loganalytics.io/v1/workspaces/{workspace_id}/query"
        req = urllib.request.Request(
            url,
            data=json.dumps({"query": query}).encode(),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        events: list[dict] = []
        tables = data.get("tables", [])
        if not tables:
            return events

        columns = [c["name"] for c in tables[0].get("columns", [])]
        for row in tables[0].get("rows", []):
            row_dict = dict(zip(columns, row))
            events.append({
                "log_group": row_dict.get("OperationName", "log-analytics"),
                "log_stream": workspace_id,
                "message": str(row_dict.get("Message", row_dict.get("RenderedDescription", ""))),
                "timestamp": str(row_dict.get("TimeGenerated", "")),
                "source": "log_analytics",
                "provider": "azure",
                "region": "",
                "level": str(row_dict.get("Level", "")),
                "resource_id": str(row_dict.get("ResourceId", "")),
            })

        logger.info(f"[Azure Logs] Collected {len(events)} events from workspace {workspace_id}")
        return events
    except Exception as exc:
        logger.debug(f"[Azure Logs] Log Analytics query failed for workspace {workspace_id}: {exc}")
        return []


# ---------------------------------------------------------------------------
# Activity Log (Azure equivalent of CloudTrail)
# ---------------------------------------------------------------------------

def _get_severity(operation_name: str) -> str:
    op = operation_name.lower()
    for key in _CRITICAL_OPERATIONS:
        if key.lower() in op:
            return "critical"
    for key in _WARNING_OPERATIONS:
        if key.lower() in op:
            return "warning"
    return "info"


def collect_activity_log(
    credential,
    subscription_id: str,
    lookback_minutes: int = _LOOKBACK_MINUTES,
) -> list[dict]:
    """
    Collect Azure Activity Log events (write + delete operations only).
    Equivalent of AWS CloudTrail for Azure management plane events.
    """
    try:
        token = _get_token(credential)
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=lookback_minutes)
        start_str = start.strftime("%Y-%m-%dT%H:%M:%SZ")

        # Filter to write/delete (non-read) events only
        url = (
            f"https://management.azure.com/subscriptions/{subscription_id}"
            f"/providers/microsoft.insights/eventtypes/management/values"
            f"?api-version=2015-04-01"
            f"&$filter=eventTimestamp ge '{start_str}'"
            f" and status eq 'Succeeded'"
        )
        data = _az_get(url, token, timeout=20)
        events: list[dict] = []

        for ev in data.get("value", []):
            op_name = ev.get("operationName", {}).get("value", "")
            # Skip read operations (GET / list)
            if op_name.lower().endswith("/read") or op_name.lower().endswith("/list"):
                continue

            event_time = ev.get("eventTimestamp", "")
            caller = ev.get("caller", "")
            resource_id = ev.get("resourceId", "")
            severity = _get_severity(op_name)

            events.append({
                "event_id": ev.get("id", ""),
                "event_name": op_name,
                "event_source": ev.get("resourceProviderName", {}).get("value", ""),
                "username": caller,
                "source_ip": ev.get("httpRequest", {}).get("clientIpAddress", ""),
                "user_agent": ev.get("httpRequest", {}).get("userAgent", ""),
                "resources": [{"type": ev.get("resourceType", {}).get("value", ""), "name": resource_id}],
                "severity": severity,
                "provider": "azure",
                "region": ev.get("subscriptionId", subscription_id),
                "timestamp": event_time,
                "source": "activity_log",
                "description": ev.get("description", ""),
            })

            if len(events) >= _MAX_ACTIVITY_EVENTS:
                break

        logger.info(f"[Azure Activity Log] Collected {len(events)} events")
        return events
    except Exception as exc:
        logger.error(f"[Azure Activity Log] Collection failed: {exc}")
        return []


def collect_alerts_from_activity_log(
    credential,
    subscription_id: str,
    lookback_minutes: int = _LOOKBACK_MINUTES,
) -> list[NormalizedAlert]:
    """Surface high-severity Azure Activity Log events as NormalizedAlerts."""
    events = collect_activity_log(credential, subscription_id, lookback_minutes)
    alerts: list[NormalizedAlert] = []
    for ev in events:
        if ev["severity"] in ("critical", "warning"):
            resource_name = ev["resources"][0]["name"] if ev["resources"] else ev["username"] or "azure-subscription"
            alerts.append(NormalizedAlert(
                alert_id=f"activitylog-{ev.get('event_id', '')}",
                alert_type=f"ActivityLog: {ev['event_name']}",
                severity=ev["severity"],
                resource=resource_name,
                provider="azure",
                region=ev.get("region", ""),
                timestamp=ev.get("timestamp", ""),
                title=f"{ev['event_name']} by {ev['username'] or 'unknown'}",
                description=ev.get("description") or f"Azure management operation from {ev.get('source_ip', 'unknown')}",
                status="open",
                raw=ev,
            ))
    logger.info(f"[Azure Activity Log] Produced {len(alerts)} alerts")
    return alerts


# ---------------------------------------------------------------------------
# Combined collection
# ---------------------------------------------------------------------------

def collect_all_logs(credential, subscription_id: str) -> dict:
    """
    Collect all Azure log data:
      - Log Analytics workspace events (app + system logs)
      - Activity Log events (audit trail)
    Returns combined payload for storage.
    """
    workspaces = discover_log_analytics_workspaces(credential, subscription_id)
    app_events: list[dict] = []

    for ws in workspaces:
        customer_id = ws.get("customer_id", "")
        if customer_id:
            events = query_log_analytics(credential, customer_id)
            app_events.extend(events)

    activity_events = collect_activity_log(credential, subscription_id)

    return {
        "log_groups": [{"name": ws["name"], "workspace_id": ws["customer_id"]} for ws in workspaces],
        "log_events": app_events,
        "activity_events": activity_events,
        "total_events": len(app_events) + len(activity_events),
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }
