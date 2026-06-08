"""
Advanced early failure detection engine.

Improvements over v2:
- Uses all open/acknowledged alerts (not a truncated subset)
- Fuzzy alert-title matching via canonical aliases
- Pattern coverage scoring with progression stages
- Temporal clustering and entity proximity weighting
- Deduplicated, service-ranked output with timeline metadata
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.data_store import read_json

# Pin "now" to dataset time for consistent demo correlation
DATASET_NOW = datetime(2026, 6, 8, 15, 38, 24, tzinfo=timezone.utc)

TRACKED_SERVICES = [
    "payment-authorization",
    "settlement-processing",
    "fraud-detection",
    "api-gateway-services",
    "merchant-services",
    "partner-integrations",
]

# Map variant alert titles to a shared canonical key
ALERT_CANONICAL: dict[str, str] = {
    "api-error-spike": "api-error-spike",
    "error-rate-spike": "api-error-spike",
    "error-spike": "api-error-spike",
    "cpu-saturation": "cpu-saturation",
    "memory-pressure": "memory-pressure",
    "connection-pool-exhaustion": "connection-pool-exhaustion",
    "disk-i-o-saturation": "disk-i-o-saturation",
    "disk-io-saturation": "disk-i-o-saturation",
    "queue-buildup": "queue-buildup",
    "queue-buildup-alert": "queue-buildup",
    "high-latency": "network-latency",
    "network-latency-alert": "network-latency",
    "latency-spike": "network-latency",
    "packet-loss": "packet-loss",
    "network-packet-loss": "packet-loss",
    "pod-crash-loop": "pod-crash-loop",
    "certificate-expiry-warning": "certificate-expiry",
    "certificate-expiry": "certificate-expiry",
}

SEVERITY_WEIGHT = {"critical": 1.0, "warning": 0.75, "info": 0.5}

REMEDIATION_HINTS: dict[str, list[str]] = {
    "api-error-spike": [
        "Roll back the most recent deployment on the affected service",
        "Enable circuit breaker and shed non-critical traffic",
        "Inspect error logs for 5xx spike root signature",
    ],
    "cpu-saturation": [
        "Horizontally scale the saturated workload",
        "Identify CPU-heavy pods and restart or isolate outliers",
        "Throttle batch jobs consuming shared compute",
    ],
    "memory-pressure": [
        "Restart pods with climbing heap usage",
        "Increase memory limits or scale replicas",
        "Clear in-process caches and verify for leaks",
    ],
    "connection-pool-exhaustion": [
        "Increase pool size temporarily and drain idle connections",
        "Kill long-running DB queries blocking the pool",
        "Fail over read traffic to a replica",
    ],
    "disk-i-o-saturation": [
        "Archive or purge hot partition logs",
        "Move write-heavy workloads to SSD-backed volumes",
        "Throttle bulk ingestion until IOPS recover",
    ],
    "queue-buildup": [
        "Scale consumer replicas for the backed-up topic",
        "Purge poison messages from the dead-letter queue",
        "Increase partition count if producer throughput exceeds consumers",
    ],
    "network-latency": [
        "Route traffic around degraded network paths",
        "Check cross-AZ latency and colocate hot callers",
        "Tune timeout and retry budgets to prevent retry storms",
    ],
    "packet-loss": [
        "Verify NIC/driver health on affected hosts",
        "Shift traffic to alternate availability zone",
        "Inspect firewall and load balancer connection limits",
    ],
    "pod-crash-loop": [
        "Rollback the crashing deployment immediately",
        "Inspect crash-loop pod logs and OOM events",
        "Disable auto-scaling until stability is restored",
    ],
    "certificate-expiry": [
        "Renew TLS certificate on the affected endpoint",
        "Deploy updated cert bundle to all ingress nodes",
        "Validate partner webhook TLS handshakes",
    ],
}
  
PLAYBOOKS: dict[str, list[str]] = {
    "payment-authorization": [
        "Failover PostgreSQL database to hot-standby replica",
        "Scale auth-service Kubernetes deployment to 5 replicas",
        "Clear cached tokens in Redis cluster",
        "Inspect identity-service network latency metrics",
    ],
    "settlement-processing": [
        "Increase partitions on Kafka settlement topics",
        "Restart settlement-service consumer pods",
        "Flush RabbitMQ dead-letter queues",
        "Check DB storage-cluster-1 capacity limits",
    ],
    "fraud-detection": [
        "Increase Cassandra read timeout settings",
        "Clear ML-scoring service memory cache",
        "Roll back recent ml-scoring deployment regression",
        "Temporarily route audit writes to fallback queue",
    ],
    "api-gateway-services": [
        "Enable rate limiting on API gateway routes",
        "Scale external load balancer ingress traffic limits",
        "Roll back api-gateway config settings",
        "Audit firewall rule changes on rack-01",
    ],
    "merchant-services": [
        "Warm up merchant-api database connections pool",
        "Restart merchant-portal pods",
        "Inspect PostgreSQL query execution plans",
    ],
    "partner-integrations": [
        "Renew partner API client certificate",
        "Scale webhook-handler pods",
        "Route partner traffic to secondary regional endpoints",
    ],
}


def _slug(text: str) -> str:
    return text.lower().replace(" ", "-").replace("/", "-").replace("_", "-")


def _canonical_alert(title: str) -> str:
    slug = _slug(title)
    return ALERT_CANONICAL.get(slug, slug)


def _parse_ts(ts_str: str) -> datetime | None:
    if not ts_str:
        return None
    try:
        ts_str = ts_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _minutes_ago(ts_str: str) -> float:
    dt = _parse_ts(ts_str)
    if not dt:
        return 9999.0
    return max(0.0, (DATASET_NOW - dt).total_seconds() / 60.0)


def _hours_ago(ts_str: str) -> float:
    return _minutes_ago(ts_str) / 60.0


def get_contained_components(service_id: str, edges: list[dict]) -> set[str]:
    components = {service_id}
    queue = [service_id]
    while queue:
        curr = queue.pop(0)
        for edge in edges:
            if edge.get("source") == curr and edge.get("relationship") == "contains":
                tgt = edge.get("target")
                if tgt and tgt not in components:
                    components.add(tgt)
                    queue.append(tgt)
    return components


def get_downstream_dependencies(start_nodes: set[str], edges: list[dict], max_depth: int = 3) -> set[str]:
    dependencies: set[str] = set()
    queue = [(node, 0) for node in start_nodes]
    visited = set(start_nodes)
    while queue:
        curr, depth = queue.pop(0)
        if depth > 0:
            dependencies.add(curr)
        if depth >= max_depth:
            continue
        for edge in edges:
            if edge.get("source") == curr and edge.get("type") == "dependency":
                tgt = edge.get("target")
                if tgt and tgt not in visited:
                    visited.add(tgt)
                    queue.append((tgt, depth + 1))
    return dependencies


def find_propagation_path(alerting_entity: str, service_comps: set[str], edges: list[dict]) -> list[str]:
    if alerting_entity in service_comps:
        return [alerting_entity]

    queue: list[tuple[str, list[str]]] = [(alerting_entity, [alerting_entity])]
    visited = {alerting_entity}

    while queue:
        curr, path = queue.pop(0)
        if curr in service_comps:
            return path
        for edge in edges:
            if edge.get("target") == curr:
                src = edge.get("source")
                if src and src not in visited:
                    visited.add(src)
                    queue.append((src, path + [src]))
    return [alerting_entity]


def _risk_level(confidence: int) -> str:
    if confidence >= 85:
        return "Critical"
    if confidence >= 70:
        return "High"
    if confidence >= 50:
        return "Medium"
    return "Low"


def _progression_stage(match_ratio: float, confidence: int) -> str:
    if match_ratio >= 1.0 and confidence >= 75:
        return "imminent"
    if match_ratio >= 0.5 or confidence >= 55:
        return "developing"
    return "watch"


def _pattern_label(pattern_id: str, pattern_alerts: list[str]) -> str:
    if len(pattern_alerts) >= 2:
        return f"{pattern_alerts[0]} + {pattern_alerts[1]}"
    if pattern_alerts:
        return pattern_alerts[0]
    return pattern_id.replace("pattern-", "").replace("|", " / ")[:48]


def _best_matching_alert(
    pattern_alert: str,
    active_alerts: list[dict],
    service_comps: set[str],
    service_deps: set[str],
) -> tuple[dict | None, float]:
    target = _canonical_alert(pattern_alert)
    best_alert: dict | None = None
    best_score = -1.0

    for alert in active_alerts:
        if _canonical_alert(alert.get("title", "")) != target:
            continue

        entity = alert.get("entity_id", "")
        if entity in service_comps:
            proximity = 1.0
        elif entity in service_deps:
            proximity = 0.8
        else:
            proximity = 0.55

        sev = alert.get("severity", "warning").lower()
        sev_w = SEVERITY_WEIGHT.get(sev, 0.6)

        age_min = _minutes_ago(alert.get("triggered_at", ""))
        recency = 1.0 if age_min <= 120 else 0.85 if age_min <= 360 else 0.7

        score = proximity * sev_w * recency
        if score > best_score:
            best_score = score
            best_alert = alert

    return best_alert, max(best_score, 0.0)


def _correlated_changes(
    expected_service: str,
    service_comps: set[str],
) -> tuple[list[dict], float, float]:
    changes = read_json("changes/change_records.json").get("changes", [])
    deployments = read_json("changes/deployments.json").get("deployments", [])
    correlated: list[dict] = []
    deploy_mult = 1.0
    change_mult = 1.0

    for d in deployments:
        svc = d.get("service", "")
        if svc != expected_service and svc not in service_comps:
            continue
        if _hours_ago(d.get("deployed_at", "")) > 24:
            continue

        status = d.get("status", "")
        if status == "failed":
            deploy_mult = max(deploy_mult, 1.35)
        elif status == "rolled_back":
            deploy_mult = max(deploy_mult, 1.2)
        else:
            deploy_mult = max(deploy_mult, 1.1)

        correlated.append({
            "type": "deployment",
            "id": d.get("id"),
            "title": f"Deployment of {svc} {d.get('version', '')}".strip(),
            "status": status,
            "time": d.get("deployed_at"),
            "severity": "high" if status == "failed" else "medium",
            "hours_ago": round(_hours_ago(d.get("deployed_at", "")), 1),
        })

    for c in changes:
        affected = c.get("affected_services", [])
        if expected_service not in affected and not any(comp in affected for comp in service_comps):
            continue
        if _hours_ago(c.get("start_time", "")) > 24:
            continue

        risk = (c.get("risk") or "medium").lower()
        if risk == "high":
            change_mult = max(change_mult, 1.25)
        elif risk == "medium":
            change_mult = max(change_mult, 1.15)
        else:
            change_mult = max(change_mult, 1.05)

        correlated.append({
            "type": "change_record",
            "id": c.get("id"),
            "title": c.get("title"),
            "status": c.get("status"),
            "time": c.get("start_time"),
            "severity": risk,
            "hours_ago": round(_hours_ago(c.get("start_time", "")), 1),
        })

    correlated.sort(key=lambda x: x.get("hours_ago", 999))
    return correlated[:4], deploy_mult, change_mult


def _compute_eta(pattern: dict, match_ratio: float, matched_details: list[dict]) -> int:
    base = float(pattern.get("avg_time_to_incident_minutes", 90))
    # Fuller pattern match → incident tends to arrive sooner
    eta = base * (1.15 - (0.45 * match_ratio))

    critical_count = sum(1 for a in matched_details if a.get("severity") == "critical")
    if critical_count >= 2:
        eta *= 0.65
    elif critical_count == 1:
        eta *= 0.82

    return max(5, min(180, round(eta)))


def _build_detection(
    pattern: dict,
    active_alerts: list[dict],
    dep_edges: list[dict],
) -> dict | None:
    pattern_alerts: list[str] = pattern.get("alerts", [])
    if not pattern_alerts:
        return None

    expected_service = pattern.get("expected_service", "payment-authorization")
    service_comps = get_contained_components(expected_service, dep_edges)
    service_deps = get_downstream_dependencies(service_comps, dep_edges)

    matched_details: list[dict] = []
    unmatched_alerts: list[str] = []
    threat_scores: list[float] = []
    propagation_paths: dict[str, list[str]] = {}

    for pat_alert in pattern_alerts:
        alert_obj, score = _best_matching_alert(pat_alert, active_alerts, service_comps, service_deps)
        if alert_obj:
            entity = alert_obj.get("entity_id", "")
            age_min = round(_minutes_ago(alert_obj.get("triggered_at", "")), 1)
            matched_details.append({
                "id": alert_obj.get("id"),
                "title": alert_obj.get("title"),
                "pattern_alert": pat_alert,
                "entity_id": entity,
                "severity": alert_obj.get("severity", "warning"),
                "description": alert_obj.get("description"),
                "value": alert_obj.get("value"),
                "threshold": alert_obj.get("threshold"),
                "triggered_at": alert_obj.get("triggered_at"),
                "metric": alert_obj.get("metric"),
                "minutes_ago": age_min,
                "match_score": round(score * 100),
            })
            threat_scores.append(score)
            propagation_paths[entity] = find_propagation_path(entity, service_comps, dep_edges)
        else:
            unmatched_alerts.append(pat_alert)

    num_matched = len(matched_details)
    if num_matched == 0:
        return None

    total_alerts = len(pattern_alerts)
    match_ratio = num_matched / total_alerts
    avg_threat = sum(threat_scores) / num_matched

    # Require meaningful signal: single-alert patterns need strong threat; multi-alert need ≥1 match
    if total_alerts >= 2 and match_ratio < 0.5 and avg_threat < 0.7:
        return None

    correlated, deploy_mult, change_mult = _correlated_changes(expected_service, service_comps)

    base_confidence = float(pattern.get("confidence", 0.7))
    coverage_boost = 0.55 + (0.45 * match_ratio)
    raw = base_confidence * 100 * coverage_boost * avg_threat * deploy_mult * change_mult

    # Temporal cluster: alerts within 3h of each other
    ages = [d["minutes_ago"] for d in matched_details]
    if len(ages) >= 2 and (max(ages) - min(ages)) <= 180:
        raw *= 1.12

    min_confidence = 28 + (match_ratio * 52)
    confidence = max(min_confidence, min(99, round(raw)))

    risk = _risk_level(confidence)
    stage = _progression_stage(match_ratio, confidence)
    eta = _compute_eta(pattern, match_ratio, matched_details)

    severity_breakdown = {"critical": 0, "warning": 0, "info": 0}
    for d in matched_details:
        sev = d.get("severity", "warning").lower()
        if sev in severity_breakdown:
            severity_breakdown[sev] += 1

    svc_name = expected_service.replace("-", " ").title()
    playbook = PLAYBOOKS.get(expected_service, pattern.get("recommended_actions", []))

    return {
        "pattern_id": pattern["id"],
        "pattern_label": _pattern_label(pattern["id"], pattern_alerts),
        "status": "probable_incident_forming",
        "progression_stage": stage,
        "confidence": confidence,
        "risk_level": risk,
        "match_coverage": {
            "matched": num_matched,
            "total": total_alerts,
            "percent": round(match_ratio * 100),
            "unmatched_alerts": unmatched_alerts,
        },
        "matched_alerts": [d["title"] for d in matched_details],
        "matched_alerts_details": matched_details,
        "propagation_paths": propagation_paths,
        "expected_symptoms": pattern.get("symptoms", []),
        "expected_impacted_service": svc_name,
        "expected_impacted_service_id": expected_service,
        "estimated_time_to_incident_minutes": eta,
        "occurrence_count_historical": pattern.get("occurrence_count", 0),
        "recommended_actions": playbook,
        "evidence_collection_plan": pattern.get(
            "evidence_collection_plan",
            [
                f"Collect CPU/memory metrics for {expected_service}",
                "Check queue depth on kafka-cluster",
                "Review auth-service latency trends",
                "Pull recent change records (last 4 hours)",
                "Snapshot dependency path to postgres-cluster",
            ],
        ),
        "correlated_changes": correlated,
        "severity_breakdown": severity_breakdown,
        "_sort_key": (confidence, match_ratio, -eta),
    }


def _dedupe_detections(detections: list[dict]) -> list[dict]:
    """Keep the strongest detection per service+pattern signature."""
    seen: dict[str, dict] = {}
    for det in detections:
        svc = det["expected_impacted_service_id"]
        sig = f"{svc}|{det['match_coverage']['percent']}|{','.join(sorted(det['matched_alerts']))}"
        existing = seen.get(svc)
        if not existing or det["_sort_key"] > existing["_sort_key"]:
            seen[svc] = det
        elif det["_sort_key"] == existing["_sort_key"] and det["confidence"] > existing["confidence"]:
            seen[svc] = det

    result = list(seen.values())
    result.sort(key=lambda x: x["_sort_key"], reverse=True)
    for d in result:
        d.pop("_sort_key", None)
    return result


def _service_risk_summary(
    detections: list[dict],
    active_alerts: list[dict],
    dep_edges: list[dict],
) -> list[dict]:
    summary: list[dict] = []

    for svc in TRACKED_SERVICES:
        svc_name = svc.replace("-", " ").title()
        svc_detections = [d for d in detections if d["expected_impacted_service_id"] == svc]

        if svc_detections:
            top = svc_detections[0]
            max_conf = top["confidence"]
            risk = top["risk_level"]
            active_threats = sum(d["match_coverage"]["matched"] for d in svc_detections)
            eta = min(d["estimated_time_to_incident_minutes"] for d in svc_detections)
            stage = top["progression_stage"]
        else:
            comps = get_contained_components(svc, dep_edges)
            deps = get_downstream_dependencies(comps, dep_edges)
            svc_alerts = [a for a in active_alerts if a.get("entity_id") in comps]
            dep_alerts = [a for a in active_alerts if a.get("entity_id") in deps]

            if svc_alerts:
                crit = sum(1 for a in svc_alerts if a.get("severity") == "critical")
                max_conf = min(48, 30 + crit * 6 + len(svc_alerts) * 2)
                risk = "Medium" if max_conf >= 40 else "Low"
                active_threats = len(svc_alerts)
                eta = 60
                stage = "watch"
            elif dep_alerts:
                max_conf = min(32, 18 + len(dep_alerts) * 2)
                risk = "Low"
                active_threats = len(dep_alerts)
                eta = 120
                stage = "watch"
            else:
                max_conf = 4
                risk = "Healthy"
                active_threats = 0
                eta = 0
                stage = "healthy"

        summary.append({
            "service_id": svc,
            "service_name": svc_name,
            "risk_level": risk,
            "confidence": max_conf,
            "active_threats": active_threats,
            "eta_minutes": eta,
            "progression_stage": stage,
        })

    summary.sort(key=lambda x: x["confidence"], reverse=True)
    return summary


def _remediation_for_alert(alert: dict) -> list[str]:
    canon = _canonical_alert(alert.get("title", ""))
    hints = list(REMEDIATION_HINTS.get(canon, []))
    entity = alert.get("entity_id", "")
    if entity:
        hints.append(f"Inspect metrics and logs for {entity}")
    if alert.get("severity") == "critical":
        hints.insert(0, "Escalate to on-call — critical threshold breached")
    return hints[:4]


def _link_alert_to_detection(alert: dict, detections: list[dict]) -> dict | None:
    canon = _canonical_alert(alert.get("title", ""))
    for det in detections:
        for detail in det.get("matched_alerts_details", []):
            if _canonical_alert(detail.get("title", "")) == canon:
                return {
                    "pattern_id": det["pattern_id"],
                    "service": det["expected_impacted_service"],
                    "confidence": det["confidence"],
                    "eta_minutes": det["estimated_time_to_incident_minutes"],
                }
        for matched in det.get("matched_alerts", []):
            if _canonical_alert(matched) == canon:
                return {
                    "pattern_id": det["pattern_id"],
                    "service": det["expected_impacted_service"],
                    "confidence": det["confidence"],
                    "eta_minutes": det["estimated_time_to_incident_minutes"],
                }
    return None


def _build_alerts_feed(active_alerts: list[dict], detections: list[dict]) -> list[dict]:
    sev_rank = {"critical": 3, "warning": 2, "info": 1}
    feed: list[dict] = []

    for alert in active_alerts:
        sev = alert.get("severity", "warning").lower()
        link = _link_alert_to_detection(alert, detections)
        feed.append({
            "id": alert.get("id"),
            "title": alert.get("title"),
            "severity": sev,
            "status": alert.get("status"),
            "entity_id": alert.get("entity_id"),
            "description": alert.get("description"),
            "metric": alert.get("metric"),
            "value": alert.get("value"),
            "threshold": alert.get("threshold"),
            "triggered_at": alert.get("triggered_at"),
            "minutes_ago": round(_minutes_ago(alert.get("triggered_at", "")), 1),
            "remediation_hints": _remediation_for_alert(alert),
            "linked_detection": link,
        })

    feed.sort(
        key=lambda x: (sev_rank.get(x["severity"], 0), -x.get("minutes_ago", 0)),
        reverse=True,
    )
    return feed


def _generate_clearance_plan(
    critical_feed: list[dict],
    detections: list[dict],
) -> dict[str, Any]:
    """Structured clearance plan for critical signals (serves AI panel without LLM latency)."""
    if not critical_feed:
        return {
            "summary": "No critical alerts require immediate clearance.",
            "priority_actions": [],
            "per_alert_actions": [],
            "avoidance_steps": ["Continue monitoring warning-level signals", "Review change calendar for next 4h"],
        }

    priority: list[str] = []
    per_alert: list[dict] = []
    seen: set[str] = set()

    for alert in critical_feed[:8]:
        hints = alert.get("remediation_hints", [])
        per_alert.append({
            "alert_id": alert.get("id"),
            "title": alert.get("title"),
            "entity_id": alert.get("entity_id"),
            "actions": hints,
        })
        for h in hints:
            if h not in seen:
                seen.add(h)
                priority.append(h)

    for det in detections:
        if det.get("progression_stage") == "imminent":
            svc = det.get("expected_impacted_service")
            priority.insert(0, f"Pre-emptively execute playbook for {svc} (ETA {det.get('estimated_time_to_incident_minutes')}m)")
            for action in det.get("recommended_actions", [])[:2]:
                if action not in seen:
                    seen.add(action)
                    priority.append(action)

    return {
        "summary": (
            f"{len(critical_feed)} critical signals detected. "
            f"Clear highest-severity alerts on impacted entities first to break precursor chains."
        ),
        "priority_actions": priority[:6],
        "per_alert_actions": per_alert,
        "avoidance_steps": [
            "Freeze non-essential deployments for affected services",
            "Enable enhanced monitoring on linked detection patterns",
            "Pre-stage incident bridge and notify service owners",
            "Validate recent config changes in the last 4 hours",
        ],
    }


def _active_conditions(active_alerts: list[dict]) -> list[dict]:
    """Grouped current conditions with severity for the dashboard strip."""
    by_title: dict[str, dict] = {}
    for alert in active_alerts:
        title = alert.get("title", "Unknown")
        canon = _canonical_alert(title)
        entry = by_title.get(canon)
        sev = alert.get("severity", "warning").lower()
        if not entry:
            by_title[canon] = {
                "title": title,
                "canonical": canon,
                "count": 1,
                "severity": sev,
                "entities": [alert.get("entity_id", "")],
            }
        else:
            entry["count"] += 1
            entity = alert.get("entity_id", "")
            if entity and entity not in entry["entities"]:
                entry["entities"].append(entity)
            if SEVERITY_WEIGHT.get(sev, 0) > SEVERITY_WEIGHT.get(entry["severity"], 0):
                entry["severity"] = sev

    items = list(by_title.values())
    items.sort(
        key=lambda x: (SEVERITY_WEIGHT.get(x["severity"], 0), x["count"]),
        reverse=True,
    )
    return items[:12]


def analyze_early_detection(current_alerts: list[str] | None = None) -> dict[str, Any]:
    kg = read_json("rca/knowledge_graph.json") or {"nodes": [], "edges": [], "pattern_library": []}
    open_alerts = read_json("monitoring/alerts.json").get("alerts", [])
    dep_edges = (read_json("dependencies/dependency_graph.json") or {}).get("edges", [])
    patterns = kg.get("pattern_library", [])

    active_alerts = [a for a in open_alerts if a.get("status") in ("open", "acknowledged")]

    if current_alerts:
        allowed = {_canonical_alert(t) for t in current_alerts}
        active_alerts = [
            a for a in active_alerts if _canonical_alert(a.get("title", "")) in allowed
        ]
        condition_titles = current_alerts
    else:
        condition_titles = sorted({a["title"] for a in active_alerts})

    raw_detections: list[dict] = []
    for pattern in patterns:
        det = _build_detection(pattern, active_alerts, dep_edges)
        if det:
            raw_detections.append(det)

    detections = _dedupe_detections(raw_detections)
    service_risk_summary = _service_risk_summary(detections, active_alerts, dep_edges)
    conditions = _active_conditions(active_alerts)

    critical_alerts = sum(1 for a in active_alerts if a.get("severity") == "critical")
    imminent = sum(1 for d in detections if d.get("progression_stage") == "imminent")

    alerts_feed = _build_alerts_feed(active_alerts, detections)
    critical_feed = [a for a in alerts_feed if a["severity"] == "critical"]
    clearance_plan = _generate_clearance_plan(critical_feed, detections)

    return {
        "current_conditions": condition_titles,
        "active_conditions": conditions,
        "active_alerts_feed": alerts_feed,
        "critical_alerts_feed": critical_feed,
        "clearance_plan": clearance_plan,
        "detections": detections[:8],
        "total_patterns_evaluated": len(patterns),
        "service_risk_summary": service_risk_summary,
        "summary": {
            "active_alerts": len(active_alerts),
            "critical_alerts": critical_alerts,
            "patterns_matched": len(detections),
            "imminent_threats": imminent,
            "highest_risk_service": service_risk_summary[0]["service_name"] if service_risk_summary else None,
            "soonest_eta_minutes": min(
                (d["estimated_time_to_incident_minutes"] for d in detections),
                default=0,
            ),
        },
        "analysis_timestamp": DATASET_NOW.isoformat(),
    }


def detect_early_failures_v2(current_alerts: list[str] | None = None) -> dict[str, Any]:
    """Backward-compatible entry point used by the intelligence service."""
    return analyze_early_detection(current_alerts)
