import urllib.request
import json
import sys

payload = {
    "context": {
        "page_type": "executive",
        "selected_entity": "Executive Command Center",
        "entity_data": {
            "sla": "98.60%",
            "active_incidents": 5
        },
        "user_question": "Can you explain the root cause of these active incidents?"
    },
    "messages": [
        {"role": "user", "content": "Can you explain the root cause of these active incidents?"}
    ]
}

req = urllib.request.Request(
    "http://localhost:8000/api/copilot/chat",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Content-Type": "application/json"
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req, timeout=15) as r:
        response_data = json.loads(r.read().decode("utf-8"))
        print("Response status: SUCCESS")
        print(json.dumps(response_data, indent=2))
except urllib.error.HTTPError as e:
    print(f"HTTP Error: {e.code} {e.reason}")
    try:
        print("Details:", e.read().decode("utf-8"))
    except Exception:
        pass
except Exception as e:
    print(f"Error occurred: {e}")
