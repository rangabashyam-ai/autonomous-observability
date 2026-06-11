"""
Azure Alerts Collection — Azure Monitor fired alerts.
"""

from __future__ import annotations

import logging

from app.integrations.normalization.alerts import NormalizedAlert, normalize_azure_alert

logger = logging.getLogger(__name__)


def collect_alerts(credential, subscription_id: str) -> list[NormalizedAlert]:
    """
    Collect fired alerts from Azure Monitor Alert Management API.
    Returns list of NormalizedAlert.
    """
    alerts: list[NormalizedAlert] = []
    try:
        import urllib.request
        import json

        # Get access token
        token = credential.get_token("https://management.azure.com/.default")
        access_token = token.token

        url = (
            f"https://management.azure.com/subscriptions/{subscription_id}"
            f"/providers/Microsoft.AlertsManagement/alerts"
            f"?api-version=2019-03-01&alertState=New&timeRange=1h"
        )
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            for item in data.get("value", []):
                alerts.append(normalize_azure_alert(item))

        logger.info(f"[Azure] Collected {len(alerts)} fired alerts")
    except Exception as exc:
        logger.error(f"[Azure] Alert collection failed: {exc}")
    return alerts
