from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Any, Optional

from app.services.copilot_service import copilot_chat

router = APIRouter(prefix="/api/copilot", tags=["copilot"])


class ChatMessage(BaseModel):
    role: str
    content: str


class CopilotContext(BaseModel):
    context_scope: str = "strict"
    page_type: str = ""
    selected_entity: str = ""
    entity_data: dict[str, Any] = Field(default_factory=dict)
    related_metrics: dict[str, Any] = Field(default_factory=dict)
    related_alerts: list[Any] = Field(default_factory=list)
    related_incidents: list[Any] = Field(default_factory=list)
    dependency_data: dict[str, Any] = Field(default_factory=dict)
    analysis_results: dict[str, Any] = Field(default_factory=dict)
    investigation_results: dict[str, Any] = Field(default_factory=dict)
    user_question: str = ""


class CopilotChatRequest(BaseModel):
    context: CopilotContext
    messages: list[ChatMessage] = Field(default_factory=list)


class CopilotChatResponse(BaseModel):
    summary: str = ""
    findings: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    confidence: str = ""
    model: Optional[str] = None
    agent: Optional[str] = None
    timestamp: Optional[str] = None


@router.post("/chat", response_model=CopilotChatResponse)
def chat(req: CopilotChatRequest):
    result = copilot_chat(
        req.context.model_dump(),
        [m.model_dump() for m in req.messages],
    )
    return CopilotChatResponse(**result)
