import urllib.request, json

payload = {
    "context": {
        "context_scope": "strict",
        "page_type": "executive",
        "selected_entity": "executive-command-center",
        "entity_data": {
            "business_health": 95,
            "active_incidents": 15,
            "sla_compliance": 98.6,
            "customer_impact": 120
        },
        "related_metrics": {
            "revenue_at_risk": 5441.0,
            "service_availability": 99.2,
            "transaction_success_rate": 99.8
        },
        "related_alerts": [
            {"id": "alert-1", "title": "Payment Auth SLA Violation", "severity": "critical", "status": "open"}
        ],
        "related_incidents": [
            {"incident_id": "INC-1001", "title": "Payment API Latency Spike", "severity": "P1"}
        ],
        "dependency_data": {},
        "analysis_results": {},
        "investigation_results": {},
        "user_question": "Explain the current executive status"
    },
    "messages": []
}

req = urllib.request.Request(
    "http://127.0.0.1:8000/api/copilot/chat",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Content-Type": "application/json"
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req) as r:
        print("Response:", json.dumps(json.loads(r.read().decode()), indent=2))
except Exception as e:
    if hasattr(e, 'read'):
        print("Error details:", e.read().decode())
    else:
        print("Error:", e)
