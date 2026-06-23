import urllib.request
import json
import time

def run_test():
    url_traces = "http://localhost:8000/api/otel/v1/traces"
    url_combined = "http://localhost:8000/api/otel/topology/combined"
    url_status = "http://localhost:8000/api/otel/status"

    print("--- 1. Checking current OTel status ---")
    req = urllib.request.Request(url_status, method="GET")
    with urllib.request.urlopen(req) as resp:
        status_before = json.loads(resp.read().decode())
        print(f"Spans before test: {status_before.get('spans_stored')}")

    # Build standard OTLP/HTTP JSON request body
    payload = {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "frontend-app"}},
                        {"key": "deployment.environment", "value": {"stringValue": "production"}}
                    ]
                },
                "scopeSpans": [
                    {
                        "spans": [
                            {
                                "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
                                "spanId": "00f067aa0ba902b7",
                                "parentSpanId": "",
                                "name": "GET /api/dashboard",
                                "kind": 2, # Server
                                "startTimeUnixNano": "1623830400000000000",
                                "endTimeUnixNano": "1623830400500000000"
                            }
                        ]
                    }
                ]
            },
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "backend-service"}},
                        {"key": "deployment.environment", "value": {"stringValue": "production"}}
                    ]
                },
                "scopeSpans": [
                    {
                        "spans": [
                            {
                                "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
                                "spanId": "0df067aa0ba902b8",
                                "parentSpanId": "00f067aa0ba902b7", # called by frontend-app
                                "name": "process-request",
                                "kind": 2, # Server
                                "startTimeUnixNano": "1623830400100000000",
                                "endTimeUnixNano": "1623830400400000000"
                            },
                            {
                                "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
                                "spanId": "0df067aa0ba902b9",
                                "parentSpanId": "0df067aa0ba902b8", # sub-span of backend-service
                                "name": "SELECT users",
                                "kind": 3, # Client call (db query)
                                "startTimeUnixNano": "1623830400150000000",
                                "endTimeUnixNano": "1623830400300000000",
                                "attributes": [
                                    {"key": "db.system", "value": {"stringValue": "postgresql"}},
                                    {"key": "db.name", "value": {"stringValue": "users-db"}}
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    }

    print("\n--- 2. Sending OTel traces to receiver ---")
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url_traces,
        data=data_bytes,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode())
        print("Response:", res)

    print("\n--- 3. Querying Combined Topology ---")
    req = urllib.request.Request(url_combined, method="GET")
    with urllib.request.urlopen(req) as resp:
        topo = json.loads(resp.read().decode())
        print("Nodes found in topology:")
        for node in topo.get("nodes", []):
            print(f"  - [{node.get('type')}] {node.get('name')} (layer: {node.get('layer')})")
        print("\nEdges found in topology:")
        for edge in topo.get("edges", []):
            print(f"  - {edge.get('source')} --({edge.get('relationship')})--> {edge.get('target')} [via: {edge.get('via')}]")
        print("\nSummary:", topo.get("summary"))

if __name__ == "__main__":
    run_test()
