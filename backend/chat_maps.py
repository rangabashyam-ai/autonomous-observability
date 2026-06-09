#!/usr/bin/env python
"""
chat_maps.py
Traces dependency paths in the Autonomous Observability data store,
collects details/alerts/changes for each component, and checks for
errors using the Gemini API.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path

# Load dotenv from current directory or parent directory
try:
    from dotenv import load_dotenv
    # Search for .env in current directory (backend) or parent directory (workspace root)
    env_path_backend = Path(__file__).resolve().parent / ".env"
    env_path_root = Path(__file__).resolve().parent.parent / ".env"
    if env_path_backend.exists():
        load_dotenv(dotenv_path=env_path_backend)
    elif env_path_root.exists():
        load_dotenv(dotenv_path=env_path_root)
    else:
        load_dotenv()
except ImportError:
    pass

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

def read_json(filename: str) -> dict | list:
    filepath = DATA_DIR / filename
    if not filepath.exists():
        return {}
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)

def load_dependency_edges() -> list[dict]:
    data = read_json("dependencies/dependency_graph.json")
    return data.get("edges", [])

def load_alerts() -> list[dict]:
    data = read_json("monitoring/alerts.json")
    return data.get("alerts", [])

def load_incidents() -> list[dict]:
    data = read_json("incidents/service_now_incidents.json")
    return data.get("incidents", [])

def load_changes() -> list[dict]:
    data = read_json("changes/change_records.json")
    return data.get("changes", [])

def load_deployments() -> list[dict]:
    data = read_json("changes/deployments.json")
    return data.get("deployments", [])

def trace_downstream(start: str, edges: list[dict], max_depth: int = 5) -> list[str]:
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

def trace_upstream(start: str, edges: list[dict], max_depth: int = 5) -> list[str]:
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

def call_gemini(prompt: str) -> str:
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")

    if gemini_key:
        # Call official Gemini API
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
        body = {
            "contents": [{
                "parts": [{"text": prompt}]
            }]
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
                return res["candidates"][0]["content"]["parts"][0]["text"]
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            print(f"Gemini API Error: {detail}", file=sys.stderr)
            raise RuntimeError(f"Gemini API returned code {e.code}") from e
    elif openrouter_key:
        # Fallback to OpenRouter using Gemini model as configured in env
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
                return res["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            print(f"OpenRouter API Error: {detail}", file=sys.stderr)
            raise RuntimeError(f"OpenRouter API returned code {e.code}") from e
    else:
        print("Error: Neither GEMINI_API_KEY nor OPENROUTER_API_KEY found in environment.", file=sys.stderr)
        sys.exit(1)

def main():
    print("=========================================================")
    print("           Autonomous Observability - Chat Maps          ")
    print("=========================================================")
    
    # 1. Load topology and data
    edges = load_dependency_edges()
    all_alerts = load_alerts()
    all_incidents = load_incidents()
    all_changes = load_changes()
    all_deployments = load_deployments()

    # Determine unique components
    components = set()
    for e in edges:
        components.add(e["source"])
        components.add(e["target"])
    
    sorted_components = sorted(list(components))

    # Show options
    print("\nAvailable entry-point services:")
    common_entry_points = [c for c in sorted_components if "service" in c or "api" in c or "gateway" in c][:10]
    for idx, component in enumerate(common_entry_points, 1):
        print(f"  {idx}. {component}")
    print("  Or type any other component name from the system.")

    choice = input("\nSelect a service number or enter a component name (default: payment-authorization): ").strip()
    
    selected_service = "payment-authorization"
    if choice:
        if choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(common_entry_points):
                selected_service = common_entry_points[idx]
            else:
                print(f"Invalid choice, defaulting to '{selected_service}'")
        else:
            selected_service = choice

    if selected_service not in components:
        print(f"Warning: Component '{selected_service}' not found in dependency edges, searching...")
        # try case insensitive match
        found = False
        for c in components:
            if selected_service.lower() in c.lower():
                selected_service = c
                print(f"Matched component: '{selected_service}'")
                found = True
                break
        if not found:
            print("Component not found in dependency graph. Exiting.")
            sys.exit(1)

    print(f"\nTracing dependency path for starting node: {selected_service}")
    
    # 2. Get downstream and upstream paths
    downstream = trace_downstream(selected_service, edges)
    upstream = trace_upstream(selected_service, edges)
    
    # Combined path (root cause + downstream + upstream context)
    dependency_path = [selected_service] + downstream
    if upstream:
        dependency_path = upstream + dependency_path
        
    print(f"Computed dependency path ({len(dependency_path)} components):")
    print(" -> ".join(dependency_path))

    # 3. Gather details of each component in path
    path_details = {}
    for comp in dependency_path:
        comp_alerts = [
            {
                "id": a["id"],
                "title": a["title"],
                "severity": a["severity"],
                "status": a["status"],
                "description": a.get("description", "")
            }
            for a in all_alerts
            if (a.get("entity_id") == comp or comp in a.get("description", "")) and a.get("status") in ("open", "acknowledged")
        ]
        
        comp_incidents = [
            {
                "id": inc["incident_id"],
                "title": inc["title"],
                "severity": inc["severity"],
                "root_cause": inc["root_cause"]
            }
            for inc in all_incidents
            if comp in inc.get("impacted_components", []) or comp == inc.get("service_id")
        ]
        
        comp_changes = [
            {
                "id": c["id"],
                "title": c["title"],
                "risk": c.get("risk", "medium"),
                "status": c.get("status", "")
            }
            for c in all_changes
            if any(comp in svc for svc in c.get("affected_services", [])) or comp in c["title"].lower()
        ]
        
        comp_deployments = [
            {
                "service": d["service"],
                "version": d["version"],
                "status": d["status"]
            }
            for d in all_deployments
            if comp in d["service"] or d["service"] in comp
        ]
        
        path_details[comp] = {
            "alerts": comp_alerts,
            "incidents": comp_incidents,
            "changes": comp_changes,
            "deployments": comp_deployments
        }

    # Print collected metadata overview
    print("\nCollected component details along path:")
    for comp, details in path_details.items():
        print(f"\n[Component: {comp}]")
        print(f"  Alerts: {len(details['alerts'])} open/acknowledged")
        for a in details['alerts']:
            print(f"    - [{a['severity'].upper()}] {a['title']}: {a['description']}")
        print(f"  Recent Incidents: {len(details['incidents'])}")
        for i in details['incidents']:
            print(f"    - [{i['severity']}] {i['id']}: {i['title']} (RCA: {i['root_cause']})")
        print(f"  Deployments/Changes: {len(details['changes']) + len(details['deployments'])}")

    # 4. Ask Gemini for incident assessment
    print("\nCalling Gemini for path error check & analysis...")
    
    prompt = f"""
You are an expert SRE and Systems Architect. Analyze the following dependency path for cascading errors, faults, and performance risks.

Dependency Path Flow:
{" ➔ ".join(dependency_path)}

Component Telemetry & Incident Logs:
{json.dumps(path_details, indent=2)}

Please write a structured incident report addressing:
1. **Critical Anomalies**: Identify which components along the path have active errors, alerts, or recent risky changes.
2. **Failure Analysis**: Explain how the failure propagates between these components (downstream impact / upstream backpressure).
3. **Resolution Playbook**: Suggest immediate concrete steps to mitigate the issues identified.
"""
    
    try:
        report = call_gemini(prompt)
        print("\n=========================================================")
        print("                    Gemini SRE Report                    ")
        print("=========================================================")
        print(report)
        print("=========================================================")
        
        # Interactive Chat loop
        print("\n[Chat Option Enabled]")
        print("Ask any further questions about the dependency path, specific components, or error logs.")
        print("Type 'exit' or 'quit' to close the session.")
        
        while True:
            try:
                question = input("\nChat > ").strip()
                if not question:
                    continue
                if question.lower() in ("exit", "quit"):
                    print("Exiting Chat. Goodbye!")
                    break
                
                print("Thinking...")
                chat_prompt = f"""
You are an expert SRE assistant. Help answer questions regarding the following dependency path:
{" -> ".join(dependency_path)}

Component Telemetry Data:
{json.dumps(path_details, indent=2)}

User Question: {question}
"""
                response = call_gemini(chat_prompt)
                print("\n---------------------------------------------------------")
                print(response)
                print("---------------------------------------------------------")
            except (KeyboardInterrupt, EOFError):
                print("\nExiting Chat. Goodbye!")
                break
            except Exception as e:
                print(f"Error: {e}")
    except Exception as e:
        print(f"\nError executing Gemini analysis: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
