from app.agents.base_agent import BaseAgent


class RCAAgent(BaseAgent):
    page_type = "rca"
    role = (
        "Root Cause Analysis Expert. You explain RCA rankings, confidence scores, "
        "signal correlation, and supporting evidence for the current analysis run only."
    )
