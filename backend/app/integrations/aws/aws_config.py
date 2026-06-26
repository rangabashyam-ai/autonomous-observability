"""
AWS Config — Config rule discovery and compliance status collection.
Non-compliant resources are surfaced as NormalizedAlerts.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.integrations.normalization.alerts import NormalizedAlert

logger = logging.getLogger(__name__)

_MAX_RULES = 100


def collect_config_rules(session, region: str = "us-east-1") -> list[dict]:
    """
    Discover all AWS Config rules and their compliance status.
    Returns list of rule dicts with compliance info.
    """
    try:
        cfg = session.client("config", region_name=region)
        paginator = cfg.get_paginator("describe_config_rules")
        rules: list[dict] = []

        for page in paginator.paginate():
            for rule in page.get("ConfigRules", []):
                rule_name = rule.get("ConfigRuleName", "")
                rule_arn = rule.get("ConfigRuleArn", "")
                source = rule.get("Source", {})
                rules.append({
                    "rule_name": rule_name,
                    "rule_arn": rule_arn,
                    "source_owner": source.get("Owner", ""),
                    "source_identifier": source.get("SourceIdentifier", ""),
                    "description": rule.get("Description", ""),
                    "state": rule.get("ConfigRuleState", "ACTIVE"),
                    "provider": "aws",
                    "region": region,
                })
                if len(rules) >= _MAX_RULES:
                    break
            if len(rules) >= _MAX_RULES:
                break

        logger.info(f"[AWSConfig] Found {len(rules)} config rules in {region}")
        return rules
    except Exception as exc:
        logger.error(f"[AWSConfig] Config rule discovery failed in {region}: {exc}")
        return []


def collect_compliance_details(session, rule_name: str, region: str = "us-east-1") -> list[dict]:
    """
    Get compliance evaluation results for a specific Config rule.
    Returns list of non-compliant resource evaluations.
    """
    try:
        cfg = session.client("config", region_name=region)
        paginator = cfg.get_paginator("get_compliance_details_by_config_rule")
        non_compliant: list[dict] = []

        for page in paginator.paginate(
            ConfigRuleName=rule_name,
            ComplianceTypes=["NON_COMPLIANT"],
        ):
            for result in page.get("EvaluationResults", []):
                qual_id = result.get("EvaluationResultIdentifier", {})
                resource_key = qual_id.get("EvaluationResultQualifier", {})
                annotation = result.get("Annotation", "")
                result_recorded = result.get("ResultRecordedTime", datetime.now(timezone.utc))

                non_compliant.append({
                    "rule_name": rule_name,
                    "resource_type": resource_key.get("ResourceType", ""),
                    "resource_id": resource_key.get("ResourceId", ""),
                    "compliance_type": "NON_COMPLIANT",
                    "annotation": annotation,
                    "recorded_at": result_recorded.isoformat() if hasattr(result_recorded, "isoformat") else str(result_recorded),
                    "provider": "aws",
                    "region": region,
                })
        return non_compliant
    except Exception as exc:
        logger.debug(f"[AWSConfig] Compliance details failed for {rule_name}: {exc}")
        return []


def collect_all_compliance(session, region: str = "us-east-1") -> dict:
    """
    Collect all Config rules and their compliance status.
    Returns combined payload for storage.
    """
    rules = collect_config_rules(session, region)
    all_non_compliant: list[dict] = []

    # Fetch overall compliance summary
    try:
        cfg = session.client("config", region_name=region)
        compliance_resp = cfg.describe_compliance_by_config_rule(
            ComplianceTypes=["NON_COMPLIANT"]
        )
        non_compliant_rules = [
            r.get("ConfigRuleName", "") for r in compliance_resp.get("ComplianceByConfigRules", [])
        ]
    except Exception as exc:
        logger.warning(f"[AWSConfig] Compliance summary failed: {exc}")
        non_compliant_rules = []

    for rule_name in non_compliant_rules:
        details = collect_compliance_details(session, rule_name, region)
        all_non_compliant.extend(details)

    # Annotate rules with compliance status
    non_compliant_set = set(non_compliant_rules)
    for rule in rules:
        rule["is_compliant"] = rule["rule_name"] not in non_compliant_set

    logger.info(f"[AWSConfig] {len(non_compliant_rules)} non-compliant rules, {len(all_non_compliant)} non-compliant resources in {region}")
    return {
        "rules": rules,
        "non_compliant_resources": all_non_compliant,
        "total_rules": len(rules),
        "non_compliant_rule_count": len(non_compliant_rules),
        "region": region,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


def collect_compliance_alerts(session, region: str = "us-east-1") -> list[NormalizedAlert]:
    """
    Return AWS Config non-compliant rules/resources as NormalizedAlerts.
    """
    compliance = collect_all_compliance(session, region)
    alerts: list[NormalizedAlert] = []

    for res in compliance.get("non_compliant_resources", []):
        alerts.append(NormalizedAlert(
            alert_id=f"config-{res['rule_name']}-{res['resource_id']}",
            alert_type=f"Config: {res['rule_name']}",
            severity="warning",
            resource=res["resource_id"] or res["resource_type"],
            provider="aws",
            region=region,
            timestamp=res.get("recorded_at", datetime.now(timezone.utc).isoformat()),
            title=f"Non-compliant: {res['resource_id']} ({res['rule_name']})",
            description=res.get("annotation", f"Resource {res['resource_id']} violates Config rule {res['rule_name']}"),
            status="open",
            raw=res,
        ))

    return alerts
