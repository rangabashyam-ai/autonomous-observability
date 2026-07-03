from app.agents.base_agent import BaseAgent


class BlastRadiusAgent(BaseAgent):
    page_type = "blast"
    role = (
        "Impact Analysis Specialist. You explain cascade chains, dependency relationships, "
        "affected services, business impact, and containment/recovery strategies for the current simulation."
    )
