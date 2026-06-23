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
from app.services.groq_client import chat_with_fallback, select_model
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from the project's root .env file.
# This ensures GROQ_API_KEY and related settings are available regardless of
# the current working directory when the server starts.
project_root = Path(__file__).resolve().parents[2]
env_path = project_root / ".env"
load_dotenv(dotenv_path=env_path, override=True)

_MAX_RELATED_ALERTS = 20
_MAX_DETECTIONS = 8
_MAX_MATCHED_ALERTS_PER_DETECTION = 5
_MAX_CHAT_MESSAGES = 12
_ALERT_KEYS = ("id", "title", "severity", "service", "service_id", "status", "entity", "count")
_DETECTION_KEYS = (
    "pattern_id",
    "expected_impacted_service",
    "expected_impacted_service_id",
    "confidence",
    "estimated_time_to_incident_minutes",
    "risk_level",
    "progression_stage",
    "match_coverage",
    "matched_alerts",
    "recommended_actions",
)


def _trim_alert_item(item: Any) -> Any:
    if isinstance(item, str):
        return item[:200]
    if not isinstance(item, dict):
        return str(item)
    trimmed = {k: item[k] for k in _ALERT_KEYS if k in item}
    if "matched_alerts_details" in item and isinstance(item["matched_alerts_details"], list):
        trimmed["matched_alerts_details"] = [
            _trim_alert_item(a) for a in item["matched_alerts_details"][:_MAX_MATCHED_ALERTS_PER_DETECTION]
        ]
    return trimmed


def _trim_detection_item(item: Any) -> Any:
    if not isinstance(item, dict):
        return item
    trimmed = {k: item[k] for k in _DETECTION_KEYS if k in item}
    if "matched_alerts_details" in item and isinstance(item["matched_alerts_details"], list):
        trimmed["matched_alerts_details"] = [
            _trim_alert_item(a) for a in item["matched_alerts_details"][:_MAX_MATCHED_ALERTS_PER_DETECTION]
        ]
    if "matched_alerts" in item and isinstance(item["matched_alerts"], list):
        trimmed["matched_alerts"] = item["matched_alerts"][:_MAX_MATCHED_ALERTS_PER_DETECTION]
    return trimmed


def _trim_copilot_context(context: dict[str, Any]) -> dict[str, Any]:
    """Shrink large payloads so GROQ requests stay within limits."""
    trimmed = dict(context)
    entity_data = dict(trimmed.get("entity_data") or {})

    alerts = trimmed.get("related_alerts", [])
    if isinstance(alerts, list):
        if len(alerts) > _MAX_RELATED_ALERTS:
            entity_data["related_alerts_truncated"] = True
            entity_data["related_alerts_total"] = len(alerts)
        trimmed["related_alerts"] = [
            _trim_alert_item(a) for a in alerts[:_MAX_RELATED_ALERTS]
        ]

    incidents = trimmed.get("related_incidents", [])
    if isinstance(incidents, list) and len(incidents) > _MAX_RELATED_ALERTS:
        trimmed["related_incidents"] = incidents[:_MAX_RELATED_ALERTS]

    analysis = trimmed.get("analysis_results", {})
    if isinstance(analysis, dict):
        new_analysis = dict(analysis)
        detections = new_analysis.get("detections", [])
        if isinstance(detections, list):
            if len(detections) > _MAX_DETECTIONS:
                new_analysis["detections_truncated"] = True
                new_analysis["detections_total"] = len(detections)
            new_analysis["detections"] = [
                _trim_detection_item(d) for d in detections[:_MAX_DETECTIONS]
            ]
        trimmed["analysis_results"] = new_analysis

    if entity_data:
        trimmed["entity_data"] = entity_data
    return trimmed


def _trim_chat_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    if len(messages) <= _MAX_CHAT_MESSAGES:
        return messages
    return messages[-_MAX_CHAT_MESSAGES:]


def _regex_lenient_parse(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "summary": "",
        "findings": [],
        "evidence": [],
        "recommended_actions": [],
        "confidence": "",
    }
    
    summary_match = re.search(r'"summary"\s*:\s*"([\s\S]*?)"\s*(?:,|\n\s*"|\})', text)
    if summary_match:
        result["summary"] = summary_match.group(1).replace('\\"', '"').replace('\\n', '\n')
    else:
        summary_match = re.search(r'"summary"\s*:\s*([\s\S]*?)(?:,|\n\s*"|\n\s*\})', text)
        if summary_match:
            result["summary"] = summary_match.group(1).strip('"\' ')

    for key in ["findings", "evidence", "recommended_actions"]:
        match = re.search(rf'"{key}"\s*:\s*\[([\s\S]*?)\]', text)
        if match:
            items_raw = match.group(1)
            items = re.findall(r'"([\s\S]*?)"', items_raw)
            if not items and ":" in items_raw:
                parts = items_raw.split(",")
                for p in parts:
                    if ":" in p:
                        k_val = p.split(":", 1)[0].strip().strip('"\'')
                        if k_val:
                            items.append(k_val)
                    else:
                        val = p.strip().strip('"\'')
                        if val:
                            items.append(val)
            result[key] = items

    conf_match = re.search(r'"confidence"\s*:\s*"([^"]*)"', text)
    if conf_match:
        result["confidence"] = conf_match.group(1)
        
    return result


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

    # Try a lenient parse if the model returned a JSON-like string with extra text.
    brace_start = text.find("{")
    brace_end = text.rfind("}")
    if brace_start != -1 and brace_end > brace_start:
        candidate = text[brace_start:brace_end + 1]
        try:
            parsed = json.loads(candidate)
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

    # Regex-based lenient parse as a last resort
    try:
        parsed = _regex_lenient_parse(text)
        if parsed.get("summary"):
            return parsed
    except Exception:
        pass

    # If it is totally invalid but contains some text, don't return raw JSON if possible
    # Just return the text clean
    clean_text = raw
    if brace_start != -1 and brace_end > brace_start:
        summary_match = re.search(r'"summary"\s*:\s*"([\s\S]*?)"', text)
        if summary_match:
            clean_text = summary_match.group(1).replace('\\"', '"').replace('\\n', '\n')

    return {
        "summary": clean_text[:800],
        "findings": [],
        "evidence": [],
        "recommended_actions": [],
        "confidence": "",
    }



def _mock_response(context: dict[str, Any], question: str) -> dict[str, Any]:
    """Rule-based fallback when GROQ is unavailable."""
    page_type = context.get("page_type", "")
    entity = context.get("selected_entity", "current context")
    q = question.lower().strip()
    entity_data = context.get("entity_data", {})
    analysis = context.get("analysis_results", {})
    investigation = context.get("investigation_results", {})

    # Guardrail check for stupid / unrelated questions in mock fallback
    op_keywords = [
        "cpu", "mem", "latency", "error", "alert", "incident", "status", "health", "metrics",
        "pod", "node", "container", "api", "jvm", "database", "queue", "rps", "throughput",
        "rca", "blast", "remediate", "help", "happen", "diagnose", "root cause", "failure",
        "why", "how", "what", "detail", "usage", "performance", "avail", "warn", "critical",
        "effect", "impact", "cause", "solve", "fix", "resolution", "remedy", "issue", "trouble", "problem",
        "threat", "priority", "prioritize", "urgent", "outage", "on-call", "playbook", "eta", "risk",
        "precursor", "pattern", "clear", "defer", "intervene", "escalat",
    ]
    entity_words = [w.strip("-_") for w in re.split(r'[^a-zA-Z0-9]', entity.lower()) if len(w) > 2]
    q_words = set(re.split(r'[^a-zA-Z0-9]', q))
    pronouns = {"it", "its", "itt", "this", "them", "they"}
    
    is_related = (
        not q or 
        any(w in q for w in entity_words) or 
        any(k in q for k in op_keywords) or
        any(p in q_words for p in pronouns) or
        bool(q_words.intersection({"hi", "hello", "hey", "help"}))
    )
    
    if not is_related:
        return {
            "summary": f"I am optimized to assist only with operational and metric questions related to the selected resource: {entity}. Please ask a question related to this resource's health, metrics, alerts, or dependencies.",
            "findings": [],
            "evidence": [],
            "recommended_actions": [],
            "confidence": "0%",
        }

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
        drilldown = entity_data.get("drilldown", "")
        detections = analysis.get("detections", []) if isinstance(analysis, dict) else []
        clearance = analysis.get("clearance_plan", {}) if isinstance(analysis, dict) else {}
        alerts = context.get("related_alerts", [])

        if drilldown == "active-alerts":
            critical = entity_data.get("critical_count", len(alerts))
            alert_titles = [
                a.get("title", str(a)) if isinstance(a, dict) else str(a) for a in alerts[:5]
            ]
            actions = clearance.get("priority_actions", []) if isinstance(clearance, dict) else []
            return {
                "summary": (
                    f"{critical} critical alerts are active. Clear highest-severity signals on services "
                    "with imminent precursor patterns first to prevent incident formation."
                ),
                "findings": [
                    f"Critical alert count: {critical}",
                    f"Total active signals in view: {entity_data.get('total_active', 'N/A')}",
                ],
                "evidence": alert_titles,
                "recommended_actions": actions[:5] or [
                    "Triage critical alerts by impacted service and ETA",
                    "Correlate alerts with matched precursor patterns",
                    "Execute clearance plan priority actions",
                ],
                "confidence": "75%",
            }

        if drilldown == "ranked-threats" and detections:
            ranked = sorted(
                detections,
                key=lambda d: (
                    d.get("estimated_time_to_incident_minutes", 999),
                    -float(str(d.get("confidence", 0)).replace("%", "") or 0),
                ),
            )
            top = ranked[0]
            service = top.get("expected_impacted_service", "top-ranked service")
            eta = top.get("estimated_time_to_incident_minutes", "N/A")
            return {
                "summary": (
                    f"Address the threat on {service} first — shortest ETA ({eta} min) "
                    f"with {top.get('confidence', 'N/A')}% confidence and {top.get('risk_level', 'elevated')} risk."
                ),
                "findings": [
                    f"Top threat: {service}",
                    f"Progression stage: {top.get('progression_stage', 'N/A')}",
                    f"Threats in queue: {len(detections)}",
                ],
                "evidence": (top.get("matched_alerts", []) or [])[:5],
                "recommended_actions": (top.get("recommended_actions", []) or [])[:5] or [
                    f"Intervene on {service} before ETA expires",
                    "Collect matched alert evidence",
                    "Notify service owner",
                ],
                "confidence": f"{top.get('confidence', 75)}%",
            }

        if drilldown == "eta" and entity_data.get("service"):
            service = entity_data.get("service")
            eta = entity_data.get("eta_minutes", "N/A")
            return {
                "summary": (
                    f"Intervene on {service} within {eta} minutes: scale constrained resources, "
                    "clear matched precursor alerts, and validate dependency health."
                ),
                "findings": [
                    f"Service at risk: {service}",
                    f"ETA: {eta} minutes",
                    f"Risk level: {entity_data.get('risk_level', 'N/A')}",
                ],
                "evidence": entity_data.get("evidence", [])[:5],
                "recommended_actions": entity_data.get("recommended_actions", [])[:5] or [
                    "Scale affected resources",
                    "Clear matched precursor alerts",
                    "Monitor dependency chain",
                ],
                "confidence": f"{entity_data.get('confidence', 75)}%",
            }

        prediction = entity_data.get("prediction", entity)
        return {
            "summary": f"Early detection prediction: {prediction}.",
            "findings": [
                f"Confidence: {entity_data.get('confidence', 'N/A')}%",
                f"ETA to outage: {entity_data.get('estimated_time_to_outage', entity_data.get('eta_minutes', 'N/A'))}",
            ],
            "evidence": entity_data.get("evidence", [])[:5],
            "recommended_actions": entity_data.get("recommended_actions", [])[:5] or [
                "Scale affected resources",
                "Review correlated alerts",
                "Prepare incident response",
            ],
            "confidence": f"{entity_data.get('confidence', 70)}%",
        }

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
    context = _trim_copilot_context(context)
    messages = _trim_chat_messages(messages)

    page_type = context.get("page_type")
    if not page_type:
        page_type = "early_detection"
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

    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    is_groq_valid = groq_key and not groq_key.startswith("your_")

    if is_groq_valid:
        try:
            raw, model_used = chat_with_fallback(llm_messages, model)
            result = _parse_structured_response(raw)
            result["model"] = model_used
            result["timestamp"] = timestamp
            result["agent"] = agent.page_type
            return result
        except Exception as exc:
            logger.exception("GROQ call failed")
            err_msg = str(exc)
            
            if "429" in err_msg or "rate_limit" in err_msg.lower():
                friendly_err = "⚠️ The AI assistant is temporarily unavailable because the GROQ rate limit was reached. Please wait 30-60 seconds before retrying or upgrade your tier."
                model_code = "error-ratelimit"
            elif "413" in err_msg or "too large" in err_msg.lower() or "context_length" in err_msg.lower():
                friendly_err = "⚠️ The conversation context length exceeds the model's limit. Please clear the chat history or shorten your query."
                model_code = "error-contextlimit"
            elif "402" in err_msg or "payment" in err_msg.lower() or "Payment Required" in err_msg:
                friendly_err = "⚠️ GROQ API account payment required/insufficient credits. Please top up your balance or update your billing details."
                model_code = "error-payment"
            elif "401" in err_msg or "403" in err_msg or "unauthorized" in err_msg.lower() or "1010" in err_msg:
                friendly_err = "⚠️ GROQ API authentication failed: Invalid or expired API Key. Please verify the GROQ_API_KEY configured in backend/.env."
                model_code = "error-unauthorized"
            else:
                friendly_err = f"⚠️ The AI assistant is temporarily unavailable: {err_msg[:250]}"
                model_code = "error-unresolved"
                
            return {
                "summary": friendly_err,
                "findings": [],
                "evidence": [],
                "recommended_actions": [
                  "Verify your GROQ_API_KEY in backend/.env",
                  "Check account balance and rate limits at console.groq.com"
                ],
                "confidence": "0%",
                "model": model_code,
                "agent": agent.page_type,
                "timestamp": timestamp,
            }

    # If key is missing or placeholder, try rule-based fallback first
    user_question = context.get("user_question", "") or (
        messages[-1].get("content", "") if messages else ""
    )
    mock = _mock_response(context, user_question)
    if mock.get("summary") and mock["summary"] != "That information is not present in the current investigation context.":
        mock["model"] = "rule-based-fallback"
        mock["timestamp"] = timestamp
        mock["agent"] = agent.page_type
        return mock

    return {
        "summary": "⚠️ GROQ_API_KEY is not configured in backend/.env. Please configure a valid API key to enable AI analysis.",
        "findings": [],
        "evidence": [],
        "recommended_actions": [
          "Set a valid GROQ_API_KEY in backend/.env"
        ],
        "confidence": "0%",
        "model": "error-unconfigured",
        "agent": agent.page_type,
        "timestamp": timestamp,
    }
