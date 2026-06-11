from typing import Optional

from fastapi import APIRouter, Query, HTTPException

from app.data_store import read_json

router = APIRouter(prefix="/api/incidents", tags=["incidents"])


def _filter_incidents(
    incidents: list,
    severity: Optional[str] = None,
    service: Optional[str] = None,
    search: Optional[str] = None,
    state: Optional[str] = None,
    active: Optional[bool] = None,
) -> list:
    if active:
        incidents = [i for i in incidents if i.get("state") in ("Open", "In Progress")]
    if severity:
        incidents = [i for i in incidents if i.get("severity") == severity]
    if service:
        incidents = [
            i for i in incidents
            if service.lower() in i.get("service_id", "").lower()
            or service.lower() in i.get("service", "").lower()
        ]
    if search:
        q = search.lower()
        incidents = [
            i for i in incidents
            if q in i.get("title", "").lower()
            or q in i.get("incident_id", "").lower()
            or q in i.get("root_cause", "").lower()
        ]
    if state:
        incidents = [i for i in incidents if i.get("state") == state]
    return incidents


@router.get("/")
def get_incidents(
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    severity: Optional[str] = None,
    service: Optional[str] = None,
    search: Optional[str] = None,
    state: Optional[str] = None,
    active: Optional[bool] = None,
):
    data = read_json("incidents/service_now_incidents.json")
    incidents = _filter_incidents(data.get("incidents", []), severity, service, search, state, active)
    total = len(incidents)
    return {
        "incidents": incidents[offset: offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/jira")
def get_jira_tickets(limit: int = Query(default=50, le=500)):
    data = read_json("incidents/jira_tickets.json")
    tickets = data.get("tickets", [])
    return {"tickets": tickets[:limit], "total": len(tickets)}


@router.get("/graph")
def get_incident_graph(incident_id: Optional[str] = None):
    data = read_json("rca/incident_graph.json")
    if incident_id:
        nodes = [n for n in data.get("nodes", []) if n.get("incident_id") == incident_id]
        node_ids = {n["id"] for n in nodes}
        edges = [
            e for e in data.get("edges", [])
            if e["source"] in node_ids and e["target"] in node_ids
        ]
        return {"nodes": nodes, "edges": edges}
    return data


@router.get("/knowledge-graph")
def get_knowledge_graph_summary():
    data = read_json("rca/knowledge_graph.json")
    return {
        "stats": data.get("stats", {}),
        "node_count": len(data.get("nodes", [])),
        "edge_count": len(data.get("edges", [])),
        "pattern_count": len(data.get("pattern_library", [])),
    }


@router.get("/{incident_id}/analysis")
def get_incident_analysis(incident_id: str):
    from app.agents.incident_analysis import get_incident_click_analysis
    result = get_incident_click_analysis(incident_id)
    if result.get("type") == "error":
        raise HTTPException(status_code=404, detail=result.get("error", "Not found"))
    return result


@router.get("/{incident_id}/change-requests")
def get_incident_change_requests(incident_id: str):
    """Return the ticket lifecycle versions (change request history) for a given incident."""
    data = read_json("incidents/change_requests.json")
    flows = data.get("ticket_flows", [])
    # Find the matching flow — an incident may have multiple tickets
    matched = [f for f in flows if f.get("incident_id") == incident_id]
    if not matched:
        return {"incident_id": incident_id, "tickets": [], "total": 0}
    return {
        "incident_id": incident_id,
        "tickets": matched,
        "total": len(matched),
    }


@router.get("/{incident_id}")
def get_incident_detail(incident_id: str):
    data = read_json("incidents/service_now_incidents.json")
    for inc in data.get("incidents", []):
        if inc.get("incident_id") == incident_id or inc.get("id") == incident_id:
            return inc
    raise HTTPException(status_code=404, detail="Incident not found")
