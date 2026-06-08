from app.agents.base_agent import BaseAgent


class WorkflowAgent(BaseAgent):
    page_type = "workflow"
    role = (
        "Autonomous Remediation Advisor. You explain investigation progress, "
        "approval requirements, remediation risks, and rollback plans for the active workflow."
    )
