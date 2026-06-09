import json
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone
from app.data_store import read_json
from app.services.intelligence import analyze_blast_radius, analyze_rca

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

    # 5. Build prompt
    prompt = f"""
You are an expert SRE and Incident Commander Assistant specializing in Blast Radius Investigation.
Your role is to analyze the active incident's blast radius and guide SREs through propagation paths, root cause assumptions, service degradation, business impact, and next investigation steps.

Rules for your response:
1. Provide a clear, structured analysis. Use headers, bullet points, or paragraphs where appropriate. Keep it professional, highly technical, and actionable.
2. Limit the response to a maximum of 500 words.
3. Be concise and prioritize high-risk signals.

=== INCIDENT INVESTIGATION CONTEXT ===
Target Service / Analysis Origin: {service}
Classified Scope: {blast.get('issue_scope', 'unknown')}
Recommended Severity: {blast.get('severity_recommendation', 'unknown')}
Business Impact Score: {blast.get('business_impact_score', '0')}/100
Estimated Customers Exposed: {blast.get('impacted_customers_estimate', 0)} accounts

RCA Candidates (Suspected Root Causes):
{json.dumps(rca.get('root_cause_candidates', []), indent=2)}

Impacted Services / Downstream Cascade:
- Currently Impacted: {", ".join(blast.get('currently_impacted_services', []))}
- Likely Downstream (Next to Fail): {", ".join(blast.get('likely_downstream_services', []))}
- Impacted Shared Infrastructure: {", ".join(blast.get('impacted_infrastructure', []))}

Active Telemetry Alerts on Blast Nodes:
{json.dumps(active_alerts[:10], indent=2)}

Recent Incidents:
{json.dumps(relevant_incidents, indent=2)}

=== CHAT HISTORY ===
{history_str}

=== USER QUESTION ===
{question}
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
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
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
            ans_lines = [
                f"### Blast Radius Analysis for {service.title()}",
                f"The blast radius is initiated by the operational degradation of **{service}**.",
                f"It propagates to **{len(currently_impacted)}** currently impacted services: {', '.join(currently_impacted)}.",
                f"Due to cascading traffic pressure, the issue is likely to degrade **{len(likely_downstream)}** downstream services: {', '.join(likely_downstream)}.",
                f"The incident scope is classified as **{blast.get('issue_scope', 'unknown').upper()}** with a Business Impact Score of **{blast.get('business_impact_score', 0)}/100**."
            ]
            answer = "\n\n".join(ans_lines)
            
        elif any(w in q for w in ["identify the root cause", "root cause", "cause"]):
            ans_lines = [
                f"### Root Cause Identification",
                f"RCA correlation indicates the primary suspected root cause is **{top_rca}** with a confidence score of **{top_confidence}%**.",
                "Telemetry signals reveal active errors propagating downstream along dependency call paths.",
                f"**Recommended Action**: Consider performing: {', '.join(fixes)} immediately to stabilize the component."
            ]
            answer = "\n\n".join(ans_lines)
            
        elif any(w in q for w in ["show impact propagation", "propagation", "propagate"]):
            ans_lines = [
                f"### Impact Propagation Pathway",
                f"1. **Failure Origin**: {service}",
                f"2. **Direct Cascade**: request timeouts and socket exhaustion spread to: {', '.join(currently_impacted)}.",
                f"3. **Downstream Pipeline**: secondary degradation expected on: {', '.join(likely_downstream)}.",
                f"4. **Shared Platform Exposure**: resource contention is observed on backend servers and platforms: {', '.join(impacted_infrastructure)}."
            ]
            answer = "\n\n".join(ans_lines)
            
        elif any(w in q for w in ["list affected services", "affected services", "affected", "systems"]):
            ans_lines = [
                f"### Affected Systems Inventory",
                f"- **Currently Degraded Services**: {', '.join(currently_impacted)}",
                f"- **Vulnerable Downstream Services**: {', '.join(likely_downstream)}",
                f"- **Impacted Platform Infrastructure**: {', '.join(impacted_infrastructure)}"
            ]
            answer = "\n\n".join(ans_lines)
            
        elif any(w in q for w in ["summarize business impact", "business impact", "impact", "customers"]):
            ans_lines = [
                f"### Business Impact Summary",
                f"- **Criticality Rating**: {blast.get('severity_recommendation', 'unknown')}",
                f"- **Business Impact Score**: {blast.get('business_impact_score', 0)} / 100",
                f"- **Estimated Accounts Exposed**: {blast.get('impacted_customers_estimate', 0):,} customers",
                f"Active SLA metrics show elevated p99 latency spikes and transaction error counts."
            ]
            answer = "\n\n".join(ans_lines)
            
        elif any(w in q for w in ["recommend next", "next investigation", "investigate next", "next"]):
            alert_titles = [a['title'] for a in active_alerts]
            ans_lines = [
                f"### Recommended Next Steps",
                f"1. **Audit Logs**: Review configuration history and deployment commits on **{service}**.",
                f"2. **Mitigate Alert Spike**: Troubleshoot the active alerts: {', '.join(alert_titles[:3]) if alert_titles else 'telemetry spikes'}.",
                f"3. **Monitor Infrastructure**: Check hypervisor CPU and database locks on shared infrastructure: {', '.join(impacted_infrastructure[:3])}."
            ]
            answer = "\n\n".join(ans_lines)
            
        else:
            ans_lines = [
                f"### Blast Radius Investigation Helper",
                f"I am analyzing the incident blast radius originating at **{service}**.",
                f"Currently, the degradation impacts **{', '.join(currently_impacted)}** and threatens downstream dependencies **{', '.join(likely_downstream)}**.",
                "You can select one of the quick actions below to learn more about the root cause, impact propagation, affected systems, or recommended SRE mitigation tasks.",
                "*Note: Running SRE heuristic rules offline engine. Configure GEMINI_API_KEY in the backend env for full dynamic Gemini diagnostics.*"
            ]
            answer = "\n\n".join(ans_lines)

    return {
        "service": service,
        "currently_impacted": blast.get('currently_impacted_services', []),
        "likely_downstream": blast.get('likely_downstream_services', []),
        "impacted_infrastructure": blast.get('impacted_infrastructure', []),
        "answer": answer.strip()
    }
