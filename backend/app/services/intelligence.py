"""Core intelligence services for RCA, blast radius, early detection, copilot."""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any

from app.data_store import read_json


def _slug(text: str) -> str:
    return text.lower().replace(" ", "-").replace("/", "-")


def _load_incidents() -> list[dict]:
    data = read_json("incidents/service_now_incidents.json")
    return data.get("incidents", [])


def _load_knowledge_graph() -> dict:
    return read_json("rca/knowledge_graph.json") or {"nodes": [], "edges": [], "pattern_library": []}


def _load_dependency_edges() -> list[dict]:
    data = read_json("dependencies/dependency_graph.json")
    return data.get("edges", [])


def _load_changes() -> list[dict]:
    data = read_json("changes/change_records.json")
    return data.get("changes", [])


def _load_deployments() -> list[dict]:
    data = read_json("changes/deployments.json")
    return data.get("deployments", [])


def _load_alerts() -> list[dict]:
    data = read_json("monitoring/alerts.json")
    return data.get("alerts", [])


class KnowledgeGraphService:
    def get_graph(self) -> dict:
        return _load_knowledge_graph()

    def get_stats(self) -> dict:
        kg = _load_knowledge_graph()
        return kg.get("stats", {})


def analyze_rca(
    alerts: list[str],
    symptoms: list[str],
    service: str | None = None,
    time_window_hours: int = 24,
    environment: str | None = None,
) -> dict:
    incidents = _load_incidents()
    kg = _load_knowledge_graph()
    changes = _load_changes()
    dep_edges = _load_dependency_edges()

    scores: dict[str, dict] = defaultdict(lambda: {
        "score": 0.0, "matching_incidents": [], "fixes": set(), "evidence": [],
    })

    alert_set = {a.lower() for a in alerts}
    symptom_set = {s.lower() for s in symptoms}

    for inc in incidents:
        inc_alerts = {a.lower() for a in inc.get("alerts", [])}
        inc_symptoms = {s.lower() for s in inc.get("symptoms", [])}
        alert_match = len(alert_set & inc_alerts) / max(len(alert_set), 1)
        symptom_match = len(symptom_set & inc_symptoms) / max(len(symptom_set), 1) if symptom_set else 0.5

        if service:
            svc_match = 1.0 if (
                service.lower() in inc.get("service", "").lower()
                or service.lower() in inc.get("service_id", "").lower()
            ) else 0.3
        else:
            svc_match = 1.0

        if environment and inc.get("environment") != environment:
            svc_match *= 0.7

        combined = (alert_match * 0.45 + symptom_match * 0.35 + svc_match * 0.2)
        if combined < 0.25:
            continue

        rc = inc["root_cause"]
        entry = scores[rc]
        entry["score"] += combined * inc.get("confidence_training_value", 0.85)
        entry["matching_incidents"].append(inc["incident_id"])
        entry["fixes"].add(inc["fix"])
        entry["evidence"].append({
            "incident_id": inc["incident_id"],
            "title": inc.get("title", ""),
            "alert_overlap": list(alert_set & inc_alerts),
            "symptom_overlap": list(symptom_set & inc_symptoms),
        })

    # Boost from knowledge graph edges
    for edge in kg.get("edges", []):
        if edge["relationship"] in ("TRIGGERS", "CAUSED_BY", "RECURS_WITH"):
            src_label = edge["source"].split("-", 1)[-1].replace("-", " ")
            tgt_label = edge["target"].split("-", 1)[-1].replace("-", " ")
            if edge["relationship"] == "CAUSED_BY" and "incident-" in edge["source"]:
                rc_label = tgt_label
                for alert in alerts:
                    if _slug(alert) in edge.get("incident_refs", []) or alert.lower() in src_label:
                        if rc_label.title() in scores or any(rc_label in k.lower() for k in scores):
                            pass
            if edge["relationship"] == "TRIGGERS":
                for alert in alerts:
                    if _slug(alert) in edge["source"]:
                        for symptom in symptoms:
                            if _slug(symptom) in edge["target"]:
                                for rc in scores:
                                    scores[rc]["score"] += edge.get("confidence", 0.5) * 0.1

    ranked = sorted(scores.items(), key=lambda x: x[1]["score"], reverse=True)
    max_score = ranked[0][1]["score"] if ranked else 1

    candidates = []
    for rc, data in ranked[:8]:
        confidence = min(99, round((data["score"] / max_score) * 95))
        candidates.append({
            "root_cause": rc,
            "confidence": confidence,
            "matching_incident_count": len(data["matching_incidents"]),
            "similar_incidents": data["matching_incidents"][:5],
            "suggested_fixes": list(data["fixes"])[:3],
            "evidence": data["evidence"][:3],
        })

    # Related checks
    related_alerts = list({a for inc in incidents for a in inc.get("alerts", [])
                           if any(_slug(x) in {_slug(y) for y in alerts} for x in inc.get("alerts", []))})[:8]
    related_symptoms = list({s for inc in incidents for s in inc.get("symptoms", [])
                             if any(_slug(x) in {_slug(y) for y in symptoms} for x in inc.get("symptoms", []))})[:8]

    recent_changes = [
        {
            "id": c["id"],
            "title": c["title"],
            "risk": c.get("risk", "medium"),
            "status": c.get("status", ""),
            "affected_services": c.get("affected_services", []),
        }
        for c in changes[:10]
    ]

    # Dependency path to suspected component
    suspected_component = None
    dep_path = []
    if candidates and ranked:
        top_incidents = [
            inc for inc in incidents
            if inc["incident_id"] in ranked[0][1]["matching_incidents"]
        ]
        if top_incidents:
            suspected_component = top_incidents[0].get("impacted_components", [None])[0]
            if suspected_component:
                dep_path = _trace_dependency_path(suspected_component, dep_edges)

    return {
        "input": {
            "alerts": alerts,
            "symptoms": symptoms,
            "service": service,
            "time_window_hours": time_window_hours,
            "environment": environment,
        },
        "root_cause_candidates": candidates,
        "similar_historical_incidents": [
            {
                "incident_id": inc["incident_id"],
                "title": inc.get("title", ""),
                "root_cause": inc["root_cause"],
                "fix": inc["fix"],
                "severity": inc.get("severity", ""),
                "resolved_at": inc.get("resolved_at", ""),
            }
            for inc in incidents
            if any(c["root_cause"] == inc["root_cause"] for c in candidates[:3])
        ][:8],
        "suggested_fix_playbook": candidates[0]["suggested_fixes"] if candidates else [],
        "related_alerts_to_check": related_alerts or alerts,
        "related_symptoms_to_check": related_symptoms or symptoms,
        "relevant_recent_changes": recent_changes,
        "dependency_path": dep_path,
        "suspected_component": suspected_component,
        "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _trace_dependency_path(component: str, edges: list[dict], max_depth: int = 6) -> list[str]:
    path = [component]
    current = component
    visited = {component}
    for _ in range(max_depth):
        found = False
        for e in edges:
            if e["target"] == current and e["source"] not in visited:
                path.insert(0, e["source"])
                visited.add(e["source"])
                current = e["source"]
                found = True
                break
        if not found:
            break
    return path


def analyze_blast_radius(
    alerts: list[str],
    symptoms: list[str],
    source_component: str | None = None,
    service: str | None = None,
) -> dict:
    incidents = _load_incidents()
    dep_edges = _load_dependency_edges()

    # Determine source from RCA-like matching if not provided
    if not source_component:
        rca = analyze_rca(alerts, symptoms, service)
        source_component = rca.get("suspected_component") or "auth-service"

    # BFS downstream on dependency graph
    downstream = _bfs_downstream(source_component, dep_edges)
    upstream = _bfs_upstream(source_component, dep_edges)

    # Historical blast patterns
    historical_impacted: set[str] = set()
    for inc in incidents:
        inc_alerts = {a.lower() for a in inc.get("alerts", [])}
        if any(a.lower() in inc_alerts for a in alerts):
            historical_impacted.update(inc.get("impacted_components", []))
            historical_impacted.update(inc.get("impacted_services", []))

    currently_impacted = list(set(downstream[:5] + [source_component]))
    likely_downstream = downstream[1:8]
    infra_components = [c for c in downstream + upstream if "cluster" in c or "lb" in c or "k8s" in c][:6]

    # Determine localized vs systemic
    is_systemic = len(downstream) > 4 or any("gateway" in c for c in downstream)

    # Business impact score
    service_impact_map = {
        "payment-authorization": 95, "settlement-processing": 90,
        "fraud-detection": 75, "merchant-services": 70,
        "api-gateway-services": 85, "partner-integrations": 60,
    }
    biz_score = 50
    for svc, score in service_impact_map.items():
        if service and svc in service.lower().replace(" ", "-"):
            biz_score = score
            break
    if is_systemic:
        biz_score = min(100, biz_score + 20)

    regions = list({inc.get("region", "us-east") for inc in incidents[:20]})[:3]
    customer_estimate = biz_score * 50 if is_systemic else biz_score * 10

    severity = "P1" if biz_score >= 85 else "P2" if biz_score >= 70 else "P3"

    return {
        "input": {"alerts": alerts, "symptoms": symptoms, "source_component": source_component, "service": service},
        "currently_impacted_services": currently_impacted,
        "likely_downstream_services": likely_downstream,
        "impacted_infrastructure": infra_components,
        "historically_impacted": list(historical_impacted)[:10],
        "impacted_customers_estimate": int(customer_estimate),
        "impacted_regions": regions,
        "issue_scope": "systemic" if is_systemic else "localized",
        "business_impact_score": biz_score,
        "severity_recommendation": severity,
        "blast_radius_nodes": list(set(downstream + upstream + [source_component])),
        "highlight_edges": [
            {"source": source_component, "target": t}
            for t in downstream[:6]
        ],
        "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _bfs_downstream(start: str, edges: list[dict], max_depth: int = 5) -> list[str]:
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


def _bfs_upstream(start: str, edges: list[dict], max_depth: int = 5) -> list[str]:
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


def detect_early_failures(current_alerts: list[str] | None = None) -> dict:
    """Delegate to the advanced dependency-aware detection engine."""
    from app.services.early_detection import detect_early_failures_v2
    return detect_early_failures_v2(current_alerts)


INVESTIGATION_STEPS = [
    "issue_detected",
    "ai_creates_investigation",
    "collect_metrics",
    "collect_alerts",
    "review_logs",
    "review_change_history",
    "build_dependency_path",
    "query_rca_graph",
    "identify_root_cause_candidates",
    "predict_blast_radius",
    "recommend_fix",
    "awaiting_human_approval",
    "execute_remediation",
    "completed",
]

STEP_LABELS = {
    "issue_detected": "Issue Detected",
    "ai_creates_investigation": "AI Creates Investigation",
    "collect_metrics": "Collect Metrics",
    "collect_alerts": "Collect Alerts",
    "review_logs": "Review Logs",
    "review_change_history": "Review Change History",
    "build_dependency_path": "Build Dependency Path",
    "query_rca_graph": "Query RCA Graph",
    "identify_root_cause_candidates": "Identify Root Cause Candidates",
    "predict_blast_radius": "Predict Blast Radius",
    "recommend_fix": "Recommend Fix",
    "awaiting_human_approval": "Human Approval",
    "execute_remediation": "Execute Remediation (Simulated)",
    "completed": "Investigation Complete",
}

_investigations: dict[str, dict] = {}


def create_investigation(alerts: list[str], symptoms: list[str], service: str | None = None) -> dict:
    import uuid
    inv_id = f"INV-{uuid.uuid4().hex[:8]}"
    rca = analyze_rca(alerts, symptoms, service)
    blast = analyze_blast_radius(alerts, symptoms, service=service)

    investigation = {
        "id": inv_id,
        "status": "in_progress",
        "current_step": "issue_detected",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input": {"alerts": alerts, "symptoms": symptoms, "service": service},
        "steps": [
            {"id": s, "label": STEP_LABELS[s], "status": "pending", "completed_at": None}
            for s in INVESTIGATION_STEPS
        ],
        "rca_result": rca,
        "blast_result": blast,
        "recommended_fix": rca["suggested_fix_playbook"][0] if rca.get("suggested_fix_playbook") else "Restart service",
        "remediation_status": "not_started",
        "remediation_simulated": False,
    }
    investigation["steps"][0]["status"] = "completed"
    investigation["steps"][0]["completed_at"] = datetime.now(timezone.utc).isoformat()
    _investigations[inv_id] = investigation
    return investigation


def advance_investigation(inv_id: str) -> dict:
    inv = _investigations.get(inv_id)
    if not inv:
        return {"error": "Investigation not found"}

    current_idx = INVESTIGATION_STEPS.index(inv["current_step"])
    if current_idx < len(INVESTIGATION_STEPS) - 1:
        inv["steps"][current_idx]["status"] = "completed"
        inv["steps"][current_idx]["completed_at"] = datetime.now(timezone.utc).isoformat()
        next_step = INVESTIGATION_STEPS[current_idx + 1]
        inv["current_step"] = next_step
        inv["steps"][current_idx + 1]["status"] = "in_progress"

        if next_step == "awaiting_human_approval":
            inv["status"] = "awaiting_approval"
        elif next_step == "completed":
            inv["status"] = "completed"

    return inv


def approve_remediation(inv_id: str) -> dict:
    inv = _investigations.get(inv_id)
    if not inv:
        return {"error": "Investigation not found"}

    inv["remediation_status"] = "approved"
    idx = INVESTIGATION_STEPS.index("awaiting_human_approval")
    inv["steps"][idx]["status"] = "completed"
    inv["steps"][idx]["completed_at"] = datetime.now(timezone.utc).isoformat()
    inv["current_step"] = "execute_remediation"
    inv["steps"][idx + 1]["status"] = "in_progress"
    return inv


def execute_remediation(inv_id: str) -> dict:
    inv = _investigations.get(inv_id)
    if not inv:
        return {"error": "Investigation not found"}

    if inv["remediation_status"] != "approved":
        return {"error": "Remediation not approved"}

    inv["remediation_simulated"] = True
    inv["remediation_status"] = "executed"
    inv["remediation_result"] = {
        "action": inv["recommended_fix"],
        "status": "simulated_success",
        "message": f"Simulated execution: {inv['recommended_fix']}. No real changes were made.",
        "executed_at": datetime.now(timezone.utc).isoformat(),
    }
    idx = INVESTIGATION_STEPS.index("execute_remediation")
    inv["steps"][idx]["status"] = "completed"
    inv["steps"][idx]["completed_at"] = datetime.now(timezone.utc).isoformat()
    inv["current_step"] = "completed"
    inv["steps"][-1]["status"] = "completed"
    inv["steps"][-1]["completed_at"] = datetime.now(timezone.utc).isoformat()
    inv["status"] = "completed"
    return inv


def get_investigation(inv_id: str) -> dict | None:
    return _investigations.get(inv_id)


def list_investigations() -> list[dict]:
    return list(_investigations.values())


def copilot_query(question: str) -> dict:
    q = question.lower()
    incidents = _load_incidents()
    alerts = _load_alerts()
    changes = _load_changes()
    deployments = _load_deployments()

    answer_parts = []
    sources = []
    actions = []

    if any(w in q for w in ["slow", "latency", "degrad", "performance"]):
        svc = _extract_service(q)
        svc_incidents = [
            inc for inc in incidents
            if svc and (svc in inc.get("service_id", "") or svc in inc.get("service", "").lower())
        ] or incidents[:5]
        top = svc_incidents[0] if svc_incidents else incidents[0]
        answer_parts.append(
            f"**{top.get('service', 'Payment Authorization')}** is showing degradation signals. "
            f"Most recent similar incident: **{top['incident_id']}** — root cause was **{top['root_cause']}**, "
            f"resolved via **{top['fix']}**."
        )
        open_al = [a for a in _load_alerts() if a.get("status") == "open"][:3]
        if open_al:
            answer_parts.append(f"Active alerts: {', '.join(a['title'] for a in open_al[:3])}.")
        sources.extend(["incidents/service_now_incidents.json", "monitoring/alerts.json"])
        actions.append("Check RCA Dashboard for ranked root causes")
        actions.append("Review dependency path to postgres-cluster")

    elif any(w in q for w in ["change", "deploy", "before", "recent"]):
        recent = changes[:5]
        deps = deployments[:3]
        answer_parts.append("Recent changes near incident window:")
        for c in recent[:3]:
            answer_parts.append(f"- **{c['title']}** (risk: {c.get('risk', 'unknown')}, status: {c.get('status', '')})")
        for d in deps[:2]:
            answer_parts.append(f"- Deployment **{d['service']}** v{d['version']} — {d['status']}")
        sources.extend(["changes/change_records.json", "changes/deployments.json"])

    elif any(w in q for w in ["impact", "affected", "blast", "downstream"]):
        blast = analyze_blast_radius(
            ["CPU Saturation"], ["Latency Increase"], service=_extract_service(q)
        )
        answer_parts.append(
            f"**Currently impacted:** {', '.join(blast['currently_impacted_services'][:4])}. "
            f"**Likely downstream:** {', '.join(blast['likely_downstream_services'][:3])}. "
            f"Scope: **{blast['issue_scope']}** (business impact score: {blast['business_impact_score']})."
        )
        sources.append("dependencies/dependency_graph.json")

    elif any(w in q for w in ["root cause", "why", "cause", "rca"]):
        rca = analyze_rca(
            ["CPU Saturation", "API Error Spike"],
            ["Latency Increase", "Retry Storm"],
            service=_extract_service(q),
        )
        if rca["root_cause_candidates"]:
            top3 = rca["root_cause_candidates"][:3]
            answer_parts.append("Top root cause candidates:")
            for i, c in enumerate(top3, 1):
                answer_parts.append(f"{i}. **{c['root_cause']}** — {c['confidence']}% confidence")
        sources.append("rca/knowledge_graph.json")

    elif any(w in q for w in ["pattern", "seen", "before", "historical", "similar"]):
        similar = incidents[:3]
        answer_parts.append("Yes, we've seen this pattern before:")
        for inc in similar:
            answer_parts.append(
                f"- **{inc['incident_id']}**: {inc['title']} → {inc['root_cause']} (fix: {inc['fix']})"
            )
        sources.append("rca/knowledge_graph.json")

    elif any(w in q for w in ["fix", "remediation", "resolve", "worked"]):
        svc = _extract_service(q)
        matched = [inc for inc in incidents if svc and svc in inc.get("service_id", "")] or incidents
        fixes: dict[str, int] = defaultdict(int)
        for inc in matched:
            fixes[inc["fix"]] += 1
        top_fix = max(fixes, key=fixes.get)
        answer_parts.append(
            f"Most successful fix for this service pattern: **{top_fix}** "
            f"(worked in {fixes[top_fix]} historical incidents)."
        )
        sources.append("incidents/service_now_incidents.json")

    elif any(w in q for w in ["check", "next", "should i"]):
        answer_parts.append("Recommended next checks:")
        answer_parts.extend([
            "1. Review active alerts on auth-service and postgres-cluster",
            "2. Check recent deployments in the last 4 hours",
            "3. Inspect queue depth on kafka-cluster",
            "4. Run RCA analysis with current alert/symptom set",
            "5. Evaluate blast radius if issue is spreading",
        ])
        actions.append("Open Early Failure Detection dashboard")

    elif any(w in q for w in ["localized", "systemic", "spread"]):
        blast = analyze_blast_radius(["CPU Saturation"], ["Latency Increase"])
        answer_parts.append(
            f"This appears to be a **{blast['issue_scope']}** issue. "
            f"{len(blast['blast_radius_nodes'])} components in blast radius. "
            f"Severity recommendation: **{blast['severity_recommendation']}**."
        )

    else:
        answer_parts.append(
            "I can help with root cause analysis, impact assessment, change correlation, "
            "and historical pattern matching. Try asking:"
        )
        answer_parts.extend([
            "- Why is Payment Authorization slow?",
            "- What changed before this incident?",
            "- What is the likely root cause?",
            "- Is this issue localized or systemic?",
        ])

    return {
        "question": question,
        "answer": "\n\n".join(answer_parts),
        "sources": list(set(sources)),
        "suggested_actions": actions,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _extract_service(q: str) -> str | None:
    services = {
        "payment authorization": "payment-authorization",
        "payment": "payment-authorization",
        "settlement": "settlement-processing",
        "fraud": "fraud-detection",
        "merchant": "merchant-services",
        "api gateway": "api-gateway-services",
        "gateway": "api-gateway-services",
        "partner": "partner-integrations",
    }
    for name, sid in services.items():
        if name in q:
            return sid
    return None


def get_overview() -> dict:
    incidents = _load_incidents()
    alerts = _load_alerts()
    kg = _load_knowledge_graph()
    open_alerts = [a for a in alerts if a.get("status") in ("open", "acknowledged")]
    early = detect_early_failures()
    p1_count = sum(1 for i in incidents if i.get("severity") == "P1")

    return {
        "summary": {
            "total_incidents": len(incidents),
            "open_alerts": len(open_alerts),
            "knowledge_graph_nodes": kg.get("stats", {}).get("node_count", 0),
            "knowledge_graph_edges": kg.get("stats", {}).get("edge_count", 0),
            "early_warnings": len(early.get("detections", [])),
            "active_investigations": len([i for i in _investigations.values() if i["status"] != "completed"]),
            "p1_incidents_historical": p1_count,
        },
        "recent_incidents": [
            {
                "incident_id": i["incident_id"],
                "title": i["title"],
                "severity": i["severity"],
                "service": i["service"],
                "root_cause": i["root_cause"],
                "resolved_at": i.get("resolved_at", ""),
            }
            for i in sorted(incidents, key=lambda x: x.get("start_time", ""), reverse=True)[:6]
        ],
        "top_root_causes": _top_root_causes(incidents),
        "early_detections": early.get("detections", [])[:3],
        "open_alerts_preview": open_alerts[:5],
    }


def _top_root_causes(incidents: list[dict], limit: int = 5) -> list[dict]:
    counts: dict[str, int] = defaultdict(int)
    for inc in incidents:
        counts[inc["root_cause"]] += 1
    return [
        {"root_cause": rc, "count": c}
        for rc, c in sorted(counts.items(), key=lambda x: x[1], reverse=True)[:limit]
    ]


def scoped_copilot_query(context_type: str, context_payload: dict, question: str, history: list[dict]) -> dict:
    import os
    import json
    import urllib.request
    import urllib.error

    guardrails = ""
    if context_type == 'DEPENDENCY_NODE':
        guardrails = (
            "You are an SRE specialist analyzing a specific infrastructure node. "
            "Answer questions ONLY regarding this node's performance, metrics, and immediate structural dependencies. "
            "Do not extrapolate into unlinked systemic incidents."
        )
    elif context_type == 'INCIDENT_DETAIL':
        guardrails = (
            "You are an incident manager reviewing a single historical ticket. "
            "Focus entirely on explaining why this incident occurred, what its telemetry signature implies, "
            "and how the fix addresses it. Refuse to discuss other non-related incidents."
        )
    elif context_type == 'BLAST_RADIUS':
        guardrails = (
            "You are a downstream cascading failure assessment engine. "
            "Your job is to explain the propagation path, risk vector, and systemic blast radius shown in the graph payload. "
            "Focus on network paths, microservice architectures, and customer impact optimization."
        )
    elif context_type == 'RCA_ANALYSIS':
        guardrails = (
            "You are an RCA Data Scientist. "
            "Analyze the input alerts and matching telemetry symptoms against the historical correlation data provided. "
            "Explain the mathematical logic behind the high confidence ranking for these specific anomalies."
        )
    else:
        guardrails = "You are the Core AI Agent of the Autonomous IT Operations Platform."

    system_prompt = (
        f"You are the Core AI Agent of the Autonomous IT Operations Platform.\n"
        f"Your task is to provide expert, clear, and actionable infrastructure diagnostics.\n"
        f"CRITICAL RULE: You must maintain contextual strictness. You are being invoked inside "
        f"the context of: {context_type}.\n\n"
        f"GUARDRAILS FOR THIS SCOPE:\n{guardrails}\n\n"
        f"HERE IS THE REAL-TIME SYSTEM CONTEXT PAYLOAD:\n"
        f"{json.dumps(context_payload, indent=2)}\n\n"
        "Do not invent information outside of this payload. Tailor all analysis specifically to "
        "the architecture elements outlined above."
    )

    api_key = os.environ.get("OPENROUTER_API_KEY")
    
    if api_key:
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": question})
        
        req_body = {
            "model": "anthropic/claude-3.5-sonnet",
            "messages": messages,
            "temperature": 0.2
        }
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Autonomous IT Operations Platform"
        }
        
        try:
            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/chat/completions",
                data=json.dumps(req_body).encode("utf-8"),
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                answer = res_data["choices"][0]["message"]["content"]
                return {
                    "answer": answer,
                    "sources": ["openrouter.ai (anthropic/claude-3.5-sonnet)"],
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
        except Exception as e:
            pass

    mock_answer = generate_mock_sre_response(context_type, context_payload, question)
    return {
        "answer": mock_answer,
        "sources": ["SRE Rule Engine (Mock Offline Fallback)"],
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


def generate_mock_sre_response(context_type: str, context_payload: dict, question: str) -> str:
    q = question.lower()
    
    if context_type == 'DEPENDENCY_NODE':
        node_name = context_payload.get("node_name", "Unknown Node")
        health = context_payload.get("current_health", "Healthy")
        metrics = context_payload.get("metrics", {})
        downstream = context_payload.get("downstream_dependencies", [])
        
        if any(w in q for w in ["metric", "cpu", "memory", "latency", "error"]):
            return (
                f"### Node Telemetry Analysis: **{node_name}**\n\n"
                f"The current metrics for **{node_name}** ({health} state) are:\n"
                f"- **CPU Utilization**: {metrics.get('cpu', 'N/A')}%\n"
                f"- **Memory Usage**: {metrics.get('memory', 'N/A')}%\n"
                f"- **Network Load**: {metrics.get('network', 'N/A')}%\n"
                f"- **P99 Latency**: {metrics.get('latency', 'N/A')}ms\n"
                f"- **Error Rate**: {metrics.get('error_rate', 'N/A')}%\n\n"
                f"These values indicate that the node is running within normal thresholds but is showing a minor elevation in network traffic."
            )
        elif any(w in q for w in ["downstream", "depend", "structure", "connect"]):
            downstream_str = ", ".join(downstream) if downstream else "No downstream nodes found"
            return (
                f"### Dependency Structural Analysis: **{node_name}**\n\n"
                f"**{node_name}** is a critical hub component. It has downstream dependencies on:\n"
                f"**{downstream_str}**.\n\n"
                f"If **{node_name}** undergoes failure, the cascading blast radius will propagate immediately to these services."
            )
        else:
            return (
                f"### Scoped Diagnosis for Node **{node_name}**\n\n"
                f"The node is currently reported as **{health}**. Key parameters:\n"
                f"- CPU: {metrics.get('cpu')}% | Memory: {metrics.get('memory')}%\n"
                f"- Downstream target count: {len(downstream)}\n\n"
                f"As an SRE specialist, I recommend reviewing connection pool saturation on postgres-cluster if latency increases."
            )
            
    elif context_type == 'INCIDENT_DETAIL':
        inc_id = context_payload.get("incident_id", "Unknown INC")
        title = context_payload.get("title", "Unknown incident")
        svc = context_payload.get("service", "Unknown Service")
        severity = context_payload.get("severity", "P3")
        fix = context_payload.get("historical_fix", "Restart")
        ttr = context_payload.get("time_to_resolution", "30 minutes")
        conf = context_payload.get("historical_confidence", "85%")
        
        if any(w in q for w in ["fix", "resolve", "work", "remediat"]):
            return (
                f"### Resolution Diagnosis: **{inc_id}**\n\n"
                f"The historical resolution for ticket **{inc_id}** was: \n"
                f"> **{fix}**\n\n"
                f"This resolution restored system operations in **{ttr}** with a pattern correlation confidence of **{conf}**."
            )
        else:
            return (
                f"### Post-Incident Review: **{inc_id}**\n\n"
                f"**Ticket summary**:\n"
                f"- **Title**: {title}\n"
                f"- **Service Affected**: {svc}\n"
                f"- **Severity**: {severity}\n"
                f"- **Time to Resolution (TTR)**: {ttr}\n\n"
                f"The incident occurred due to an anomalous pattern match. The applied remediation was: *{fix}*."
            )
            
    elif context_type == 'BLAST_RADIUS':
        rc_svc = context_payload.get("root_cause_service", "Unknown pod")
        biz_score = context_payload.get("business_impact_score", 50)
        scope = context_payload.get("scope", "localized")
        cust = context_payload.get("estimated_affected_customers", 100)
        impacted = context_payload.get("currently_impacted", [])
        downstream = context_payload.get("likely_downstream", [])
        
        if any(w in q for w in ["propagat", "cascade", "path", "downstream"]):
            return (
                f"### Cascading Propagation Path Analysis\n\n"
                f"The failure originates at **{rc_svc}** and cascades along the following topological path:\n"
                f"1. **{rc_svc}** (Source)\n"
                f"2. {', '.join(impacted[:3])} (Currently impacted tier)\n"
                f"3. {', '.join(downstream[:3])} (Downstream blast horizon)\n\n"
                f"The network path is highly critical because {rc_svc} acts as the primary data ingestion point."
            )
        else:
            return (
                f"### Blast Radius Impact Diagnosis\n\n"
                f"**Failure Scope Summary**:\n"
                f"- **Originating node**: {rc_svc}\n"
                f"- **Impact Score**: {biz_score}/100 ({scope} scope)\n"
                f"- **Estimated Customer Exposure**: {cust} customers\n\n"
                f"We recommend immediately isolating {rc_svc} or routing traffic around the currently impacted services: {', '.join(impacted)}."
            )
            
    elif context_type == 'RCA_ANALYSIS':
        signals = context_payload.get("input_signals", {})
        alerts = signals.get("alerts", [])
        symptoms = signals.get("symptoms", [])
        svc = signals.get("service", "Unknown Service")
        out = context_payload.get("generated_output_analysis", {})
        top = out.get("top_candidate", "Unknown")
        sec = out.get("secondary_candidate", "Unknown")
        
        if any(w in q for w in ["confidence", "score", "math", "why"]):
            return (
                f"### Mathematical RCA Correlation Breakdown\n\n"
                f"The confidence score for **{top}** is computed based on:\n"
                f"1. **Alert overlap**: Match ratio of active alerts ({', '.join(alerts)}) against historical index regressions.\n"
                f"2. **Symptom overlap**: Match ratio of ({', '.join(symptoms)}) which matches the query pattern by over 85%.\n"
                f"3. **Service match**: Weight boost from target service: **{svc}**.\n\n"
                f"This telemetry signature strongly aligns with past index regressions, yielding high confidence."
            )
        else:
            return (
                f"### Root Cause Analysis Summary\n\n"
                f"For the service **{svc}**, the following RCA findings were generated:\n"
                f"- **Primary Suspected Cause**: {top}\n"
                f"- **Alternative Hypothesis**: {sec}\n\n"
                f"This analysis correlates {len(alerts)} alerts and {len(symptoms)} symptoms against the historical incident knowledge graph."
            )
            
    else:
        return f"Scoped assistant: Received context type {context_type}. Please let me know how I can assist you with this payload."


def chat_path_query(service: str, question: str, history: list[dict]) -> dict:
    import json
    import os
    from app.data_store import read_json
    
    dep_data = read_json("dependencies/dependency_graph.json") or {"edges": []}
    edges = dep_data.get("edges", [])
    all_alerts = read_json("monitoring/alerts.json").get("alerts", [])
    all_incidents = read_json("incidents/service_now_incidents.json").get("incidents", [])

    # Get downstream and upstream paths
    downstream = _bfs_downstream(service, edges)
    upstream = _bfs_upstream(service, edges)
    
    dependency_path = [service] + downstream
    if upstream:
        dependency_path = upstream + dependency_path

    # Gather details of each component in path
    path_details = {}
    for comp in dependency_path:
        comp_alerts = [
            {"id": a["id"], "title": a["title"], "severity": a["severity"], "status": a["status"]}
            for a in all_alerts
            if (a.get("entity_id") == comp or comp in a.get("description", "")) and a.get("status") in ("open", "acknowledged")
        ]
        comp_incidents = [
            {"id": inc["incident_id"], "title": inc["title"], "severity": inc["severity"]}
            for inc in all_incidents
            if comp in inc.get("impacted_components", []) or comp == inc.get("service_id")
        ]
        path_details[comp] = {
            "alerts": comp_alerts,
            "incidents": comp_incidents
        }

    # Form Prompt
    prompt = f"""
You are an expert SRE assistant. Your responses MUST be strictly limited to explaining, diagnosing, and analyzing blast radius errors, active alerts, component health, failure path propagation, and reasoning about causes and effects of outages on the given dependency path.

Rules for your response:
1. The reply must be in plain, natural human language. Do NOT use any special characters, markdown formatting, symbols, asterisks, hash signs, bullet points, bold text, or code formatting.
2. Limit the response to a maximum of 500 words.

Dependency Path:
{" -> ".join(dependency_path)}

Component Telemetry Data:
{json.dumps(path_details, indent=2)}

User Question: {question}
"""
    
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    
    is_gemini_valid = gemini_key and not gemini_key.startswith("your_")
    is_openrouter_valid = openrouter_key and not openrouter_key.startswith("your_")
    
    answer = ""
    if is_gemini_valid:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
        body = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        import urllib.request
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        import urllib.error
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                res = json.loads(response.read().decode("utf-8"))
                answer = res["candidates"][0]["content"]["parts"][0]["text"]
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            answer = f"Gemini API execution error: {str(e)} - details: {err_body}"
        except Exception as e:
            answer = f"Gemini API execution error: {str(e)}"
    elif is_openrouter_valid:
        url = "https://openrouter.ai/api/v1/chat/completions"
        model = os.environ.get("FAST_MODEL", "google/gemini-2.5-flash")
        body = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2
        }
        headers = {
            "Authorization": f"Bearer {openrouter_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Autonomous IT Operations Platform"
        }
        import urllib.request
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                res = json.loads(response.read().decode("utf-8"))
                answer = res["choices"][0]["message"]["content"]
        except Exception as e:
            answer = f"OpenRouter API execution error: {str(e)}"
    else:
        # Local SRE heuristic diagnostics generator (Plain human language format, no special characters/markdown)
        troubled = []
        for comp in dependency_path:
            details = path_details.get(comp, {"alerts": [], "incidents": []})
            if details["alerts"] or details["incidents"]:
                troubled.append(comp)
        
        q = question.lower()
        if any(w in q for w in ["cause", "reason", "root"]):
            ans_lines = [
                f"We traced the dependency path starting from {', '.join(dependency_path)}.",
                f"The primary failure source and root cause of the active failure propagation is identified as the {service} component."
            ]
            if service in troubled:
                alerts = [a["title"] for a in path_details[service]["alerts"]]
                alerts = list(dict.fromkeys(alerts))
                if len(alerts) > 3:
                    alerts_str = ", ".join(alerts[:3]) + f" and {len(alerts) - 3} other alerts"
                else:
                    alerts_str = ", ".join(alerts)
                ans_lines.append(f"Active alert notifications indicate {alerts_str if alerts_str else 'telemetry anomalies'}.")
            ans_lines.extend([
                f"Latency and error rate spikes on {service} are propagating, consuming thread pools and database connection pool slots in dependent services.",
                f"We recommend scaling horizontal pods or rolling back the latest deployment on {service} to restore nominal throughput.",
                f"Note: using local SRE engine. Configure GEMINI_API_KEY in backend env for live Gemini API calls."
            ])
            answer = " ".join(ans_lines)
            
        elif any(w in q for w in ["effect", "propagation", "downstream", "impact", "affect"]):
            ans_lines = [
                f"We evaluated the downstream dependency paths starting from {service}.",
                f"The cascading impact path propagates to " + (" then ".join(downstream) if downstream else "no downstream services."),
                f"Anomalies on {service} create cascading request backpressure downstream, leading to transaction timeouts and circuit breaker trips.",
                f"The affected downstream nodes are " + (", ".join(downstream) if downstream else "none."),
                f"Note: using local SRE engine. Configure GEMINI_API_KEY in backend env for live Gemini API calls."
            ]
            answer = " ".join(ans_lines)
            
        else:
            ans_lines = [
                f"The analyzed dependency path is {' then '.join(dependency_path)}.",
                "Here is the health status of the components along this path."
            ]
            for comp in dependency_path:
                details = path_details.get(comp, {"alerts": [], "incidents": []})
                status_str = "is healthy with no active alerts"
                if details["alerts"] or details["incidents"]:
                    anomalies = [a["title"] for a in details["alerts"]] + [i["title"] for i in details["incidents"]]
                    anomalies = list(dict.fromkeys(anomalies))
                    if len(anomalies) > 3:
                        anomalies_str = ", ".join(anomalies[:3]) + f" and {len(anomalies) - 3} other issues"
                    else:
                        anomalies_str = ", ".join(anomalies)
                    status_str = f"is degraded due to {anomalies_str}"
                ans_lines.append(f"Component {comp} {status_str}.")
            
            ans_lines.extend([
                f"Active alerts are registered on {service}.",
                f"Downstream latency and degradation are propagating through " + (", ".join(downstream) if downstream else "no downstream services."),
                f"Note: using local SRE engine. Configure GEMINI_API_KEY in backend env for live Gemini API calls."
            ])
            answer = " ".join(ans_lines)

    # Post-process answer to strip all markdown and special characters, and limit length to 500 words
    import re
    cleaned = answer
    # Strip headers
    cleaned = re.sub(r'#+\s*', '', cleaned)
    # Strip bold/italic/backtick notation
    cleaned = re.sub(r'[*_`]', '', cleaned)
    # Strip bullet points
    cleaned = re.sub(r'^\s*[-+•\d+\.]\s*', '', cleaned, flags=re.MULTILINE)
    
    # Enforce word limit of max 500 words
    words = cleaned.split()
    if len(words) > 500:
        cleaned = " ".join(words[:500])
        
    answer = cleaned.strip()

    return {
        "service": service,
        "dependency_path": dependency_path,
        "answer": answer
    }


