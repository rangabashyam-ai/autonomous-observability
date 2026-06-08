"""Context-aware copilot chat service."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

from app.services.agent_router import get_agent
from app.services.openrouter_client import chat_with_fallback, select_model


def _parse_structured_response(raw: str) -> dict[str, Any]:
    """Extract structured JSON from LLM response."""
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return {
                "summary": parsed.get("summary", ""),
                "findings": parsed.get("findings", []) or [],
                "evidence": parsed.get("evidence", []) or [],
                "recommended_actions": parsed.get("recommended_actions", []) or [],
                "confidence": parsed.get("confidence", ""),
            }
    except json.JSONDecodeError:
        pass

    return {
        "summary": raw[:500],
        "findings": [],
        "evidence": [],
        "recommended_actions": [],
        "confidence": "",
    }


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value:
        return [value]
    return []


def _unique_strings(values: list[Any], limit: int = 5) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if isinstance(value, dict):
            text = value.get("title") or value.get("summary") or value.get("id") or str(value)
        else:
            text = str(value)
        if text and text not in seen:
            seen.add(text)
            result.append(text)
        if len(result) >= limit:
            break
    return result


def _first_detection_from_context(context: dict[str, Any], entity_data: dict[str, Any]) -> dict[str, Any]:
    if isinstance(entity_data.get("threat"), dict):
        return entity_data["threat"]
    if isinstance(entity_data.get("detection"), dict):
        return entity_data["detection"]

    selected = context.get("selected_entity")
    detections = context.get("analysis_results", {}).get("detections", [])
    if isinstance(detections, list):
        for detection in detections:
            if not isinstance(detection, dict):
                continue
            if detection.get("pattern_id") == selected or detection.get("expected_impacted_service_id") == selected:
                return detection
        if detections and isinstance(detections[0], dict):
            return detections[0]
    return {}


def _mock_prediction_response(context: dict[str, Any], question: str) -> dict[str, Any]:
    entity_data = context.get("entity_data", {})
    detection = _first_detection_from_context(context, entity_data)
    q = question.lower()

    service = (
        entity_data.get("prediction")
        or entity_data.get("service")
        or detection.get("expected_impacted_service")
        or detection.get("service_name")
        or context.get("selected_entity", "this service")
    )
    confidence = entity_data.get("confidence", detection.get("confidence", "N/A"))
    eta = (
        entity_data.get("estimated_time_to_outage")
        or entity_data.get("eta_minutes")
        or detection.get("estimated_time_to_incident_minutes")
        or "N/A"
    )
    if isinstance(eta, int | float):
        eta = f"{eta} minutes"

    actions = _unique_strings(
        _as_list(entity_data.get("recommended_actions"))
        + _as_list(detection.get("recommended_actions"))
        + _as_list(context.get("analysis_results", {}).get("clearance_plan", {}).get("priority_actions")),
        limit=5,
    )
    if not actions:
        actions = ["Scale affected resources", "Review correlated alerts", "Prepare incident response"]

    matched_alerts = (
        _as_list(entity_data.get("matched_alerts_details"))
        + _as_list(detection.get("matched_alerts_details"))
        + _as_list(entity_data.get("evidence"))
        + _as_list(detection.get("matched_alerts"))
        + _as_list(context.get("related_alerts"))
    )
    evidence = _unique_strings(matched_alerts, limit=5)
    coverage = detection.get("match_coverage") or entity_data.get("match_coverage") or {}
    coverage_text = ""
    if isinstance(coverage, dict) and coverage.get("matched") is not None:
        coverage_text = f"Pattern coverage: {coverage.get('matched')}/{coverage.get('total')} alerts"

    findings = [
        f"Confidence: {confidence}%",
        f"ETA to incident: {eta}",
    ]
    if detection.get("risk_level") or entity_data.get("risk_level"):
        findings.append(f"Risk level: {entity_data.get('risk_level', detection.get('risk_level'))}")
    if detection.get("progression_stage") or entity_data.get("progression_stage"):
        findings.append(f"Progression stage: {entity_data.get('progression_stage', detection.get('progression_stage'))}")
    if coverage_text:
        findings.append(coverage_text)

    if any(word in q for word in ["why", "elevated", "risk", "cause", "reason"]):
        summary = (
            f"{service} is at elevated risk because the active signals match a known precursor pattern "
            f"with {confidence}% confidence and an ETA of {eta}."
        )
        return {
            "summary": summary,
            "findings": findings,
            "evidence": evidence,
            "recommended_actions": actions[:3],
            "confidence": f"{confidence}%",
        }

    if any(word in q for word in ["playbook", "run", "remediate", "action", "fix", "intervene"]):
        return {
            "summary": f"Run the immediate mitigation playbook for {service}; focus on the actions that reduce load and clear the matched signals before ETA {eta}.",
            "findings": findings,
            "evidence": evidence,
            "recommended_actions": actions,
            "confidence": f"{confidence}%",
        }

    if any(word in q for word in ["defer", "safely", "wait", "ignore", "pause"]):
        can_defer = not (
            str(entity_data.get("risk_level", detection.get("risk_level", ""))).lower() in {"critical", "high"}
            or str(entity_data.get("progression_stage", detection.get("progression_stage", ""))).lower() == "imminent"
        )
        summary = (
            f"Do not defer the primary signals for {service}; confidence is {confidence}% and ETA is {eta}."
            if not can_defer
            else f"You can defer only low-severity secondary signals for {service}; keep monitoring the matched precursor alerts."
        )
        return {
            "summary": summary,
            "findings": findings,
            "evidence": evidence,
            "recommended_actions": actions[:3],
            "confidence": f"{confidence}%",
        }

    if any(word in q for word in ["first", "prioritize", "priority", "highest"]):
        return {
            "summary": f"Prioritize {service} first because it has the strongest matched pattern, {confidence}% confidence, and ETA {eta}.",
            "findings": findings,
            "evidence": evidence,
            "recommended_actions": actions[:4],
            "confidence": f"{confidence}%",
        }

    return {
        "summary": f"Early detection view for {service}: {confidence}% confidence with ETA {eta}. Ask about why, playbook, deferral, or priority for a focused answer.",
        "findings": findings,
        "evidence": evidence,
        "recommended_actions": actions[:3],
        "confidence": f"{confidence}%",
    }


def _mock_response(context: dict[str, Any], question: str) -> dict[str, Any]:
    """Rule-based fallback when OpenRouter is unavailable."""
    page_type = context.get("page_type", "")
    entity = context.get("selected_entity", "current context")
    q = question.lower()
    entity_data = context.get("entity_data", {})
    analysis = context.get("analysis_results", {})
    investigation = context.get("investigation_results", {})

    if any(other in q for other in ["auth-service", "merchant-service", "settlement"]):
        if entity and not any(s in entity.lower() for s in q.split()):
            return {
                "summary": f"Current AI context is restricted to {entity}. Please open that entity to investigate it.",
                "findings": [],
                "evidence": [],
                "recommended_actions": [f"Navigate to {q.split()[-1]} detail page"],
                "confidence": "100%",
            }

    if page_type == "service":
        status = entity_data.get("status", entity_data.get("health", "unknown"))
        sla = entity_data.get("sla", entity_data.get("availability", "N/A"))
        alerts = context.get("related_alerts", [])
        return {
            "summary": f"{entity} is currently {status} with SLA at {sla}%.",
            "findings": [
                f"Service health: {status}",
                f"Active alerts: {len(alerts)}",
            ],
            "evidence": [a.get("title", str(a)) if isinstance(a, dict) else str(a) for a in alerts[:3]],
            "recommended_actions": [
                "Review connection pool metrics",
                "Check recent deployments",
                "Run RCA analysis for correlated alerts",
            ],
            "confidence": "78%",
        }

    if page_type == "incident":
        return {
            "summary": f"Incident {entity}: {entity_data.get('title', 'No title in context')}.",
            "findings": [
                f"Severity: {entity_data.get('severity', 'N/A')}",
                f"Status: {entity_data.get('status', 'N/A')}",
                f"Root cause: {entity_data.get('root_cause', 'N/A')}",
            ],
            "evidence": entity_data.get("alerts", [])[:5],
            "recommended_actions": [entity_data.get("fix", "Review remediation playbook")],
            "confidence": entity_data.get("confidence", "85%"),
        }

    if page_type == "rca":
        candidates = analysis.get("ranked_root_causes", analysis.get("root_cause_candidates", []))
        top = candidates[0] if candidates else {}
        return {
            "summary": f"RCA analysis for {entity} identified {top.get('root_cause', 'unknown')} as top candidate.",
            "findings": [
                f"Top root cause: {top.get('root_cause', 'N/A')}",
                f"Confidence: {top.get('confidence', 'N/A')}%",
            ],
            "evidence": [e.get("title", str(e)) if isinstance(e, dict) else str(e) for e in (top.get("evidence", []) or [])[:3]],
            "recommended_actions": top.get("suggested_fixes", ["Investigate primary candidate"]),
            "confidence": f"{top.get('confidence', 75)}%",
        }

    if page_type == "blast":
        return {
            "summary": f"Blast radius simulation from {entity_data.get('failure_source', entity)}.",
            "findings": [
                f"Affected nodes: {len(entity_data.get('affected_nodes', []))}",
                f"Revenue impact: {entity_data.get('revenue_impact', 'N/A')}",
                f"Scope: {entity_data.get('issue_scope', 'N/A')}",
            ],
            "evidence": entity_data.get("critical_paths", [])[:3],
            "recommended_actions": [
                "Isolate failure source",
                "Route traffic around impacted services",
                "Notify downstream service owners",
            ],
            "confidence": "82%",
        }

    if page_type == "prediction":
        return _mock_prediction_response(context, question)

    if page_type == "workflow":
        return {
            "summary": f"Investigation workflow {entity} at step: {investigation.get('workflow_state', 'N/A')}.",
            "findings": [
                f"Completed steps: {len(investigation.get('completed_steps', []))}",
                f"Pending steps: {len(investigation.get('pending_steps', []))}",
                f"Approval required: {investigation.get('approval_required', False)}",
            ],
            "evidence": investigation.get("completed_steps", [])[:3],
            "recommended_actions": [investigation.get("recommended_action", "Review pending approval")],
            "confidence": "90%",
        }

    if page_type == "executive":
        return {
            "summary": "Platform health summary from executive command center data.",
            "findings": [
                f"SLA: {entity_data.get('sla', 'N/A')}",
                f"Revenue risk: {entity_data.get('revenue_risk', 'N/A')}",
                f"Major incidents: {len(context.get('related_incidents', []))}",
            ],
            "evidence": [a.get("title", str(a)) if isinstance(a, dict) else str(a) for a in context.get("related_alerts", [])[:3]],
            "recommended_actions": ["Review at-risk services", "Prioritize P1 incidents", "Monitor early warnings"],
            "confidence": "88%",
        }

    return {
        "summary": "That information is not present in the current investigation context.",
        "findings": [],
        "evidence": [],
        "recommended_actions": [],
        "confidence": "",
    }


def copilot_chat(context: dict[str, Any], messages: list[dict[str, str]]) -> dict[str, Any]:
    """Process a copilot chat request with context guardrails."""
    page_type = context.get("page_type", "executive")
    agent = get_agent(page_type)
    system_prompt = agent.get_system_prompt(context)

    llm_messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        role = msg.get("role", "user")
        if role in ("user", "assistant"):
            llm_messages.append({"role": role, "content": msg.get("content", "")})

    user_question = context.get("user_question", "")
    if user_question and (not messages or messages[-1].get("content") != user_question):
        llm_messages.append({"role": "user", "content": user_question})

    model = select_model(page_type, len(messages))
    timestamp = datetime.now(timezone.utc).isoformat()

    if os.environ.get("OPENROUTER_API_KEY"):
        try:
            raw, model_used = chat_with_fallback(llm_messages, model)
            result = _parse_structured_response(raw)
            result["model"] = model_used
            result["timestamp"] = timestamp
            result["agent"] = agent.page_type
            return result
        except Exception as exc:
            logger.warning("OpenRouter call failed, using mock fallback: %s", exc)

    result = _mock_response(context, user_question or (messages[-1].get("content", "") if messages else ""))
    result["model"] = "mock-fallback"
    result["fallback_reason"] = "OpenRouter unavailable or insufficient credits"
    result["timestamp"] = timestamp
    result["agent"] = agent.page_type
    return result
