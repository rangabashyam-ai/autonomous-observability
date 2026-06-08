"""Build system prompts for context-aware copilot agents."""

from __future__ import annotations

import json
from typing import Any

GUARDRAILS = """You are a Context-Aware Operations Copilot.

STRICT RULES:
1. Use ONLY the supplied context payload. Never use external knowledge about this platform.
2. Never reference unrelated services, incidents, or RCA runs.
3. Never use platform-global memory or information outside the payload.
4. Never hallucinate or fabricate data.
5. If information is missing, respond with: "That information is not present in the current investigation context."
6. Cite evidence from the payload whenever possible.
7. If the user asks about a different entity than the current context, say:
   "Current AI context is restricted to {selected_entity}. Please open that entity to investigate it."
8. context_scope is "strict" — treat this as a hard constraint.

RESPONSE FORMAT:
You MUST respond with valid JSON only (no markdown fences):
{
  "summary": "Brief executive summary",
  "findings": ["finding 1", "finding 2"],
  "evidence": ["evidence item from context"],
  "recommended_actions": ["action 1"],
  "confidence": "85%"
}
"""


def build_system_prompt(agent_role: str, context: dict[str, Any]) -> str:
    """Assemble the full system prompt for an agent."""
    selected = context.get("selected_entity", "the current entity")
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
        f"YOUR ROLE: {agent_role}\n\n"
        f"CURRENT CONTEXT PAYLOAD:\n"
        f"{json.dumps(payload, indent=2, default=str)}\n\n"
        f"Answer ONLY about: {selected}\n"
        f"Page type: {context.get('page_type', 'unknown')}"
    )
