from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

HealthStatus = Literal["healthy", "warning", "critical", "unknown"]
OpsPerspective = Literal["service", "platform"]


class OpsEntity(BaseModel):
    id: str
    name: str
    entity_type: str
    layer: Optional[str] = None
    health: HealthStatus = "unknown"
    platform: Optional[str] = None
    region: Optional[str] = None
    parent_id: Optional[str] = None
    owner: Optional[str] = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    relationships: list[str] = Field(default_factory=list)


class OpsSectionWidget(BaseModel):
    widget_type: str
    title: str
    entity_types: list[str] = Field(default_factory=list)
    derive_key: Optional[str] = None
    columns: list[str] = Field(default_factory=list)


class OpsDashboardSection(BaseModel):
    id: str
    label: str
    description: Optional[str] = None
    icon: Optional[str] = None
    entity_types: list[str] = Field(default_factory=list)
    widgets: list[OpsSectionWidget] = Field(default_factory=list)


class OpsDashboardDefinition(BaseModel):
    id: str
    title: str
    description: str
    perspective: OpsPerspective
    sections: list[OpsDashboardSection]


class EntityTypeInfo(BaseModel):
    id: str
    label: str
    layer: str
    perspective: OpsPerspective


class OpsCatalogResponse(BaseModel):
    entity_types: list[EntityTypeInfo]
    integrations: list[str]
    service_nav: list[dict[str, str]]
    platform_nav: list[dict[str, str]]


class OpsEntitiesResponse(BaseModel):
    entities: list[OpsEntity]
    total: int
    by_type: dict[str, int]
