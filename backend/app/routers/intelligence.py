from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from app.services.intelligence import (
    KnowledgeGraphService,
    analyze_rca,
    analyze_blast_radius,
    detect_early_failures,
    create_investigation,
    advance_investigation,
    approve_remediation,
    execute_remediation,
    get_investigation,
    list_investigations,
    copilot_query,
    get_overview,
)

router = APIRouter(prefix="/api", tags=["intelligence"])


class RCARequest(BaseModel):
    alerts: list[str]
    symptoms: list[str]
    service: Optional[str] = None
    time_window_hours: int = 24
    environment: Optional[str] = None


class BlastRadiusRequest(BaseModel):
    alerts: list[str]
    symptoms: list[str]
    source_component: Optional[str] = None
    service: Optional[str] = None


class EarlyDetectionRequest(BaseModel):
    current_alerts: Optional[list[str]] = None


class InvestigationRequest(BaseModel):
    alerts: list[str]
    symptoms: list[str]
    service: Optional[str] = None


class CopilotRequest(BaseModel):
    question: str


class ScopedCopilotRequest(BaseModel):
    context_type: str
    context_payload: dict
    question: str
    history: Optional[list[dict]] = None


@router.post("/overview")
def overview():
    return get_overview()


@router.get("/knowledge-graph")
def knowledge_graph():
    return KnowledgeGraphService().get_graph()


@router.get("/knowledge-graph/stats")
def knowledge_graph_stats():
    return KnowledgeGraphService().get_stats()


@router.post("/rca/analyze")
def rca_analyze(req: RCARequest):
    return analyze_rca(
        req.alerts, req.symptoms, req.service, req.time_window_hours, req.environment
    )


class RCAAgentRequest(BaseModel):
    alerts: list[str]
    symptoms: list[str]
    service: Optional[str] = None
    time_window_hours: int = 24


@router.post("/rca/agent-analyze")
def rca_agent_analyze(req: RCAAgentRequest):
    from app.agents.rca_agent import RCAAgent
    return RCAAgent().analyze_from_signals(
        req.alerts,
        req.symptoms,
        req.service or "",
        req.time_window_hours,
    )


class ReportChatRequest(BaseModel):
    question: str
    report_context: str
    report_type: str
    history: list[dict] = []


@router.post("/agents/report-chat")
def report_chat(req: ReportChatRequest):
    from app.agents.report_chat_agent import answer_report_question
    return answer_report_question(
        req.question, req.report_context, req.report_type, req.history
    )


@router.post("/blast-radius/analyze")
def blast_radius_analyze(req: BlastRadiusRequest):
    return analyze_blast_radius(
        req.alerts, req.symptoms, req.source_component, req.service
    )


@router.post("/early-detection/analyze")
def early_detection_analyze(req: EarlyDetectionRequest):
    return detect_early_failures(req.current_alerts)


@router.get("/early-detection/analyze")
def early_detection_analyze_get():
    return detect_early_failures()


@router.post("/investigations")
def start_investigation(req: InvestigationRequest):
    return create_investigation(req.alerts, req.symptoms, req.service)


@router.get("/investigations")
def get_investigations():
    return {"investigations": list_investigations()}


@router.get("/investigations/{inv_id}")
def get_investigation_detail(inv_id: str):
    inv = get_investigation(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Investigation not found")
    return inv


@router.post("/investigations/{inv_id}/advance")
def advance_inv(inv_id: str):
    return advance_investigation(inv_id)


@router.post("/investigations/{inv_id}/approve")
def approve_inv(inv_id: str):
    return approve_remediation(inv_id)


@router.post("/investigations/{inv_id}/execute")
def execute_inv(inv_id: str):
    return execute_remediation(inv_id)


@router.post("/copilot/ask")
def ask_copilot(req: CopilotRequest):
    return copilot_query(req.question)


@router.post("/copilot/scoped")
def ask_scoped_copilot(req: ScopedCopilotRequest):
    from app.services.intelligence import scoped_copilot_query
    return scoped_copilot_query(
        req.context_type, req.context_payload, req.question, req.history or []
    )


class ChatBlastRadiusRequest(BaseModel):
    service: str
    question: str
    history: Optional[list[dict]] = None


@router.post("/blast-radius/chat-investigate")
def blast_radius_chat_investigate(req: ChatBlastRadiusRequest):
    from app.services.chat_blast_radius import chat_blast_radius_query
    return chat_blast_radius_query(req.service, req.question, req.history or [])

