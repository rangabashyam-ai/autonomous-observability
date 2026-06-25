import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel

from app.data_store import DATA_DIR, read_json

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

# ---------------------------------------------------------------------------
# CSV-backed incident store
# ---------------------------------------------------------------------------

_CSV_PATH = Path(
    os.environ.get(
        "INCIDENTS_CSV",
        r"C:\Users\Infobell\Desktop\RCA_CORR\openRCA_Bank\incidents.csv",
    )
)

_csv_cache: list[dict] | None = None
_csv_mtime: float = 0.0


def _load_csv_incidents() -> list[dict] | None:
    """Read incidents.csv, join with parquet supplementary data, cache by mtime."""
    global _csv_cache, _csv_mtime

    if not _CSV_PATH.exists():
        return None

    mtime = _CSV_PATH.stat().st_mtime
    if _csv_cache is not None and mtime == _csv_mtime:
        return list(_csv_cache)

    with open(_CSV_PATH, "r", encoding="utf-8", newline="") as f:
        csv_rows = list(csv.DictReader(f))

    # Load parquet incidents for supplementary fields
    base_data = read_json("incidents/service_now_incidents.json")
    base_list = base_data.get("incidents", []) if isinstance(base_data, dict) else base_data
    base_by_id: dict[str, dict] = {inc.get("incident_id", ""): inc for inc in base_list}

    merged: list[dict] = []
    for row in csv_rows:
        orig_id = row.get("original_id", "")
        base = dict(base_by_id.get(orig_id, {}))

        # Preserve the parquet's original start_time for telemetry/SLO queries
        # (the parquet timestamps are in the actual data range; CSV times are display-only)
        base["parquet_start_time"] = base.get("start_time", "")
        base["parquet_end_time"]   = base.get("end_time", "")

        # Override display fields with CSV values
        base["incident_id"]    = row["id"]
        base["id"]             = row["id"]
        base["original_id"]    = orig_id
        base["title"]          = row["title"]
        base["severity"]       = row["severity"]
        base["fix"]            = row["fix"]
        base["start_time"]     = row.get("time", base.get("start_time", ""))

        # Hidden enrichment fields — in API response, never rendered by frontend
        base["true_root_cause"] = row.get("true_root_cause", "")
        base["component"]       = row.get("component", "")
        base["incident_time"]   = row.get("time", "")
        base["details"]         = row.get("details", "")

        # Preserve parquet state (Open / In Progress) for active filtering
        if not base.get("state"):
            base["state"] = "Open"

        merged.append(base)

    _csv_cache = merged
    _csv_mtime = mtime
    return list(_csv_cache)


def _find_incident(incident_id: str) -> dict | None:
    """Find an incident by IN-XXXX id, original INC-XXXX id, or hash id."""
    incidents = _load_csv_incidents()
    if incidents is None:
        data = read_json("incidents/service_now_incidents.json")
        incidents = data.get("incidents", []) if isinstance(data, dict) else data
    for inc in incidents:
        if (
            inc.get("incident_id") == incident_id
            or inc.get("id") == incident_id
            or inc.get("original_id") == incident_id
        ):
            return dict(inc)
    return None

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
    incidents = _load_csv_incidents()
    if incidents is None:
        data = read_json("incidents/service_now_incidents.json")
        incidents = data.get("incidents", [])
    incidents = _apply_resolutions(incidents)
    incidents = _filter_incidents(incidents, severity, service, search, state, active)
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
    all_source = _load_csv_incidents()
    if all_source is None:
        _d = read_json("incidents/service_now_incidents.json")
        all_source = _d.get("incidents", [])
    all_incidents = _apply_resolutions(all_source)
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
