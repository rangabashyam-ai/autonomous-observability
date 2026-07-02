from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.ops.catalog import get_catalog
from app.ops.dashboards import get_dashboard
from app.ops.entity_registry import build_entity_registry, get_entities
from app.ops.models import OpsEntitiesResponse, OpsEntity

router = APIRouter(prefix="/api/ops", tags=["ops"])


@router.get("/catalog")
def ops_catalog():
    return get_catalog()


@router.get("/dashboards/{dashboard_id}")
def ops_dashboard(dashboard_id: str):
    try:
        return get_dashboard(dashboard_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Dashboard '{dashboard_id}' not found")


@router.get("/entities", response_model=OpsEntitiesResponse)
def ops_entities(
    entity_type: Optional[str] = Query(None),
    perspective: Optional[str] = Query(None, pattern="^(service|platform)$"),
    health: Optional[str] = Query(None),
):
    entities = get_entities(entity_type=entity_type, perspective=perspective, health=health)
    by_type: dict[str, int] = {}
    for e in entities:
        by_type[e.entity_type] = by_type.get(e.entity_type, 0) + 1
    return OpsEntitiesResponse(entities=entities, total=len(entities), by_type=by_type)


@router.get("/entities/{entity_id}", response_model=OpsEntity)
def ops_entity(entity_id: str):
    for e in build_entity_registry():
        if e.id == entity_id:
            return e
    raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")


@router.get("/entities/{entity_id}/telemetry")
def ops_entity_telemetry(entity_id: str):
    from app.parquet_store import query_entity_telemetry

    entity = None
    for e in build_entity_registry():
        if e.id == entity_id:
            entity = e
            break
    if not entity:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")
    return query_entity_telemetry(entity.id, entity.name)
