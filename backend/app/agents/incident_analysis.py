"""
Shared analysis helpers for incident click-analysis.

Provides:
  - dependency-path tracing (BFS upstream + downstream)
  - component metric snapshots
  - metric anomaly detection
  - compact LLM context builders (event-aware, change-aware)
  - get_incident_click_analysis() dispatcher

Deliberately self-contained — does NOT modify app.services.intelligence.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone

from app.data_store import read_json

# ---------------------------------------------------------------------------
# Metric anomaly thresholds
# ---------------------------------------------------------------------------

METRIC_THRESHOLDS: dict[str, float] = {
    "cpu": 80.0,
    "memory": 85.0,
    "error_rate": 5.0,
    "latency": 500.0,
    "storage": 90.0,
}

# ---------------------------------------------------------------------------
# Data loaders
# ---------------------------------------------------------------------------


def _load_incidents() -> list[dict]:
    return read_json("incidents/service_now_incidents.json").get("incidents", [])


def _load_dep_edges() -> list[dict]:
    return read_json("dependencies/dependency_graph.json").get("edges", [])


def _load_alerts() -> list[dict]:
    return read_json("monitoring/alerts.json").get("alerts", [])


def _load_services() -> list[dict]:
    return read_json("dependencies/services.json").get("services", [])


def _load_infra_nodes() -> list[dict]:
    return read_json("dependencies/infrastructure.json").get("nodes", [])


def _load_metrics_ts() -> list[dict]:
    return read_json("monitoring/metrics.json").get("metrics", [])


def _load_events() -> list[dict]:
    return read_json("monitoring/events.json").get("events", [])


def _load_changes() -> list[dict]:
    return read_json("changes/change_records.json").get("changes", [])


# ---------------------------------------------------------------------------
# BFS helpers
# ---------------------------------------------------------------------------


def _bfs_up(start: str, edges: list[dict], max_depth: int = 3) -> list[str]:
    result, visited, queue = [], {start}, deque([(start, 0)])
    while queue:
        node, depth = queue.popleft()
        if depth > 0:
            result.append(node)
        if depth >= max_depth:
            continue
        for e in edges:
            if e["target"] == node and e["source"] not in visited:
                visited.add(e["source"])
                queue.append((e["source"], depth + 1))
    return result


def _bfs_down(start: str, edges: list[dict], max_depth: int = 3) -> list[str]:
    result, visited, queue = [], {start}, deque([(start, 0)])
    while queue:
        node, depth = queue.popleft()
        if depth > 0:
            result.append(node)
        if depth >= max_depth:
            continue
        for e in edges:
            if e["source"] == node and e["target"] not in visited:
                visited.add(e["target"])
                queue.append((e["target"], depth + 1))
    return result


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def _trace_full_dependency_path(component: str, edges: list[dict], max_depth: int = 3) -> list[str]:
    upstream = list(reversed(_bfs_up(component, edges, max_depth)))
    downstream = _bfs_down(component, edges, max_depth)
    seen: set[str] = set()
    path: list[str] = []
    for node in upstream + [component] + downstream:
        if node not in seen:
            seen.add(node)
            path.append(node)
    return path


def _get_metrics_snapshot(component_ids: list[str]) -> dict[str, dict]:
    svc_lookup: dict[str, dict] = {s["id"]: s.get("metrics", {}) for s in _load_services()}
    infra_lookup: dict[str, dict] = {
        n["id"]: n.get("metrics", {}) for n in _load_infra_nodes() if n.get("id")
    }
    ts_latest: dict[str, dict] = {}
    for entry in _load_metrics_ts():
        eid = entry.get("entity_id", "")
        metric = entry.get("metric", "")
        points = entry.get("points", [])
        if eid and metric and points:
            ts_latest.setdefault(eid, {})[metric] = points[-1]["value"]

    result: dict[str, dict] = {}
    for cid in component_ids:
        if cid in svc_lookup and svc_lookup[cid]:
            result[cid] = svc_lookup[cid]
        elif cid in infra_lookup and infra_lookup[cid]:
            result[cid] = infra_lookup[cid]
        elif cid in ts_latest:
            result[cid] = ts_latest[cid]
        else:
            for key, val in {**svc_lookup, **infra_lookup}.items():
                if val and (cid in key or key in cid):
                    result[cid] = val
                    break
    return result


def _detect_metric_anomalies(metrics: dict) -> list[str]:
    return [
        f"{m}={float(v):.1f} (>{t})"
        for m, t in METRIC_THRESHOLDS.items()
        if (v := metrics.get(m)) is not None and float(v) > t
    ]


# ---------------------------------------------------------------------------
# Context builders — compact, rich, LLM-optimised strings
# ---------------------------------------------------------------------------


def _fmt_metrics_table(component_metrics: dict, anomalous: dict) -> str:
    """Compact fixed-width metrics table."""
    if not component_metrics:
        return "  (no metric data)"
    lines = [f"  {'COMPONENT':<28} {'CPU%':>5} {'MEM%':>5} {'LAT':>7} {'ERR%':>5}  STATUS"]
    for comp, m in component_metrics.items():
        cpu  = m.get("cpu")
        mem  = m.get("memory")
        lat  = m.get("latency")
        err  = m.get("error_rate")
        flag = " ⚠ ANOMALY" if comp in anomalous else "  OK"
        lines.append(
            f"  {comp:<28}"
            f" {(f'{cpu:.1f}' if cpu is not None else '-'):>5}"
            f" {(f'{mem:.1f}' if mem is not None else '-'):>5}"
            f" {(f'{lat:.0f}ms' if lat is not None else '-'):>7}"
            f" {(f'{err:.1f}' if err is not None else '-'):>5}"
            f"  {flag.strip()}"
        )
    return "\n".join(lines)


def _filter_events(
    events: list[dict],
    component_ids: list[str],
    after: str = "",
    before: str = "",
    limit: int = 10,
) -> list[dict]:
    """Events whose entity_id overlaps the component set, sorted newest-first."""
    comp_set = set(component_ids)
    filtered = [
        e for e in events
        if any(comp in e.get("entity_id", "") or e.get("entity_id", "") in comp for comp in comp_set)
        and (not after  or e.get("timestamp", "") >= after)
        and (not before or e.get("timestamp", "") <= before)
    ]
    filtered.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return filtered[:limit]


def _fmt_events(events: list[dict]) -> str:
    if not events:
        return "  (none)"
    lines = []
    for e in events:
        ts  = e.get("timestamp", "")[:16].replace("T", " ")
        sev = e.get("severity", "info").upper()[:4]
        typ = e.get("type", "")[:12]
        eid = e.get("entity_id", "")[:28]
        src = e.get("source", "")[:10]
        msg = e.get("message", "")[:60]
        lines.append(f"  {ts}  [{sev:4}]  {typ:<14} {eid:<28} [{src}] {msg}")
    return "\n".join(lines)


def _filter_changes(
    changes: list[dict],
    service_ids: list[str],
    limit: int = 5,
) -> list[dict]:
    svc_set = set(service_ids)
    matched = [
        c for c in changes
        if set(c.get("affected_services", [])) & svc_set
    ]
    # If no specific match, include high-risk changes
    if not matched:
        matched = [c for c in changes if c.get("risk") == "high"]
    matched.sort(key=lambda c: c.get("scheduled_at", ""), reverse=True)
    return matched[:limit]


def _fmt_changes(changes: list[dict]) -> str:
    if not changes:
        return "  (none)"
    lines = []
    for c in changes:
        cid   = c.get("id", "")[:16]
        title = c.get("title", "")[:55]
        risk  = c.get("risk", "?")
        stat  = c.get("status", "?")
        svcs  = ", ".join(c.get("affected_services", [])[:3])
        lines.append(f"  {cid}  {title:<55} [{risk} risk / {stat}]  svcs: {svcs}")
    return "\n".join(lines)


def build_rca_context(
    incident: dict,
    dep_path: list[str],
    component_metrics: dict,
    anomalous: dict,
    candidates: list[dict],
) -> str:
    """
    Compact, token-efficient context string for the RCA LLM prompt.
    Includes incident details, dep path, metrics, relevant events,
    change records, and top historical pattern matches.
    """
    events  = _load_events()
    changes = _load_changes()

    inc_start  = incident.get("start_time", "")
    # Events in the 48 h window before the incident
    window_start = ""
    if inc_start:
        try:
            from datetime import timedelta
            dt = datetime.fromisoformat(inc_start.replace("Z", "+00:00"))
            window_start = (dt - timedelta(hours=48)).isoformat()
        except Exception:
            pass

    rel_events  = _filter_events(events, dep_path + incident.get("impacted_components", []),
                                  after=window_start, before=inc_start, limit=10)
    rel_changes = _filter_changes(changes, [incident.get("service_id", ""), incident.get("service", "")] +
                                   incident.get("impacted_components", []))

    parts: list[str] = []

    parts.append("=== INCIDENT ===")
    parts.append(
        f"ID: {incident.get('incident_id')}  |  Severity: {incident.get('severity')}  "
        f"|  State: {incident.get('state', 'Open')}  |  Service: {incident.get('service')}"
    )
    parts.append(
        f"Env: {incident.get('environment')} / {incident.get('region')}  "
        f"|  Team: {incident.get('owner_team')}  |  Start: {inc_start[:16]}"
    )
    parts.append(f"Alerts   : {' · '.join(incident.get('alerts', []))}")
    parts.append(f"Symptoms : {' · '.join(incident.get('symptoms', []))}")
    parts.append(f"Impacted : {' · '.join(incident.get('impacted_components', []))}")

    parts.append("\n=== DEPENDENCY PATH ===")
    parts.append("  " + " → ".join(dep_path) if dep_path else "  (unavailable)")

    parts.append("\n=== COMPONENT METRICS (latest snapshot) ===")
    parts.append(_fmt_metrics_table(component_metrics, anomalous))
    if anomalous:
        parts.append(f"  Anomalies detected on: {', '.join(anomalous.keys())}")

    parts.append("\n=== EVENTS (48 h before incident, path components) ===")
    parts.append(_fmt_events(rel_events))

    parts.append("\n=== CHANGE RECORDS (affecting impacted services) ===")
    parts.append(_fmt_changes(rel_changes))

    if candidates:
        parts.append("\n=== HISTORICAL PATTERN MATCHES ===")
        for i, c in enumerate(candidates, 1):
            fixes = ", ".join(c.get("suggested_fixes", [])[:2]) or "unknown"
            parts.append(
                f"  #{i} {c['root_cause']:<35} {c['confidence']}% confidence  "
                f"({c['matching_incident_count']} incidents)  fix: {fixes}"
            )
            if c.get("evidence"):
                ev = c["evidence"][0]
                parts.append(f"      e.g. {ev['incident_id']}: alerts={ev['alert_overlap'][:2]}")

    return "\n".join(parts)


def build_cautionary_context(
    incident: dict,
    dep_path: list[str],
    component_metrics: dict,
    anomalous: dict,
    post_fix: list[dict],
    path_alerts: list[dict],
) -> str:
    """
    Compact context string for the Cautionary RCA LLM prompt.
    Includes the applied fix, dep path, post-fix metrics, events after resolution,
    new incidents on shared components, and active alerts.
    """
    events   = _load_events()
    changes  = _load_changes()

    resolved_at = incident.get("resolved_at", "")

    # Events that happened AFTER the fix on dependency-path components
    post_events = _filter_events(
        events,
        dep_path + incident.get("impacted_components", []),
        after=resolved_at,
        limit=10,
    )
    rel_changes = _filter_changes(
        changes,
        [incident.get("service_id", ""), incident.get("service", "")] +
        incident.get("impacted_components", []),
    )

    parts: list[str] = []

    parts.append("=== RESOLVED INCIDENT ===")
    parts.append(
        f"ID: {incident.get('incident_id')}  |  Severity: {incident.get('severity')}  "
        f"|  Service: {incident.get('service')}"
    )
    parts.append(f"Root Cause   : {incident.get('root_cause', '')}")
    parts.append(f"Fix Applied  : {incident.get('fix', '')}")
    parts.append(f"Resolved At  : {resolved_at[:16]}")
    parts.append(f"Duration     : {incident.get('duration_minutes')} min")
    parts.append(f"Alerts       : {' · '.join(incident.get('alerts', []))}")
    parts.append(f"Symptoms     : {' · '.join(incident.get('symptoms', []))}")
    parts.append(f"Impacted     : {' · '.join(incident.get('impacted_components', []))}")

    parts.append("\n=== DEPENDENCY PATH (post-fix) ===")
    parts.append("  " + " → ".join(dep_path) if dep_path else "  (unavailable)")

    parts.append("\n=== COMPONENT METRICS (current snapshot) ===")
    parts.append(_fmt_metrics_table(component_metrics, anomalous))
    if anomalous:
        parts.append(f"  Anomalies detected on: {', '.join(anomalous.keys())}")

    parts.append("\n=== EVENTS AFTER FIX (path components) ===")
    parts.append(_fmt_events(post_events))

    parts.append("\n=== CHANGE RECORDS (affecting impacted services) ===")
    parts.append(_fmt_changes(rel_changes))

    if post_fix:
        parts.append("\n=== NEW INCIDENTS ON SHARED COMPONENTS (after fix) ===")
        for pf in post_fix[:5]:
            overlap = ", ".join(pf.get("overlap_components", [])[:3])
            parts.append(
                f"  {pf['incident_id']}  {pf['service']:<28}  root: {pf['root_cause']:<30}"
                f"  shared: {overlap}"
            )

    if path_alerts:
        parts.append("\n=== OPEN ALERTS ON DEPENDENCY PATH ===")
        for a in path_alerts:
            val = f"  val={a['value']}" if a.get("value") is not None else ""
            parts.append(f"  {a['title']:<35} [{a['severity']}]  entity: {a['entity_id']}{val}")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Signal-based context builder (for RCA Dashboard — no incident_id)
# ---------------------------------------------------------------------------


def build_rca_signals_context(
    alerts: list[str],
    symptoms: list[str],
    service: str,
    dep_path: list[str],
    component_metrics: dict,
    anomalous: dict,
    candidates: list[dict],
) -> str:
    """Compact LLM context built from raw signals (no incident object)."""
    from datetime import timedelta
    events  = _load_events()
    changes = _load_changes()

    window_start = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    all_components = list({*dep_path, service.lower().replace(" ", "-")})

    rel_events  = _filter_events(events, all_components, after=window_start, limit=8)
    rel_changes = _filter_changes(changes, [service] + all_components[:3])

    parts: list[str] = []

    parts.append("=== INPUT SIGNALS ===")
    parts.append(f"Service  : {service}")
    parts.append(f"Alerts   : {' · '.join(alerts) or '(none)'}")
    parts.append(f"Symptoms : {' · '.join(symptoms) or '(none)'}")

    parts.append("\n=== DEPENDENCY PATH ===")
    parts.append("  " + " → ".join(dep_path) if dep_path else "  (unavailable)")

    parts.append("\n=== COMPONENT METRICS (latest snapshot) ===")
    parts.append(_fmt_metrics_table(component_metrics, anomalous))
    if anomalous:
        parts.append(f"  Anomalies on: {', '.join(anomalous.keys())}")

    parts.append("\n=== RECENT EVENTS (48 h, path components) ===")
    parts.append(_fmt_events(rel_events))

    parts.append("\n=== CHANGE RECORDS ===")
    parts.append(_fmt_changes(rel_changes))

    if candidates:
        parts.append("\n=== HISTORICAL PATTERN MATCHES ===")
        for i, c in enumerate(candidates, 1):
            fixes = ", ".join(c.get("suggested_fixes", [])[:2]) or "unknown"
            parts.append(
                f"  #{i} {c['root_cause']:<35} {c['confidence']}%  fix: {fixes}"
            )

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


def get_incident_click_analysis(incident_id: str) -> dict:
    incidents = _load_incidents()
    incident = next(
        (i for i in incidents if i.get("incident_id") == incident_id or i.get("id") == incident_id),
        None,
    )
    if not incident:
        return {"type": "error", "error": "Incident not found"}

    state = incident.get("state", "Open")

    if state == "Closed":
        return {
            "type": "fix_summary",
            "incident_id": incident_id,
            "state": state,
            "root_cause": incident.get("root_cause", ""),
            "applied_fix": incident.get("fix", ""),
            "resolution_notes": incident.get("resolution_notes", ""),
            "resolved_at": incident.get("resolved_at", ""),
            "duration_minutes": incident.get("duration_minutes"),
            "impacted_components": incident.get("impacted_components", []),
            "change_records": incident.get("change_records", []),
            "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
        }

    if state == "Resolved":
        from app.agents.cautionery_rca_agent import CautionaryRCAAgent
        return CautionaryRCAAgent().analyze_on_click(incident_id)

    from app.agents.rca_agent import RCAAgent
    return RCAAgent().analyze_on_click(incident_id)
