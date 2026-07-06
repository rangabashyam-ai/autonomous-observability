import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel

from app.data_store import DATA_DIR, read_json
from app.minio_intel_store import MinioIntelUnavailable, fetch_router_incidents, find_raw_incident, find_router_incident, http_unavailable
from app import parquet_store

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

# ---------------------------------------------------------------------------
# CSV-backed incident store
# ---------------------------------------------------------------------------

_CSV_PATH = Path(os.environ["INCIDENTS_CSV"]) if os.environ.get("INCIDENTS_CSV") else None

_csv_cache: list[dict] | None = None
_csv_mtime: float = 0.0

# ---------------------------------------------------------------------------
# Bank-incident JSON store (openRCA_Bank/incidents/incident_INC-XXXX.json)
# ---------------------------------------------------------------------------

_BANK_INC_DIR = Path(os.environ["BANK_INCIDENTS_DIR"]) if os.environ.get("BANK_INCIDENTS_DIR") else None

_BANK_INC_CACHE: dict[str, dict] = {}


_incidents_cache: list[dict] | None = None


def _load_minio_incidents() -> list[dict]:
    global _incidents_cache
    if _incidents_cache is not None:
        return list(_incidents_cache)
    try:
        from app.data_availability import is_minio_intel_available
        if not is_minio_intel_available():
            from app import vm_data_store
            pushed = vm_data_store.get("incidents")
            if pushed:
                _incidents_cache = pushed.get("incidents", [])
                return list(_incidents_cache)
            return []
        _incidents_cache = fetch_router_incidents()
    except MinioIntelUnavailable as exc:
        raise http_unavailable(exc)
    return list(_incidents_cache)


def _load_bank_incident(incident_id: str) -> dict | None:
    if incident_id in _BANK_INC_CACHE:
        return _BANK_INC_CACHE[incident_id]
    raw = find_raw_incident(incident_id)
    if raw is None:
        return None
    _BANK_INC_CACHE[incident_id] = raw
    return raw


def _load_csv_incidents() -> list[dict] | None:
    return _load_minio_incidents()


def _load_custom_incidents() -> list[dict]:
    return []


def _find_incident(incident_id: str) -> dict | None:
    try:
        return find_router_incident(incident_id)
    except MinioIntelUnavailable as exc:
        raise http_unavailable(exc)


def resolve_bank_incident_meta(raw: dict) -> dict:
    """
    Convert a raw bank incident JSON into the metadata shape expected by
    run_incident_chat (service, services, impacted_components, start_ts, end_ts, …).

    Bank incidents have `entities` that may contain only infra nodes (IG/MG/MySQL/Redis).
    We infer the affected services via the host→service mapping and always include the
    app-tier log hosts (Tomcat/Apache) in `impacted_components` so logs are queryable.
    """
    from app.parquet_store import infer_services_from_hosts, _LOG_HOSTS

    entities: list[str] = raw.get("entities", [])
    # Explicit service entities (ServiceTestN)
    svc_entities = [e for e in entities if e.lower().startswith("servicetest")]
    # Infra entities (everything else)
    infra_entities = [e for e in entities if not e.lower().startswith("servicetest")]

    # When no services listed, infer from infra entities
    all_services = svc_entities if svc_entities else infer_services_from_hosts(infra_entities)
    primary_service = all_services[0] if all_services else ""

    # Always include app-tier log hosts so query_logs returns real data
    all_hosts = sorted(set(infra_entities) | set(_LOG_HOSTS))

    tw = raw.get("timeWindow", {})
    return {
        "title":               raw.get("title", ""),
        "service":             primary_service,
        "services":            all_services,
        "severity":            raw.get("severity", ""),
        "root_cause":          raw.get("description", ""),
        "impacted_components": all_hosts,
        "start_time":          tw.get("start", ""),
        "end_time":            tw.get("end", ""),
        "start_ts":            _parse_ts(tw.get("start", "")),
        "end_ts":              _parse_ts(tw.get("end", "")),
    }


# ---------------------------------------------------------------------------
# In-process resolution overlay (file-backed for persistence across restarts)
# ---------------------------------------------------------------------------

_resolutions: dict[str, dict] = {}
_resolutions_loaded = False


def _resolutions_path() -> Path:
    return DATA_DIR / "incidents" / "resolutions.json"


def _load_resolutions() -> None:
    global _resolutions, _resolutions_loaded
    if _resolutions_loaded:
        return
    p = _resolutions_path()
    if p.exists():
        with open(p) as f:
            _resolutions = json.load(f)
    _resolutions_loaded = True


def _save_resolutions() -> None:
    p = _resolutions_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w") as f:
        json.dump(_resolutions, f, indent=2)


def _apply_resolutions(incidents: list) -> list:
    """Overlay persisted resolution state onto a list of incident dicts."""
    _load_resolutions()
    if not _resolutions:
        return incidents
    out = []
    for inc in incidents:
        iid = inc.get("incident_id") or inc.get("id")
        if iid and iid in _resolutions:
            inc = dict(inc)
            res = _resolutions[iid]
            inc["state"] = "Resolved"
            inc["resolved_at"] = res.get("resolved_at")
            if res.get("resolution_notes"):
                inc["resolution_notes"] = res["resolution_notes"]
        out.append(inc)
    return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _parse_ts(iso: str) -> int:
    """Parse ISO timestamp string to Unix seconds."""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return int(dt.timestamp())
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Endpoints (specific paths first, catch-all /{incident_id} last)
# ---------------------------------------------------------------------------

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
    incidents = _load_minio_incidents()
    incidents = _apply_resolutions(incidents)
    incidents = _filter_incidents(incidents, severity, service, search, state, active)
    total = len(incidents)
    return {
        "incidents": incidents[offset: offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
        "dataset_available": is_ui_data_available(),
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
    """Return the ticket lifecycle versions for a given incident."""
    data = read_json("incidents/change_requests.json")
    flows = data.get("ticket_flows", [])
    matched = [f for f in flows if f.get("incident_id") == incident_id]
    if not matched:
        return {"incident_id": incident_id, "tickets": [], "total": 0}
    return {"incident_id": incident_id, "tickets": matched, "total": len(matched)}


@router.get("/{incident_id}/telemetry")
def get_incident_telemetry(incident_id: str):
    """Return logs, metrics, and traces from parquet for the incident's time window."""
    from app.parquet_store import query_incident_telemetry

    incident = _find_incident(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    service = incident.get("service") or incident.get("service_id", "")
    cmdb_ids = incident.get("impacted_components", [])
    start_ts = _parse_ts(incident.get("parquet_start_time") or incident.get("start_time", ""))
    end_ts   = _parse_ts(incident.get("parquet_end_time")   or incident.get("end_time", ""))

    # Fallback: use a 2-hour window starting from start_time
    if end_ts <= start_ts:
        end_ts = start_ts + 7200

    return query_incident_telemetry(service, cmdb_ids, start_ts, end_ts)


class ResolveBody(BaseModel):
    resolution_notes: Optional[str] = ""
    resolved_by: Optional[str] = "user"


@router.get("/{incident_id}/slo-burn")
def get_incident_slo_burn(incident_id: str, slo_target: float = Query(default=99.9)):
    """
    Compute SLO burn rates at the time of the incident.
    Returns multi-window burn rates and which P0–P3 alert tier is firing.
    slo_target is a percentage, e.g. 99.9
    """
    incident = _find_incident(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    from app.parquet_store import query_slo_burn_multiservice

    parquet_start_ts = _parse_ts(incident.get("parquet_start_time", ""))
    parquet_end_ts   = _parse_ts(incident.get("parquet_end_time", ""))

    if parquet_start_ts == 0:
        raise HTTPException(status_code=422, detail="Incident has no usable timestamp")

    return query_slo_burn_multiservice(
        parquet_start_ts, parquet_end_ts, slo_target=slo_target / 100.0
    )


@router.get("/{incident_id}/runbook")
def get_incident_runbook(incident_id: str):
    """
    Return golden-signal deltas + a data-driven SRE runbook for the incident.

    Steps cover the Diagnosis → Mitigation → Verify → Resolve lifecycle
    and are backed by evidence drawn live from the parquet telemetry.
    """
    from app.parquet_store import query_incident_runbook

    incident = _find_incident(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    service    = incident.get("service") or incident.get("service_id", "")
    cmdb_ids   = incident.get("impacted_components", [])
    start_ts   = _parse_ts(incident.get("parquet_start_time") or incident.get("start_time", ""))
    end_ts     = _parse_ts(incident.get("parquet_end_time")   or incident.get("end_time", ""))
    root_cause = incident.get("root_cause", "")
    severity   = incident.get("severity", "P2")

    if end_ts <= start_ts:
        end_ts = start_ts + 7200

    # Find resolved incidents with the same root cause for proven-fix context
    all_incidents = _apply_resolutions(_load_minio_incidents())
    similar = [
        {
            "incident_id": i["incident_id"],
            "fix":         i.get("fix", ""),
            "root_cause":  i.get("root_cause", ""),
            "service":     i.get("service", ""),
        }
        for i in all_incidents
        if i.get("root_cause") == root_cause
        and i.get("incident_id") != incident_id
        and i.get("state") in ("Resolved", "Closed")
    ][:3]

    result = query_incident_runbook(
        service, cmdb_ids, start_ts, end_ts, root_cause, severity, similar
    )
    result["incident_id"]      = incident_id
    result["similar_incidents"] = similar
    return result


@router.patch("/{incident_id}/resolve")
def resolve_incident(incident_id: str, body: ResolveBody = Body(default=ResolveBody())):
    """Mark an incident as Resolved and persist the resolution."""
    _load_resolutions()

    incident = _find_incident(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    resolved_at = datetime.now(timezone.utc).isoformat()
    _resolutions[incident_id] = {
        "resolved_at": resolved_at,
        "resolution_notes": body.resolution_notes or "",
        "resolved_by": body.resolved_by or "user",
    }
    _save_resolutions()

    incident["state"] = "Resolved"
    incident["resolved_at"] = resolved_at
    if body.resolution_notes:
        incident["resolution_notes"] = body.resolution_notes

    return incident


@router.get("/{incident_id}")
def get_incident_detail(incident_id: str):
    incident = _find_incident(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return _apply_resolutions([incident])[0]
