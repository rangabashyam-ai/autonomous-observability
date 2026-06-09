"""Early detection copilot agent."""

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
        payload = {
            "context_scope": context.get("context_scope", "strict"),
            "page_type": context.get("page_type", ""),
            "selected_entity": selected,
            "entity_data": context.get("entity_data", {}),
            "related_metrics": context.get("related_metrics", {}),
            "related_alerts": context.get("related_alerts", []),
            "related_incidents": context.get("related_incidents", []),
            "dependency_data": context.get("dependency_data", {}),
            "analysis_results": context.get("analysis_results", {}),
            "investigation_results": context.get("investigation_results", {}),
        }

        return (
            f"{GUARDRAILS}\n\n"
            f"YOUR ROLE: {self.role}\n\n"
            "EARLY DETECTION BEHAVIOR:\n"
            "1. Directly answer the user's latest question; do not repeat the same generic prediction summary.\n"
            "2. Use active precursor signals, matched alerts, risk level, confidence, ETA, stage, coverage, "
            "correlated changes, dependency paths, and recommended actions from the payload.\n"
            "3. For 'why' questions, explain the specific signal chain and cite matched alerts/evidence.\n"
            "4. For playbook/remediation questions, provide ordered SRE actions that reduce the predicted risk.\n"
            "5. For deferral/safety questions, say what can be deferred and what cannot, based on risk, ETA, "
            "stage, confidence, and critical alert evidence.\n"
            "6. For prioritization questions, rank the threat or service and explain the operational reason.\n"
            "7. If data is missing, say exactly which signal/evidence is missing instead of inventing it.\n"
            "8. You may explain SRE concepts, but never fabricate telemetry or incidents outside this payload.\n\n"
            "RESPONSE FORMAT:\n"
            "Return valid JSON only, with exactly these top-level fields:\n"
            "{\n"
            '  "summary": "Direct answer to the latest question",\n'
            '  "findings": ["specific finding"],\n'
            '  "evidence": ["payload evidence item"],\n'
            '  "recommended_actions": ["action"],\n'
            '  "confidence": "85%"\n'
            "}\n\n"
            f"CURRENT EARLY DETECTION PAYLOAD:\n{json.dumps(payload, indent=2, default=str)}\n\n"
            f"Answer only about: {selected}"
        )


class PredictionAgent(EarlyDetectionAgent):
    page_type = "prediction"
