"""
AWS Alerts Collection — CloudWatch Alarms.
"""

from __future__ import annotations

import logging

from app.integrations.normalization.alerts import NormalizedAlert, normalize_aws_alarm

logger = logging.getLogger(__name__)


def collect_alerts(session, region: str = "us-east-1") -> list[NormalizedAlert]:
    """
    Collect all CloudWatch alarms (all states: ALARM, OK, INSUFFICIENT_DATA).
    Returns list of NormalizedAlert.
    """
    try:
        cw = session.client("cloudwatch", region_name=region)
        paginator = cw.get_paginator("describe_alarms")
        alerts: list[NormalizedAlert] = []
        for page in paginator.paginate(AlarmTypes=["MetricAlarm", "CompositeAlarm"]):
            for alarm in page.get("MetricAlarms", []) + page.get("CompositeAlarms", []):
                alerts.append(normalize_aws_alarm(alarm, region=region))
        logger.info(f"[AWS] Collected {len(alerts)} CloudWatch alarms from {region}")
        return alerts
    except Exception as exc:
        logger.error(f"[AWS] Alert collection failed in {region}: {exc}")
        return []
