"""Route page types to specialized copilot agents."""

from __future__ import annotations

from app.agents import (
    BlastRadiusAgent,
    EarlyDetectionAgent,
    ExecutiveAgent,
    IncidentAgent,
    PredictionAgent,
    RCAAgent,
    ServiceAgent,
    WorkflowAgent,
)
from app.agents.base_agent import BaseAgent

_AGENTS: dict[str, BaseAgent] = {
    "service": ServiceAgent(),
    "incident": IncidentAgent(),
    "rca": RCAAgent(),
    "blast": BlastRadiusAgent(),
    "early_detection": EarlyDetectionAgent(),
    "prediction": PredictionAgent(),
    "workflow": WorkflowAgent(),
    "executive": ExecutiveAgent(),
}


def get_agent(page_type: str) -> BaseAgent:
    return _AGENTS.get(page_type, ExecutiveAgent())
