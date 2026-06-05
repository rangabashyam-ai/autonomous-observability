from pydantic import BaseModel, Field
from typing import Optional


class DependencyEdge(BaseModel):
    source: str
    target: str
    relationship: str = "calls"
    type: str = "dependency"


class DependencyEdgeCreate(BaseModel):
    source: str
    target: str
    relationship: str = "calls"


class DependencyUploadJSON(BaseModel):
    source: str
    target: str
    relationship: str = "calls"


class GraphNode(BaseModel):
    id: str
    name: str
    type: str
    layer: str
    metrics: Optional[dict] = None
    health: Optional[str] = "healthy"


class HealthMetric(BaseModel):
    cpu: float = 0
    memory: float = 0
    storage: float = 0
    io: float = 0
    network: float = 0
    latency: float = 0
    error_rate: float = 0
    incident_count: int = 0
    risk_score: float = 0
