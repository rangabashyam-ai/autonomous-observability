import json
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException

from app.data_store import read_json, write_json, DATA_DIR

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/data-status")
def data_status():
    files = [
        "incidents/service_now_incidents.json",
        "incidents/jira_tickets.json",
        "monitoring/alerts.json",
        "monitoring/metrics.json",
        "monitoring/events.json",
        "monitoring/dashboard.json",
        "changes/deployments.json",
        "changes/change_records.json",
        "dependencies/services.json",
        "dependencies/infrastructure.json",
        "dependencies/dependency_graph.json",
        "rca/knowledge_graph.json",
        "rca/incident_graph.json",
    ]
    status = []
    for f in files:
        path = DATA_DIR / f
        entry = {"file": f, "exists": path.exists(), "size_bytes": 0, "records": 0}
        if path.exists():
            entry["size_bytes"] = path.stat().st_size
            try:
                data = read_json(f)
                if isinstance(data, dict):
                    for key in ("incidents", "alerts", "nodes", "edges", "services", "deployments", "changes"):
                        if key in data:
                            val = data[key]
                            entry["records"] = len(val) if isinstance(val, list) else 0
                            break
            except Exception:
                pass
        status.append(entry)
    return {"files": status, "data_dir": str(DATA_DIR)}


@router.post("/regenerate")
def regenerate_data():
    import subprocess
    script = Path(__file__).resolve().parent.parent.parent.parent / "scripts" / "generate_synthetic_data.py"
    result = subprocess.run(
        ["python3", str(script)],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr or "Generation failed")
    return {"status": "success", "output": result.stdout}


@router.post("/upload/{category}")
async def upload_data_file(category: str, file: UploadFile = File(...)):
    allowed = {
        "incidents": "incidents/service_now_incidents.json",
        "alerts": "monitoring/alerts.json",
        "dependencies": "dependencies/dependency_graph.json",
        "knowledge-graph": "rca/knowledge_graph.json",
    }
    if category not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown category. Allowed: {list(allowed.keys())}")
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    write_json(allowed[category], data)
    return {"status": "uploaded", "file": allowed[category]}
