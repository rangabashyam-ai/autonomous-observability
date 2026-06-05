from typing import Optional

from fastapi import APIRouter, Query

from app.data_store import read_json

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


@router.get("/dashboard")
def get_monitoring_dashboard():
    data = read_json("monitoring/dashboard.json")
    if not data:
        return {"executive": {}, "service": {}, "technical": {}, "infrastructure": {}}
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
