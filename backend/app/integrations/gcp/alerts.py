"""
GCP Alerts Collection — Cloud Monitoring incidents.
"""

from __future__ import annotations

import logging
import json
import urllib.request

from app.integrations.normalization.alerts import NormalizedAlert, normalize_gcp_alert

logger = logging.getLogger(__name__)


def collect_alerts(credentials, project_id: str) -> list[NormalizedAlert]:
    """
    Collect active incidents from GCP Cloud Monitoring via REST API.
    Returns list of NormalizedAlert.
    """
    alerts: list[NormalizedAlert] = []
    try:
        import google.auth.transport.requests
        request = google.auth.transport.requests.Request()
        credentials.refresh(request)
        access_token = credentials.token

        url = (
            f"https://monitoring.googleapis.com/v3/projects/{project_id}/alertPolicies"
        )
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            # Alert policies are definitions; we list them and check enabled/firing
            for policy in data.get("alertPolicies", []):
                if not policy.get("enabled", True):
                    continue
                # Map alert policy to a monitoring alert (best-effort without incident API)
                incident = {
                    "name": policy.get("name", ""),
                    "conditionName": policy.get("displayName", "GCP Alert"),
                    "summary": policy.get("documentation", {}).get("content", policy.get("displayName", "")),
                    "state": "open",
                    "severity": "WARNING",
                    "startedAt": policy.get("creationRecord", {}).get("mutateTime", ""),
                    "resource": {},
                }
                alerts.append(normalize_gcp_alert(incident))

        logger.info(f"[GCP] Collected {len(alerts)} alert policies from project '{project_id}'")
    except Exception as exc:
        logger.error(f"[GCP] Alert collection failed: {exc}")
    return alerts
