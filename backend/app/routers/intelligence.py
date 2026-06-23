from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from app.services.intelligence import (
    KnowledgeGraphService,
    analyze_rca,
    analyze_blast_radius,
    detect_early_failures,
    create_investigation,
    advance_investigation,
    approve_remediation,
    execute_remediation,
    get_investigation,
    list_investigations,
    copilot_query,
    get_overview,
)

router = APIRouter(prefix="/api", tags=["intelligence"])


class RCARequest(BaseModel):
    alerts: list[str]
    symptoms: list[str]
    service: Optional[str] = None
    time_window_hours: int = 24
    environment: Optional[str] = None


class BlastRadiusRequest(BaseModel):
    alerts: list[str]
    symptoms: list[str]
    source_component: Optional[str] = None
    service: Optional[str] = None


class EarlyDetectionRequest(BaseModel):
    current_alerts: Optional[list[str]] = None


class InvestigationRequest(BaseModel):
    alerts: list[str]
    symptoms: list[str]
    service: Optional[str] = None


class CopilotRequest(BaseModel):
    question: str
    history: list[dict] = []


class ScopedCopilotRequest(BaseModel):
    context_type: str
    context_payload: dict
    question: str
    history: Optional[list[dict]] = None


@router.post("/overview")
def overview():
    return get_overview()


@router.get("/knowledge-graph")
def knowledge_graph():
    return KnowledgeGraphService().get_graph()


@router.get("/knowledge-graph/stats")
def knowledge_graph_stats():
    return KnowledgeGraphService().get_stats()


@router.post("/rca/analyze")
def rca_analyze(req: RCARequest):
    return analyze_rca(
        req.alerts, req.symptoms, req.service, req.time_window_hours, req.environment
    )


class RCAAgentRequest(BaseModel):
    alerts: list[str]
    symptoms: list[str]
    service: Optional[str] = None
    time_window_hours: int = 24


@router.post("/rca/agent-analyze")
def rca_agent_analyze(req: RCAAgentRequest):
    from app.agents.rca_agent import RCAAgent
    return RCAAgent().analyze_from_signals(
        req.alerts,
        req.symptoms,
        req.service or "",
        req.time_window_hours,
    )


class ReportChatRequest(BaseModel):
    question: str
    report_context: str
    report_type: str
    history: list[dict] = []


@router.post("/agents/report-chat")
def report_chat(req: ReportChatRequest):
    from app.agents.report_chat_agent import answer_report_question
    return answer_report_question(
        req.question, req.report_context, req.report_type, req.history
    )


@router.post("/blast-radius/analyze")
def blast_radius_analyze(req: BlastRadiusRequest):
    return analyze_blast_radius(
        req.alerts, req.symptoms, req.source_component, req.service
    )


@router.post("/early-detection/analyze")
def early_detection_analyze(req: EarlyDetectionRequest):
    return detect_early_failures(req.current_alerts)


@router.get("/early-detection/analyze")
def early_detection_analyze_get():
    return detect_early_failures()


@router.post("/investigations")
def start_investigation(req: InvestigationRequest):
    return create_investigation(req.alerts, req.symptoms, req.service)


@router.get("/investigations")
def get_investigations():
    return {"investigations": list_investigations()}


@router.get("/investigations/{inv_id}")
def get_investigation_detail(inv_id: str):
    inv = get_investigation(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Investigation not found")
    return inv


@router.post("/investigations/{inv_id}/advance")
def advance_inv(inv_id: str):
    return advance_investigation(inv_id)


@router.post("/investigations/{inv_id}/approve")
def approve_inv(inv_id: str):
    return approve_remediation(inv_id)


@router.post("/investigations/{inv_id}/execute")
def execute_inv(inv_id: str):
    return execute_remediation(inv_id)


def _extract_incident_ids(text: str) -> list[str]:
    """Extract all INC-XXXX mentions from text."""
    import re
    return re.findall(r'\bINC-\d+\b', text.upper())


def _extract_service_mention(text: str) -> str | None:
    """Extract service name mentions from a question."""
    text_lower = text.lower()
    services = {
        "payment authorization": "payment-authorization",
        "payment": "payment-authorization",
        "settlement": "settlement-processing",
        "fraud detection": "fraud-detection",
        "fraud": "fraud-detection",
        "merchant": "merchant-services",
        "api gateway": "api-gateway-services",
        "gateway": "api-gateway-services",
        "partner": "partner-integrations",
        "auth service": "payment-authorization",
        "auth": "payment-authorization",
        "postgres": "payment-authorization",
        "redis": "payment-authorization",
        "kafka": "settlement-processing",
    }
    for keyword, service_id in services.items():
        if keyword in text_lower:
            return service_id
    return None


def _build_universal_copilot_context(question: str, history: list[dict]) -> dict:
    """
    Build a rich, universal context payload — loads EVERY data type the application has.
    The copilot can answer ANY question about the entire platform.
    """
    from app.services.intelligence import (
        _load_incidents, _load_alerts, _load_changes, _load_deployments,
        analyze_blast_radius, analyze_rca, _load_dependency_edges,
        detect_early_failures, list_investigations,
    )
    from app.data_store import read_json

    q = question.lower()
    full_text = question + " " + " ".join(m.get("content", "") for m in history)

    # ── Load everything ───────────────────────────────────────────────────────
    all_incidents    = _load_incidents()
    all_alerts       = _load_alerts()
    all_changes      = _load_changes()
    all_deployments  = _load_deployments()
    dep_edges        = _load_dependency_edges()

    active_incidents  = [i for i in all_incidents if i.get("state") in ("Open", "In Progress")]
    resolved_incidents = [i for i in all_incidents if i.get("state") in ("Resolved", "Closed")]
    open_alerts       = [a for a in all_alerts if a.get("status") in ("open", "acknowledged")]

    # Services
    services_raw  = read_json("dependencies/services.json").get("services", [])
    infra_raw     = read_json("dependencies/infrastructure.json").get("nodes", [])
    services_summary = [
        {"id": s.get("id"), "name": s.get("name"), "health": s.get("health")}
        for s in services_raw
    ]
    infra_summary = [
        {"id": n.get("id"), "name": n.get("name"), "type": n.get("type"), "health": n.get("health")}
        for n in infra_raw[:6]
    ]

    # Early Detections / Predictions — trimmed to avoid 413 token overflow
    early_detections = []
    try:
        raw_det = detect_early_failures().get("detections", [])
        early_detections = [
            {
                "pattern_id": d.get("pattern_id"),
                "expected_impacted_service": d.get("expected_impacted_service"),
                "confidence": d.get("confidence"),
                "estimated_time_to_incident_minutes": d.get("estimated_time_to_incident_minutes"),
                "risk_level": d.get("risk_level"),
                # Only include first 3 contributing signals and 3 recommended actions
                "contributing_signals": d.get("contributing_signals", [])[:3],
                "recommended_actions": d.get("recommended_actions", [])[:3],
            }
            for d in raw_det[:5]  # cap at 5 detections
        ]
    except Exception:
        pass

    # Investigations
    investigations = []
    try:
        investigations = [
            {
                "id": inv.get("id"),
                "status": inv.get("status"),
                "current_step": inv.get("current_step"),
                "service": inv.get("input", {}).get("service"),
                "recommended_fix": inv.get("recommended_fix"),
                "created_at": inv.get("created_at"),
            }
            for inv in list_investigations()
        ]
    except Exception:
        pass

    # RCA Knowledge Graph patterns
    kg_patterns = []
    try:
        kg = read_json("rca/knowledge_graph.json")
        kg_patterns = [
            {
                "root_cause": p.get("root_cause"),
                "frequency": p.get("frequency"),
                "affected_services": p.get("affected_services", []),
                "suggested_fixes": p.get("suggested_fixes", []),
            }
            for p in kg.get("pattern_library", [])[:10]
        ]
    except Exception:
        pass

    # Metrics time-series
    metrics_ts = []
    try:
        metrics_raw = read_json("monitoring/metrics.json").get("metrics", [])
        metrics_ts = [
            {
                "entity_id": m.get("entity_id"),
                "metric": m.get("metric"),
                "latest_value": m.get("points", [{}])[-1].get("value") if m.get("points") else None,
                "unit": m.get("unit"),
            }
            for m in metrics_raw[:10]
        ]
    except Exception:
        pass

    # ── Cloud Connections Metadata ────────────────────────────────────────────
    connections_summary = []
    try:
        from app.integrations.credential_store import list_connections
        connections_summary = list_connections()
    except Exception:
        pass

    # ── Discovered Cloud Resources ────────────────────────────────────────────
    cloud_resources = []
    try:
        cloud_resources = read_json("integrations/resources.json").get("resources", [])
    except Exception:
        pass

    # ── Cloud Logs — trimmed to avoid token overflow ──────────────────────────
    cloud_logs = {}
    _wants_logs = any(w in q for w in ["log", "cloudwatch", "error log", "vpc", "flow"])
    try:
        raw_logs = read_json("integrations/logs.json")
        _log_limit = 5 if _wants_logs else 2
        _log_events = raw_logs.get("log_events", [])
        _vpc_events = raw_logs.get("vpc_flow_events", [])
        cloud_logs = {
            "log_events": [
                {k: v for k, v in e.items() if k in ("timestamp", "level", "message", "source", "service")}
                for e in _log_events[:_log_limit]
            ],
            "vpc_flow_events": _vpc_events[:2] if _wants_logs else [],
            "total_events": len(_log_events) + len(_vpc_events)
        }
    except Exception:
        pass

    # ── Cloud Traces — trimmed ────────────────────────────────────────────────
    cloud_traces = {}
    _wants_traces = any(w in q for w in ["trace", "x-ray", "xray", "span", "latency trace"])
    try:
        raw_traces = read_json("integrations/traces.json")
        _trace_limit = 5 if _wants_traces else 2
        _all_traces = raw_traces.get("traces", [])
        cloud_traces = {
            "traces": _all_traces[:_trace_limit],
            "service_map": raw_traces.get("service_map", [])[:5],
            "total_traces": len(_all_traces)
        }
    except Exception:
        pass

    # ── CloudTrail Audit Events — trimmed ─────────────────────────────────────
    audit_events = []
    _wants_audit = any(w in q for w in ["audit", "cloudtrail", "trail", "who", "access", "iam"])
    try:
        _all_audit = read_json("integrations/audit_events.json").get("events", [])
        audit_events = _all_audit[:5] if _wants_audit else _all_audit[:2]
    except Exception:
        pass

    # ── Config Compliance Rules — trimmed ─────────────────────────────────────
    config_compliance = {}
    _wants_compliance = any(w in q for w in ["compliance", "config", "rule", "non-compliant", "policy", "security"])
    try:
        raw_compliance = read_json("integrations/config_compliance.json")
        _rule_limit = 8 if _wants_compliance else 3
        config_compliance = {
            "total_rules": raw_compliance.get("total_rules", 0),
            "non_compliant_rule_count": raw_compliance.get("non_compliant_rule_count", 0),
            "rules": raw_compliance.get("rules", [])[:_rule_limit],
            "non_compliant_resources": raw_compliance.get("non_compliant_resources", [])[:5],
        }
    except Exception:
        pass

    # ── Codebase & Architecture Guide ─────────────────────────────────────────
    codebase_guide = {
        "ports": {
            "backend": 8000,
            "frontend": 5173
        },
        "directories_and_key_files": {
            "backend/app/main.py": "Backend FastAPI application setup, middleware, CORS, lifespan, and router inclusions.",
            "backend/app/routers/": "API endpoints handlers: admin.py (mock database state reset/uploads), incidents.py (list/search ServiceNow incidents), monitoring.py (telemetry status), otel.py (OpenTelemetry spans ingestion), integrations.py (connect cloud accounts and query resources/logs/traces/compliance), intelligence.py (AI Operations Copilot ask, scoped chat, RCA analyze, early detection analyze, blast radius BFS down/upstream mapping, and investigation workflows).",
            "backend/app/integrations/": "Adapters for external platforms. Includes aws/, azure/, gcp/, and kubernetes/ subfolders for provider-specific logic. credential_store.py handles encrypted storage. scheduler.py runs in-process APScheduler tasks to discover resources and pull telemetry periodically.",
            "backend/app/services/": "Business intelligence: early_detection_engine.py matches active alerts with historical libraries to compute incident likelihood; copilot_service.py manages chat context prompts; intelligence.py handles RCA ranking calculations.",
            "backend/app/agents/": "LLM-based specialist SRE agents for specific pages (ServiceAgent, IncidentAgent, RCAAgent, BlastRadiusAgent, PredictionAgent, WorkflowAgent, ExecutiveAgent, EarlyDetectionAgent).",
            "frontend/src/pages/": "React UI views: AIOperationsCopilot.tsx (centralized chat), ServiceOperationsCenter.tsx (metrics dashboard/topological dependency map), EarlyDetectionDashboard.tsx (proactive anomalies), InvestigationWorkflow.tsx (14-step automated resolution scripts with human gate).",
            "data/": "JSON-based flat database stores for active/resolved ServiceNow incident records, network topology edges, metrics time-series, and credential/telemetry dumps."
        },
        "integrations_auth_modes": {
            "aws": "Evaluates three modes: 1. Static IAM access_key_id + secret_access_key (Mode 1), 2. STS AssumeRole using role_arn and optional external_id (Mode 2), 3. Default boto3 credential chain (EC2 instance profile/env) (Mode 3).",
            "azure": "Uses Active Directory Service Principal credentials: tenant_id, client_id, client_secret, and subscription_id.",
            "gcp": "Uses GCP project_id and a Service Account credentials JSON dictionary.",
            "kubernetes": "Uses a kubeconfig string, or direct API server endpoint URL, Bearer authentication token, and optional CA certificate."
        },
        "credentials_security_and_encryption": {
            "mechanism": "Sensitive fields (e.g. client_secret, service_account_json, token, kubeconfig, ca_cert, access_key_id, secret_access_key, session_token) are AES encrypted prior to persistence using a Fernet key derived from the INTEGRATION_SECRET_KEY environment variable. If missing from .env on startup, a secure key is auto-generated and appended to .env.",
            "storage_file": "Persisted at rest in data/integrations/connections.json. Public API queries (e.g., list_connections) sanitize these configurations and never return secret keys/secrets."
        },
        "connection_name_concept": {
            "definition": "A unique, user-defined name (e.g. 'prod-aws', 'staging-aws', 'dev-gcp') given to a cloud provider credentials setup.",
            "purpose": "1. Acts as the key to retrieve, edit, or delete credentials. 2. Compound keys (e.g., provider::connection_id::local_id) tag all synced resources, metrics, logs, and compliance rules in the DB to isolate data between different clouds and environments without collision."
        }
    }

    # ── Intent Detection ──────────────────────────────────────────────────────
    # Detect incident IDs
    mentioned_ids = _extract_incident_ids(full_text)
    matched_incidents = [
        i for i in all_incidents
        if i.get("incident_id", "").upper() in [mid.upper() for mid in mentioned_ids]
    ] if mentioned_ids else []

    # Detect service
    mentioned_service = _extract_service_mention(full_text)
    service_incidents = []
    service_alerts_list = []
    if mentioned_service:
        service_incidents = [
            i for i in all_incidents
            if mentioned_service.lower() in i.get("service_id", "").lower()
            or mentioned_service.lower() in i.get("service", "").lower()
        ][:8]
        service_alerts_list = [
            a for a in all_alerts
            if mentioned_service.lower() in a.get("entity_id", "").lower()
        ][:8]

    # Blast radius on demand
    blast_data = {}
    if any(w in q for w in ["blast", "impact", "downstream", "cascade", "spread", "affected services", "which services"]):
        try:
            src = mentioned_service or (matched_incidents[0].get("service_id", "auth-service") if matched_incidents else "auth-service")
            alert_titles = [a.get("title", "") for a in service_alerts_list[:3]] or ["CPU Saturation", "API Error Spike"]
            blast_data = analyze_blast_radius(alert_titles, ["Latency Increase"], source_component=src, service=mentioned_service)
        except Exception:
            pass

    # RCA on demand
    rca_data = {}
    if any(w in q for w in ["root cause", "why", "cause", "rca", "reason", "what caused", "diagnose", "investigate"]) and not matched_incidents:
        try:
            alert_titles = [a.get("title", "") for a in service_alerts_list[:3]] or ["CPU Saturation", "API Error Spike"]
            rca_raw = analyze_rca(alert_titles, ["Latency Increase"], service=mentioned_service)
            rca_data = {
                "top_candidates": rca_raw.get("root_cause_candidates", [])[:3],
                "dependency_path": rca_raw.get("dependency_path", []),
                "suggested_fixes": rca_raw.get("suggested_fix_playbook", []),
                "similar_historical_incidents": rca_raw.get("similar_historical_incidents", [])[:3],
            }
        except Exception:
            pass

    # ── Assemble full context ─────────────────────────────────────────────────
    return {
        # ── Platform overview ─────────────────────────────────────────────────
        "platform_summary": {
            "total_active_incidents": len(active_incidents),
            "total_resolved_incidents": len(resolved_incidents),
            "total_historical_incidents": len(all_incidents),
            "total_open_alerts": len(open_alerts),
            "early_warning_count": len(early_detections),
            "active_investigations": len([i for i in investigations if i.get("status") != "completed"]),
            "services_count": len(services_summary),
            "infra_nodes_count": len(infra_summary),
            "total_cloud_connections": len(connections_summary),
            "total_cloud_resources": len(cloud_resources),
            "total_cloud_logs": cloud_logs.get("total_events", 0) if isinstance(cloud_logs, dict) else 0,
            "total_cloud_traces": cloud_traces.get("total_traces", 0) if isinstance(cloud_traces, dict) else 0,
            "total_audit_events": len(audit_events),
        },

        # ── Incidents ─────────────────────────────────────────────────────────
        "matched_incidents": matched_incidents,       # Exact INC-XXXX matches from question
        "active_incidents": [
            {
                "incident_id": i.get("incident_id"),
                "title": i.get("title"),
                "severity": i.get("severity"),
                "service": i.get("service"),
                "root_cause": i.get("root_cause")
            }
            for i in active_incidents[:3]
        ],
        "recent_resolved_incidents": [
            {
                "incident_id": i.get("incident_id"),
                "title": i.get("title"),
                "severity": i.get("severity"),
                "service": i.get("service"),
                "root_cause": i.get("root_cause"),
                "fix": i.get("fix")
            }
            for i in resolved_incidents[:2]
        ],
        "service_incidents": service_incidents,       # Filtered by mentioned service

        # ── Alerts ───────────────────────────────────────────────────────────
        "open_alerts": [
            {
                "id": a.get("id"),
                "title": a.get("title"),
                "severity": a.get("severity"),
                "entity_id": a.get("entity_id")
            }
            for a in open_alerts[:5]
        ],
        "service_alerts": service_alerts_list,

        # ── Early Detection / Predictions ─────────────────────────────────────
        "early_detections": early_detections,

        # ── RCA ──────────────────────────────────────────────────────────────
        "rca_analysis": rca_data,
        "rca_knowledge_patterns": kg_patterns,

        # ── Blast Radius ─────────────────────────────────────────────────────
        "blast_radius_analysis": blast_data,

        # ── Services & Infrastructure ─────────────────────────────────────────
        "services": services_summary,
        "infrastructure": infra_summary[:5],
        "mentioned_service": mentioned_service,

        # ── Changes & Deployments ─────────────────────────────────────────────
        "recent_changes": [
            {
                "change_id": c.get("change_id"),
                "title": c.get("title"),
                "service": c.get("service"),
                "status": c.get("status")
            }
            for c in all_changes[:3]
        ],
        "recent_deployments": [
            {
                "deployment_id": d.get("deployment_id"),
                "service": d.get("service"),
                "version": d.get("version"),
                "status": d.get("status")
            }
            for d in all_deployments[:3]
        ],

        # ── Metrics ──────────────────────────────────────────────────────────
        "metrics_snapshot": metrics_ts,

        # ── Investigations ───────────────────────────────────────────────────
        "investigations": investigations,

        # ── Codebase & Architecture Guide ──────────────────────────────────────
        "codebase_guide": codebase_guide,

        # ── Cloud Integrations Telemetry ──────────────────────────────────────
        "cloud_connections": connections_summary,
        "cloud_resources": cloud_resources[:20],
        "cloud_logs": cloud_logs,
        "cloud_traces": cloud_traces,
        "cloud_audit_events": audit_events[:15],
        "cloud_config_compliance": config_compliance,

        "user_question": question,
    }


@router.post("/copilot/ask")
def ask_copilot(req: CopilotRequest):
    import json
    import logging
    import os
    from datetime import datetime, timezone

    from app.services.groq_client import chat_completion, PRIMARY_MODEL

    logger = logging.getLogger("uvicorn")

    # Build comprehensive context
    context = _build_universal_copilot_context(req.question, req.history)

    # ── Hard-cap context JSON to prevent 413 token-overflow errors ────────────
    # llama-3.3-70b-versatile supports 128K tokens, but Groq rate tiers limit
    # requests to ~32K tokens per minute. We cap at 28K chars (~7K tokens) so
    # the full prompt (system + context + history + question) stays safe.
    _MAX_CONTEXT_CHARS = 28_000
    context_json = json.dumps(context, default=str)
    if len(context_json) > _MAX_CONTEXT_CHARS:
        # Condensed context: keep only operationally critical fields
        condensed = {
            "platform_summary": context.get("platform_summary", {}),
            "matched_incidents": context.get("matched_incidents", []),
            "active_incidents": context.get("active_incidents", []),
            "recent_resolved_incidents": context.get("recent_resolved_incidents", []),
            "open_alerts": context.get("open_alerts", []),
            "early_detections": context.get("early_detections", [])[:3],
            "services": context.get("services", [])[:6],
            "recent_changes": context.get("recent_changes", []),
            "recent_deployments": context.get("recent_deployments", []),
            "mentioned_service": context.get("mentioned_service"),
            "service_incidents": context.get("service_incidents", [])[:5],
            "service_alerts": context.get("service_alerts", [])[:5],
            "investigations": context.get("investigations", [])[:3],
            "rca_knowledge_patterns": context.get("rca_knowledge_patterns", [])[:3],
            "codebase_guide": context.get("codebase_guide", {}),
            "cloud_connections": context.get("cloud_connections", []),
            "user_question": context.get("user_question", ""),
        }
        context_json = json.dumps(condensed, default=str)
        if len(context_json) > _MAX_CONTEXT_CHARS:
            context_json = context_json[:_MAX_CONTEXT_CHARS] + "...}"

    system_prompt = (
        "You are OpsGPT — an expert AI Operations Copilot for an autonomous observability platform.\n"
        "You have full knowledge of the entire platform: incidents, services, metrics, alerts, changes, RCA, cloud integrations.\n\n"
        "RULES:\n"
        "1. Ground ALL answers in the CONTEXT PAYLOAD below — cite real INC-XXXX IDs, service names, metrics.\n"
        "2. For 'how many active incidents' questions: count from active_incidents array and list each by ID + title.\n"
        "3. For 'tell me about INC-XXXX': use matched_incidents or active_incidents to give title, severity, root_cause, fix.\n"
        "4. For fix/resolve questions: use the incident fix field or recommended_actions — cite specific technical steps.\n"
        "5. For blast radius: use blast_radius_analysis section.\n"
        "6. For platform overview: use platform_summary counts + list active_incidents by ID.\n"
        "7. For codebase/architecture: use codebase_guide section.\n"
        "8. For cloud connections: use cloud_connections section.\n"
        "9. Use conversation history to resolve follow-up pronouns (it, that, them).\n"
        "10. NEVER fabricate IDs, service names, or metrics not present in the payload.\n\n"
        "RESPONSE FORMAT — respond with valid JSON only:\n"
        '{"summary":"Direct factual answer citing real data","findings":["finding with real IDs"],' 
        '"evidence":["INC-XXXX: title","Alert: metric"],' 
        '"recommended_actions":["Concrete technical step"],"confidence":"95%"}\n\n'
        f"CONTEXT PAYLOAD:\n{context_json}"
    )

    groq_key = os.environ.get("GROQ_API_KEY")
    timestamp = datetime.now(timezone.utc).isoformat()

    if groq_key:
        try:
            # Build messages — cap history to last 6 messages to save tokens
            llm_messages = [{"role": "system", "content": system_prompt}]
            for msg in req.history[-6:]:
                role = msg.get("role", "user")
                if role in ("user", "assistant"):
                    llm_messages.append({"role": role, "content": msg.get("content", "")[:800]})
            llm_messages.append({"role": "user", "content": req.question})

            # Call PRIMARY_MODEL (70B) directly — do NOT fall back to 8B.
            # The 8B model has a tiny context window and will always 413 on a
            # platform-wide system prompt. If 70B is rate-limited, surface that
            # clearly to the user instead.
            result_raw = chat_completion(
                llm_messages, PRIMARY_MODEL, temperature=0.2, max_tokens=1024, timeout=45
            )
            raw = result_raw["choices"][0]["message"]["content"]
            model_used = PRIMARY_MODEL

            # Parse JSON response
            from app.services.copilot_service import _parse_structured_response
            result = _parse_structured_response(raw)

            # Format answer for frontend
            answer_parts = []
            if result.get("summary"):
                answer_parts.append(result["summary"])
            if result.get("findings"):
                answer_parts.append("**Findings:**\n" + "\n".join(f"- {f}" for f in result["findings"]))
            if result.get("evidence"):
                answer_parts.append("**Evidence:**\n" + "\n".join(f"- {e}" for e in result["evidence"]))
            if result.get("recommended_actions"):
                answer_parts.append("**Recommended Actions:**\n" + "\n".join(f"- {a}" for a in result["recommended_actions"]))
            if result.get("confidence"):
                answer_parts.append(f"**Confidence:** {result['confidence']}")

            return {
                "question": req.question,
                "answer": "\n\n".join(answer_parts),
                "sources": [f"OpsGPT ({model_used})"],
                "suggested_actions": result.get("recommended_actions", []),
                "timestamp": timestamp,
            }
        except Exception as exc:
            logger.warning("Universal copilot LLM call failed: %s", exc)
            err = str(exc)
            if "429" in err or "rate_limit" in err.lower():
                msg = (
                    "⚠️ AI model temporarily rate-limited by Groq. "
                    "Please wait 30-60 seconds and try again."
                )
            elif "413" in err or "too large" in err.lower():
                msg = (
                    "⚠️ AI context too large for the current Groq tier. "
                    "Try a more specific question like 'Tell me about INC-1042'."
                )
            elif "402" in err or "Payment" in err:
                msg = "⚠️ Groq API credits insufficient. Please top up your account."
            elif "403" in err or "1010" in err:
                msg = "⚠️ AI blocked by Groq. Check your GROQ_API_KEY in backend/.env."
            else:
                msg = f"⚠️ AI temporarily unavailable: {err[:200]}"
            return {"question": req.question, "answer": msg, "sources": [], "suggested_actions": [], "timestamp": timestamp}

    return {
        "question": req.question,
        "answer": "⚠️ GROQ_API_KEY is not configured. Please set it in `backend/.env` to enable the AI Copilot.",
        "sources": [],
        "suggested_actions": ["Set GROQ_API_KEY=your_key in backend/.env"],
        "timestamp": timestamp,
    }


@router.post("/copilot/scoped")
def ask_scoped_copilot(req: ScopedCopilotRequest):
    from app.services.intelligence import scoped_copilot_query
    return scoped_copilot_query(
        req.context_type, req.context_payload, req.question, req.history or []
    )

class ChatBlastRadiusRequest(BaseModel):
    service: str
    question: str
    history: Optional[list[dict]] = None


@router.post("/blast-radius/chat-investigate")
def blast_radius_chat_investigate(req: ChatBlastRadiusRequest):
    from app.services.chat_blast_radius import chat_blast_radius_query
    return chat_blast_radius_query(req.service, req.question, req.history or [])
