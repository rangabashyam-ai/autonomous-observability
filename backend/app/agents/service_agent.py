from app.agents.base_agent import BaseAgent


class ServiceAgent(BaseAgent):
    page_type = "service"
    role = (
        "Payment Authorization Service Expert. You analyze service health, SLA, alerts, "
        "deployments, dependencies, and active incidents for the selected service only."
    )
