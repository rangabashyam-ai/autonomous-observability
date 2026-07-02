import json
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone
from app.data_store import read_json
from app.services.intelligence import analyze_blast_radius, analyze_rca

def is_casual_message(question: str) -> bool:
    q = question.strip().lower().rstrip("?").rstrip("!").rstrip(".").strip()
    
    greetings = {
        "hi", "hello", "hey", "how are you", "how's it going", "yo", "greetings", "good morning", "good afternoon", "good evening",
        "help", "what can you do", "what do you do", "how do you work", "help me", "who are you", "what is this", "what is your name"
    }
    
    if q in greetings:
        return True
        
    for prefix in ["hi ", "hello ", "hey ", "yo ", "help ", "greetings "]:
        if q.startswith(prefix):
            return True
            
    tech_words = {"blast", "radius", "rca", "root", "cause", "fail", "alert", "service", "propagation", "impact", "customer", "downstream", "upstream", "infrastructure", "incident", "status", "payment", "network", "spine", "telemetry"}
    words = [w.strip() for w in q.split() if w.strip()]
    if len(words) <= 4:
        if not any(any(tw in w for tw in tech_words) for w in words):
            return True
            
    return False

def chat_blast_radius_query(service: str, question: str, history: list[dict] = None) -> dict:
    if history is None:
        history = []

    # 1. Run dynamic blast radius & RCA simulations to collect incident context
    default_alerts = ["CPU Saturation", "API Error Spike"]
    default_symptoms = ["Latency Increase", "Retry Storm"]
    
    blast = analyze_blast_radius(
        alerts=default_alerts,
        symptoms=default_symptoms,
        service=service
    )

    if is_casual_message(question):
        return {
            "service": service,
            "currently_impacted": blast.get('currently_impacted_services', []),
            "likely_downstream": blast.get('likely_downstream_services', []),
            "impacted_infrastructure": blast.get('impacted_infrastructure', []),
            "impacted_regions": blast.get('impacted_regions', []),
            "answer": f"Hey! I'm your incident analyst. Ask me about the blast radius, root cause, affected services, or next steps for this {service.replace('-', ' ').title()} incident."
        }
    rca = analyze_rca(
        alerts=default_alerts,
        symptoms=default_symptoms,
        service=service
    )

    blast_radius_nodes = blast.get("blast_radius_nodes", [service])

    # 2. Gather active alerts on the blast radius nodes
    all_alerts = read_json("monitoring/alerts.json").get("alerts", [])
    active_alerts = [
        {
            "id": a["id"],
            "title": a["title"],
            "severity": a["severity"],
            "entity_id": a["entity_id"],
            "triggered_at": a.get("triggered_at", "")
        }
        for a in all_alerts
        if a.get("entity_id") in blast_radius_nodes and a.get("status") in ("open", "acknowledged")
    ]

    # 3. Gather recent incidents affecting blast radius nodes
    all_incidents = read_json("incidents/service_now_incidents.json").get("incidents", [])
    relevant_incidents = [
        {
            "incident_id": inc["incident_id"],
            "title": inc["title"],
            "severity": inc["severity"],
            "affected_service": inc.get("affected_service", ""),
            "root_cause": inc.get("root_cause", "")
        }
        for inc in all_incidents
        if any(node in inc.get("impacted_components", []) or node == inc.get("service_id") for node in blast_radius_nodes)
    ][:5]

    # 4. Format history
    history_str = ""
    for msg in history:
        role_label = "User" if msg.get("role") == "user" else "Assistant"
        history_str += f"{role_label}: {msg.get('content')}\n"

    # 4b. Format context objects to be highly compact and rich
    rca_candidates_list = [
        f"- {c.get('root_cause', 'Unknown')} (Confidence: {c.get('confidence', 0)}%, Matches: {c.get('matching_incident_count', 0)}, Suggested Action: {', '.join(c.get('suggested_fixes', []))})"
        for c in rca.get('root_cause_candidates', [])
    ]
    rca_summary = "\n".join(rca_candidates_list) if rca_candidates_list else "None identified"

    alerts_list = [
        f"- [{a.get('severity', 'warning').upper()}] Alert '{a.get('title')}' triggering on {a.get('entity_id')}"
        for a in active_alerts[:10]
    ]
    alerts_summary = "\n".join(alerts_list) if alerts_list else "No active open telemetry alerts"

    incidents_list = [
        f"- INC {inc.get('incident_id')}: '{inc.get('title')}' (Severity: {inc.get('severity')}, Root Cause: {inc.get('root_cause')})"
        for inc in relevant_incidents
    ]
    incidents_summary = "\n".join(incidents_list) if incidents_list else "No matching historical incidents"

    # 5. Build prompt
    prompt = f"""
You are a senior SRE incident analyst assistant.
Give concise, professional responses under 200 words.
Never use markdown syntax like ** or ## or *.
Use plain text only. Be direct and actionable.
Format lists with • character only.
Sound like an expert, not a document generator.

=== INCIDENT INVESTIGATION CONTEXT ===
Target Service / Analysis Origin: {service}
Classified Scope: {blast.get('issue_scope', 'unknown')}
Recommended Severity: {blast.get('severity_recommendation', 'unknown')}
Business Impact Score: {blast.get('business_impact_score', '0')}/100
Estimated Customers Exposed: {blast.get('impacted_customers_estimate', 0)} accounts
Impacted Regional Zones: {", ".join(blast.get('impacted_regions', []))}

RCA Candidates (Suspected Root Causes):
{rca_summary}

Impacted Services / Downstream Cascade:
- Currently Impacted: {", ".join(blast.get('currently_impacted_services', []))}
- Likely Downstream (Next to Fail): {", ".join(blast.get('likely_downstream_services', []))}
- Impacted Shared Infrastructure: {", ".join(blast.get('impacted_infrastructure', []))}

Active Telemetry Alerts on Blast Nodes:
{alerts_summary}

Recent Incidents:
{incidents_summary}

=== CHAT HISTORY ===
{history_str}

=== USER QUESTION ===
{question}
"""

    groq_key = os.environ.get("GROQ_API_KEY")
    is_groq_valid = groq_key and not groq_key.startswith("your_")
    
    answer = ""
    if is_groq_valid:
        from app.services.groq_client import chat_with_fallback
        
        llm_messages = []
        for msg in history:
            role = msg.get("role", "user")
            if role not in ("system", "user", "assistant"):
                role = "user"
            llm_messages.append({
                "role": role,
                "content": msg.get("content", "")
            })
            
        llm_messages.append({
            "role": "user",
            "content": prompt
        })
        
        try:
            model = os.environ.get("FAST_MODEL") or "llama-3.1-8b-instant"
            answer, _ = chat_with_fallback(llm_messages, model, temperature=0.2)
        except Exception as e:
            answer = f"Groq API execution error: {str(e)}"
    else:
        # Local SRE heuristic diagnostics engine fallback
        q = question.lower()
        currently_impacted = blast.get('currently_impacted_services', [])
        likely_downstream = blast.get('likely_downstream_services', [])
        impacted_infrastructure = blast.get('impacted_infrastructure', [])
        rca_candidates = rca.get('root_cause_candidates', [])
        top_rca = rca_candidates[0]['root_cause'] if rca_candidates else "Unknown Cause"
        top_confidence = rca_candidates[0]['confidence'] if rca_candidates else 0
        fixes = rca_candidates[0]['suggested_fixes'] if rca_candidates else []

        if any(w in q for w in ["explain this blast radius", "explain"]):
            propagation_status = "spreading fast" if len(currently_impacted) >= 3 else "contained"
            ans_lines = [
                f"The target service {service} is experiencing critical degradation. Request timeouts and cascading failures are propagating downstream, causing backups in dependent services. Active remediation is required to isolate the failure zone.",
                f"• Root cause and where it started: CPU saturation on {service}.",
                f"• How many services and customers affected: {len(currently_impacted)} services and est. {blast.get('impacted_customers_estimate', 0):,} affected.",
                f"• Current propagation status: Failures are {propagation_status} along dependency paths."
            ]
            answer = "\n".join(ans_lines)
            
        elif any(w in q for w in ["identify the root cause", "root cause", "cause"]):
            candidate_lines = []
            for c in rca_candidates[:3]:
                candidate_lines.append(f"• {c['root_cause']} [{c['confidence']}% confidence]")
            candidates_str = "\n".join(candidate_lines) if candidate_lines else "• Unknown Cause [50% confidence]"
            
            ans_lines = [
                f"RCA correlation indicates the primary suspected root cause is {top_rca}.",
                candidates_str,
                f"Recommended First Action: Consider performing: {fixes[0] if fixes else 'Restart service'} immediately to stabilize the component."
            ]
            answer = "\n\n".join(ans_lines)
            
        elif any(w in q for w in ["show impact propagation", "propagation", "propagate"]):
            propagation_status = "spreading fast" if len(currently_impacted) >= 3 else "contained"
            flow_chain = " → ".join(currently_impacted[:5])
            ans_lines = [
                f"The failure is currently {propagation_status} along the downstream dependency chain.",
                flow_chain
            ]
            answer = "\n\n".join(ans_lines)
            
        elif any(w in q for w in ["list affected services", "affected services", "affected", "systems"]):
            critical_list = ", ".join(currently_impacted[:4])
            risk_list = ", ".join(likely_downstream[:4])
            total_count = len(currently_impacted) + len(likely_downstream)
            ans_lines = [
                f"[CRITICAL] {critical_list}",
                f"[AT RISK] {risk_list}",
                f"Total count: {total_count}"
            ]
            answer = "\n\n".join(ans_lines)
            
        elif any(w in q for w in ["summarize business impact", "business impact", "impact", "customers"]):
            impact_score = blast.get('business_impact_score', 0)
            customers = blast.get('impacted_customers_estimate', 0)
            regions_list = ", ".join(blast.get('impacted_regions', []))
            ans_lines = [
                f"Business Impact Score: {impact_score}/100",
                f"Affected Customers: est. {customers:,}",
                f"Regions Affected: {regions_list}"
            ]
            answer = "\n".join(ans_lines)
            
        elif any(w in q for w in ["recommend next", "next investigation", "investigate next", "next"]):
            ans_lines = [
                "1. Audit recent configuration changes and deployments on the origin service.",
                "2. Check CPU utilization and database thread pools for lock contention.",
                "3. Monitor gateway error rates and latency on downstream paths.",
                "4. Assess regional traffic load and initiate failover routing if required."
            ]
            answer = "\n".join(ans_lines)
            
        else:
            ans_lines = [
                f"Analyzing incident originating at {service}.",
                f"Operational degradation currently impacts {', '.join(currently_impacted[:3])} and downstream systems.",
                "Select a quick action below for details on root cause, propagation, affected services, or next steps."
            ]
            answer = "\n\n".join(ans_lines)

    return {
        "service": service,
        "currently_impacted": blast.get('currently_impacted_services', []),
        "likely_downstream": blast.get('likely_downstream_services', []),
        "impacted_infrastructure": blast.get('impacted_infrastructure', []),
        "impacted_regions": blast.get('impacted_regions', []),
        "answer": answer.strip()
    }
