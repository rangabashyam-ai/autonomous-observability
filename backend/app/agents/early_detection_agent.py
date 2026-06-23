"""Early detection copilot agent — data-grounded responses only."""

from __future__ import annotations

import json
from typing import Any

from app.agents.base_agent import BaseAgent
from app.services.prompt_builder import GUARDRAILS


class EarlyDetectionAgent(BaseAgent):
    page_type = "early_detection"
    role = (
        "Early Detection SRE Analyst. You answer questions about precursor signals, "
        "risk scoring, likely incident formation, ETA, blast/impact risk, and preventive playbooks."
    )

    def get_system_prompt(self, context: dict[str, Any]) -> str:
        selected = context.get("selected_entity", "the selected early-detection context")
        entity_data = context.get("entity_data", {})
        payload = {
            "context_scope": context.get("context_scope", "strict"),
            "page_type": context.get("page_type", ""),
            "selected_entity": selected,
            "entity_data": entity_data,
            "related_metrics": context.get("related_metrics", {}),
            "related_alerts": context.get("related_alerts", []),
            "related_incidents": context.get("related_incidents", []),
            "dependency_data": context.get("dependency_data", {}),
            "analysis_results": context.get("analysis_results", {}),
            "investigation_results": context.get("investigation_results", {}),
        }

        # Pull out key fields so we can embed them prominently in the prompt
        svc = entity_data.get("prediction") or entity_data.get("service") or selected
        confidence = entity_data.get("confidence", "N/A")
        eta = entity_data.get("eta_minutes") or entity_data.get("estimated_time_to_outage", "N/A")
        risk = entity_data.get("risk_level", "N/A")
        stage = entity_data.get("progression_stage", "N/A")
        rec_actions = entity_data.get("recommended_actions", [])
        matched_alerts = entity_data.get("evidence") or entity_data.get("matched_alerts", [])

        return (
            f"{GUARDRAILS}\n\n"
            f"YOUR ROLE: {self.role}\n\n"
            "CRITICAL DATA-GROUNDING RULES:\n"
            "1. Your answer MUST reference the actual values from the payload below.\n"
            f"   - Affected service: {svc}\n"
            f"   - Confidence: {confidence}%\n"
            f"   - ETA to incident: {eta} minutes\n"
            f"   - Risk level: {risk}\n"
            f"   - Progression stage: {stage}\n"
            f"   - Matched alert signals: {matched_alerts[:5]}\n"
            f"   - Recommended actions from data: {rec_actions[:5]}\n"
            "2. If recommended_actions are present in the payload, USE THEM VERBATIM as the primary actions.\n"
            "   Do NOT replace real payload actions with generic SRE advice.\n"
            "3. For 'why' questions: explain the specific signal chain — cite matched alert names from the payload.\n"
            "4. For playbook/remediation questions: list the actual recommended_actions from entity_data first,\n"
            "   then add SRE steps only if the payload actions are insufficient.\n"
            "5. For 'what should I do' / 'immediate actions': always reference the service name,\n"
            "   ETA, risk level, and the specific matched alert signals.\n"
            "6. NEVER output generic steps like 'Escalate to on-call' or 'Roll back most recent deployment'\n"
            "   unless those exact phrases appear in the payload's recommended_actions.\n"
            "7. Cite real alert titles, real confidence %, real ETA minutes in your summary.\n"
            "8. If data is missing, say exactly which field is missing instead of fabricating it.\n\n"
            "RESPONSE FORMAT:\n"
            "Return valid JSON only, with exactly these top-level fields:\n"
            "{\n"
            '  "summary": "Direct answer naming real service, real ETA, real confidence",\n'
            '  "findings": ["finding citing real signal or metric"],\n'
            '  "evidence": ["matched alert title or payload evidence item"],\n'
            '  "recommended_actions": ["VERBATIM from payload if available, else SRE-specific action"],\n'
            '  "confidence": "85%"\n'
            "}\n\n"
            f"CURRENT EARLY DETECTION PAYLOAD:\n{json.dumps(payload, indent=2, default=str)}\n\n"
            f"Answer the user's question SPECIFICALLY about: {svc} (entity: {selected})"
        )


class PredictionAgent(EarlyDetectionAgent):
    page_type = "prediction"