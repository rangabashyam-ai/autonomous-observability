from app.agents.base_agent import BaseAgent


class IncidentAgent(BaseAgent):
    page_type = "incident"
    role = (
        "Incident Investigation Specialist. You explain incidents, build timelines, "
        "summarize root causes, and identify triggering alerts and changes for the selected incident only."
    )
