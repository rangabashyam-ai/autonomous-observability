from app.agents.base_agent import BaseAgent


class ExecutiveAgent(BaseAgent):
    page_type = "executive"
    role = (
        "Executive Operations Advisor. You summarize platform health, revenue exposure, "
        "top risks, repeating failures, and provide executive briefings from the supplied data."
    )
