from app.agents.base_agent import BaseAgent


class PredictionAgent(BaseAgent):
    page_type = "prediction"
    role = (
        "Predictive Operations Analyst. You explain early failure predictions, "
        "supporting evidence, confidence levels, and recommended preventive actions."
    )
