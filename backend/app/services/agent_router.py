'''Route page types to specialized copilot agents.'''

from __future__ import annotations

# Import all agent classes, including EarlyDetectionAgent
from app.agents import (
    BlastRadiusAgent,
    ExecutiveAgent,
    IncidentAgent,
    PredictionAgent,
    RCAAgent,
    ServiceAgent,
    WorkflowAgent,
    EarlyDetectionAgent,
)

# BaseAgent is needed for type annotations
from app.agents.base_agent import BaseAgent

# Central registry of agents keyed by page_type
_AGENTS: dict[str, BaseAgent] = {
    "service": ServiceAgent(),
    "incident": IncidentAgent(),
    "rca": RCAAgent(),
    "blast": BlastRadiusAgent(),
    "prediction": PredictionAgent(),
    "workflow": WorkflowAgent(),
    "executive": ExecutiveAgent(),
    "early_detection": EarlyDetectionAgent(),
}


def get_agent(page_type: str) -> BaseAgent:
    """Return the appropriate agent for the given page_type.

    Falls back to ExecutiveAgent if the page_type is unknown.
    """
    return _AGENTS.get(page_type, ExecutiveAgent())
