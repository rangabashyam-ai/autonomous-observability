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
project_root = Path(__file__).resolve().parents[3]
env_path = project_root / ".env"
load_dotenv(dotenv_path=env_path, override=False)


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
        "effect", "impact", "cause", "solve", "fix", "resolution", "remedy", "issue", "trouble", "problem"
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
        return {
            "summary": f"Early detection prediction: {entity_data.get('prediction', entity)}.",
            "findings": [
                f"Confidence: {entity_data.get('confidence', 'N/A')}%",
                f"ETA to outage: {entity_data.get('estimated_time_to_outage', 'N/A')}",
            ],
            "evidence": entity_data.get("evidence", [])[:5],
            "recommended_actions": ["Scale affected resources", "Review correlated alerts", "Prepare incident response"],
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

    if os.environ.get("GROQ_API_KEY"):
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
            friendly_err = "The AI assistant is temporarily unavailable due to an issue with your GROQ API key or request. Please verify your key, account balance, and GROQ endpoint."
            if "402" in err_msg or "Payment Required" in err_msg:
                friendly_err = "The AI assistant is temporarily unavailable due to insufficient credits/balance on your GROQ API key. Please top up your account or configure a new key."
            elif "403" in err_msg or "1010" in err_msg:
                friendly_err = "The AI assistant request was blocked by GROQ. Check your GROQ_API_KEY, GROQ_BASE_URL, and make sure the request is not being blocked by Cloudflare or an invalid endpoint."
            
            return {
                "summary": friendly_err,
                "findings": [],
                "evidence": [],
                "recommended_actions": [
                  "Check your Groq API key and account",
                  "Configure a valid GROQ_API_KEY in backend/.env"
                ],
                "confidence": "0%",
                "model": "error-unresolved",
                "agent": agent.page_type,
                "timestamp": timestamp,
            }

    return {
        "summary": "GROQ_API_KEY is not configured in backend/.env. Please configure a valid API key to enable AI analysis.",
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
