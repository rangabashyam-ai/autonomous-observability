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
        # Cloud integration data
        "integrations/resources.json",
        "integrations/connections.json",
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


@router.post("/upload-dataset")
async def upload_dataset(file: UploadFile = File(...)):
    import zipfile
    import shutil
    import tempfile
    import os

    # 1. Verify it's a zip file
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported.")
        
    # 2. Read the zip content
    content = await file.read()
    
    # 3. Create a temporary folder and extract zip
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    with tempfile.TemporaryDirectory(dir=str(project_root)) as tmpdir:
        tmp_path = Path(tmpdir)
        zip_path = tmp_path / "temp.zip"
        zip_path.write_bytes(content)
        
        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(tmp_path)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to extract ZIP: {str(e)}")
            
        # Delete the zip file from tmp folder so it's not scanned
        zip_path.unlink()
        
        # 4. Search for parquet/ folder in the extracted content
        # We look for a folder containing 'service_host_map.parquet'
        target_parquet_dir = None
        target_alerts_dir = None
        target_incidents_dir = None
        
        for root, dirs, files in os.walk(tmp_path):
            root_path = Path(root)
            # Check if this folder has parquet files
            if "service_host_map.parquet" in files:
                target_parquet_dir = root_path
                # Check sibling/parent folders for alerts/incidents
                parent_dir = root_path.parent
                if (parent_dir / "alerts").exists():
                    target_alerts_dir = parent_dir / "alerts"
                if (parent_dir / "incidents").exists():
                    target_incidents_dir = parent_dir / "incidents"
                break
                
        if not target_parquet_dir:
            raise HTTPException(
                status_code=400,
                detail="Invalid dataset zip. Could not find 'service_host_map.parquet' inside."
            )
            
        # 5. Define target directories in workspace
        openrca_bank_dir = project_root / "openRCA_Bank"
        
        # Create directories if they do not exist
        openrca_bank_dir.mkdir(parents=True, exist_ok=True)
        dest_parquet_dir = openrca_bank_dir / "parquet"
        dest_alerts_dir = openrca_bank_dir / "alerts"
        dest_incidents_dir = openrca_bank_dir / "incidents"
        
        # Clean existing destination folders to avoid merging conflicts/stale files
        if dest_parquet_dir.exists():
            shutil.rmtree(dest_parquet_dir)
        dest_parquet_dir.mkdir(parents=True, exist_ok=True)
        
        # Copy parquet files
        for f in target_parquet_dir.glob("*.parquet"):
            shutil.copy(str(f), str(dest_parquet_dir / f.name))
            
        # Copy alerts if present
        if target_alerts_dir:
            if dest_alerts_dir.exists():
                shutil.rmtree(dest_alerts_dir)
            dest_alerts_dir.mkdir(parents=True, exist_ok=True)
            for f in target_alerts_dir.glob("*"):
                if f.is_file():
                    shutil.copy(str(f), str(dest_alerts_dir / f.name))
                    
        # Copy incidents if present
        if target_incidents_dir:
            if dest_incidents_dir.exists():
                shutil.rmtree(dest_incidents_dir)
            dest_incidents_dir.mkdir(parents=True, exist_ok=True)
            for f in target_incidents_dir.glob("*"):
                if f.is_file():
                    shutil.copy(str(f), str(dest_incidents_dir / f.name))
                    
        # Also copy other non-parquet files from target_parquet_dir parent if present (e.g. query.csv, record.csv)
        if target_parquet_dir != tmp_path:
            parent_dir = target_parquet_dir.parent
            for f in parent_dir.glob("*.csv"):
                shutil.copy(str(f), str(openrca_bank_dir / f.name))
            for f in parent_dir.glob("*.md"):
                shutil.copy(str(f), str(openrca_bank_dir / f.name))
        else:
            for f in tmp_path.glob("*.csv"):
                shutil.copy(str(f), str(openrca_bank_dir / f.name))
            for f in tmp_path.glob("*.md"):
                shutil.copy(str(f), str(openrca_bank_dir / f.name))
                
    # 6. Clear backend caches so that the app immediately reads the new files
    from app import parquet_store
    parquet_store.clear_cache()
    
    # 7. Clear intelligence service cache
    from app.services import intelligence as intel
    intel.clear_intelligence_cache()
    
    # 8. Clear routers incidents/alerts caches
    from app.routers import incidents as inc_router
    inc_router._csv_cache = None
    inc_router._csv_mtime = 0.0
    
    return {"status": "success", "message": "Dataset uploaded and activated successfully."}


@router.post("/upload-dataset-json")
async def upload_dataset_json(file: UploadFile = File(...)):
    # 1. Verify it's a JSON file
    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only JSON files are supported.")
    
    # 2. Read the file
    content = await file.read()
    try:
        data = json.loads(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON format: {str(e)}")
    
    # Can be a single incident object or a list of incident objects
    if isinstance(data, dict):
        incidents = [data]
    elif isinstance(data, list):
        incidents = data
    else:
        raise HTTPException(status_code=400, detail="JSON must contain a list of incidents or a single incident object.")
        
    # 3. Check the limit (strictly less than 5 incidents)
    if len(incidents) >= 5:
        raise HTTPException(status_code=400, detail="Incident list must contain less than 5 incidents.")
    if len(incidents) == 0:
        raise HTTPException(status_code=400, detail="Incident list cannot be empty.")
        
    # 4. Validate schema
    # Required keys based on openRCA_Bank format
    required_keys = ["incidentId", "title", "description", "severity", "status", "timeWindow", "alerts", "entities"]
    for idx, inc in enumerate(incidents):
        for key in required_keys:
            if key not in inc:
                raise HTTPException(status_code=400, detail=f"Incident {idx} missing required field '{key}' of openRCA_Bank format.")
        
        tw = inc.get("timeWindow")
        if not isinstance(tw, dict) or "start" not in tw or "end" not in tw:
            raise HTTPException(status_code=400, detail=f"Incident {idx} timeWindow must be a dictionary with 'start' and 'end' keys.")
            
        al = inc.get("alerts")
        if not isinstance(al, dict) or "count" not in al or "items" not in al or not isinstance(al["items"], list):
            raise HTTPException(status_code=400, detail=f"Incident {idx} alerts must be a dictionary containing 'count' and 'items' list.")
            
        if not isinstance(inc.get("entities"), list):
            raise HTTPException(status_code=400, detail=f"Incident {idx} entities must be a list of strings.")

    # 5. Define openrca_bank/incidents folder and save
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    openrca_bank_dir = project_root / "openRCA_Bank"
    dest_incidents_dir = openrca_bank_dir / "incidents"
    dest_incidents_dir.mkdir(parents=True, exist_ok=True)
    
    # Read existing custom incidents
    all_json_path = dest_incidents_dir / "all_incidents.json"
    existing_incidents = []
    if all_json_path.exists():
        try:
            with open(all_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    existing_incidents = data
        except Exception:
            pass

    # Append the new incidents to the existing ones
    for new_inc in incidents:
        # Check if it already exists, replace it if it does
        existing_idx = -1
        for idx, ex_inc in enumerate(existing_incidents):
            if ex_inc.get("incidentId") == new_inc.get("incidentId"):
                existing_idx = idx
                break
        if existing_idx != -1:
            existing_incidents[existing_idx] = new_inc
        else:
            existing_incidents.append(new_inc)
            
    # Write to all_incidents.json
    with open(all_json_path, "w", encoding="utf-8") as f:
        json.dump(existing_incidents, f, indent=2)
        
    # Clean up individual incident_*.json files in the directory to prevent load collisons
    for f in dest_incidents_dir.glob("incident_*.json"):
        try:
            f.unlink()
        except Exception:
            pass

    # 6. Clear caches
    from app import parquet_store
    parquet_store.clear_cache()
    from app.services import intelligence as intel
    intel.clear_intelligence_cache()
    from app.routers import incidents as inc_router
    inc_router._csv_cache = None
    inc_router._csv_mtime = 0.0

    return {"status": "success", "message": f"Successfully uploaded and activated {len(incidents)} incidents."}


@router.post("/add-incident")
async def add_incident(incident: dict):
    # Extract the overwrite flag (not part of the openRCA_Bank schema)
    overwrite = bool(incident.pop("overwrite", False))

    # 1. Validate schema
    required_keys = ["incidentId", "title", "description", "severity", "status", "timeWindow", "alerts", "entities"]
    for key in required_keys:
        if key not in incident:
            raise HTTPException(status_code=400, detail=f"Missing required field '{key}' of openRCA_Bank format.")
            
    tw = incident.get("timeWindow")
    if not isinstance(tw, dict) or "start" not in tw or "end" not in tw:
        raise HTTPException(status_code=400, detail="timeWindow must be a dictionary with 'start' and 'end' keys.")
        
    al = incident.get("alerts")
    if not isinstance(al, dict) or "count" not in al or "items" not in al or not isinstance(al["items"], list):
        raise HTTPException(status_code=400, detail="alerts must be a dictionary containing 'count' and 'items' list.")
        
    if not isinstance(incident.get("entities"), list):
        raise HTTPException(status_code=400, detail="entities must be a list of strings.")

    # 2. Load existing incidents from openRCA_Bank/incidents/all_incidents.json
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    openrca_bank_dir = project_root / "openRCA_Bank"
    dest_incidents_dir = openrca_bank_dir / "incidents"
    dest_incidents_dir.mkdir(parents=True, exist_ok=True)
    all_json_path = dest_incidents_dir / "all_incidents.json"
    
    incidents = []
    if all_json_path.exists():
        try:
            with open(all_json_path, "r", encoding="utf-8") as f:
                incidents = json.load(f)
                if not isinstance(incidents, list):
                    incidents = []
        except Exception:
            incidents = []
            
    # 3. Check for duplicate incidentId
    existing_idx = -1
    for idx, inc in enumerate(incidents):
        if inc.get("incidentId") == incident.get("incidentId"):
            existing_idx = idx
            break

    if existing_idx != -1 and not overwrite:
        raise HTTPException(
            status_code=409,
            detail=f"Incident '{incident.get('incidentId')}' already exists. Set overwrite=true to replace it."
        )
            
    if existing_idx != -1:
        incidents[existing_idx] = incident
    else:
        incidents.append(incident)
        
    # 4. Write back to file
    with open(all_json_path, "w", encoding="utf-8") as f:
        json.dump(incidents, f, indent=2)
        
    # 5. Clear caches
    from app import parquet_store
    parquet_store.clear_cache()
    from app.services import intelligence as intel
    intel.clear_intelligence_cache()
    from app.routers import incidents as inc_router
    inc_router._csv_cache = None
    inc_router._csv_mtime = 0.0

    return {"status": "success", "message": f"Incident {incident.get('incidentId')} saved successfully."}

