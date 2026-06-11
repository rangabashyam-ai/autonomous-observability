from typing import Optional

from fastapi import APIRouter, Query

from app.data_store import read_json

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


@router.get("/dashboard")
def get_monitoring_dashboard():
    data = read_json("monitoring/dashboard.json")
    if not data:
        return {"executive": {}, "service": {}, "technical": {}, "infrastructure": {}}
    
    try:
        from app.services.intelligence import _load_incidents, _load_alerts
        incidents = _load_incidents()
        alerts = _load_alerts()
        
        active_inc = [i for i in incidents if i.get("state") in ("Open", "In Progress")]
        open_al = [a for a in alerts if a.get("status") in ("open", "acknowledged")]
        
        if "executive" in data:
            data["executive"]["active_incidents"] = len(active_inc)
            data["executive"]["open_alerts"] = len(open_al)
    except Exception as e:
        print(f"Error dynamically updating dashboard: {e}")
        
    return data



@router.get("/alerts")
def get_alerts(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = Query(default=50, le=500),
):
    data = read_json("monitoring/alerts.json")
    alerts = data.get("alerts", [])
    if status:
        alerts = [a for a in alerts if a.get("status") == status]
    if severity:
        alerts = [a for a in alerts if a.get("severity") == severity]
        
    from app.services.intelligence import get_service_for_entity
    for a in alerts:
        a["service"] = get_service_for_entity(a.get("entity_id", ""))
        
    return {"alerts": alerts[:limit], "total": len(alerts)}


@router.get("/metrics")
def get_metrics(entity_id: Optional[str] = None, metric: Optional[str] = None):
    data = read_json("monitoring/metrics.json")
    metrics = data.get("metrics", [])
    if entity_id:
        metrics = [m for m in metrics if m.get("entity_id") == entity_id]
    if metric:
        metrics = [m for m in metrics if m.get("metric") == metric]
    return {"metrics": metrics}


@router.get("/events")
def get_events(limit: int = Query(default=50, le=500)):
    data = read_json("monitoring/events.json")
    events = data.get("events", [])
    return {"events": events[:limit], "total": len(events)}
