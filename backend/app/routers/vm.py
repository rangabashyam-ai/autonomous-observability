from fastapi import APIRouter, HTTPException, Query
from typing import Optional
import os
import requests
import logging
import json
from pathlib import Path

log = logging.getLogger("api")

router = APIRouter()

# The VM IP and port where api.py is running
VM_API_URL = os.getenv("VM_API_URL", "http://127.0.0.1:8080")

def _find_bank_root() -> Path:
    env_root = os.environ.get("BANK_ROOT")
    if env_root:
        return Path(env_root)
        
    local_path = Path(__file__).resolve().parent.parent.parent.parent / "openRCA_Bank"
    if (local_path / "incidents").is_dir():
        return local_path
        
    pictures_path = Path(r"C:\Users\GKDSSPSairam\Pictures\openRCA_Bank")
    if (pictures_path / "incidents").is_dir():
        return pictures_path
        
    return local_path

_BANK_ROOT = _find_bank_root()


def _get_local_bank_incidents(limit: int) -> list:
    incidents_dir = _BANK_ROOT / "incidents"
    incidents = []
    if incidents_dir.is_dir():
        for entry in sorted(os.scandir(incidents_dir), key=lambda e: e.name):
            if entry.name.startswith("incident_") and entry.name.endswith(".json"):
                try:
                    with open(entry.path, "r", encoding="utf-8") as f:
                        incidents.append(json.load(f))
                        if len(incidents) >= limit:
                            break
                except Exception:
                    pass
    return incidents

def _get_local_bank_alerts(limit: int) -> list:
    alerts_dir = _BANK_ROOT / "alerts"
    alerts = []
    if alerts_dir.is_dir():
        for entry in sorted(os.scandir(alerts_dir), key=lambda e: e.name):
            if entry.name.startswith("alert_") and entry.name.endswith(".json"):
                try:
                    with open(entry.path, "r", encoding="utf-8") as f:
                        raw = json.load(f)
                        data = raw.get("data", {})
                        ess = data.get("essentials", {})
                        ctx = data.get("alertContext", {}).get("properties", {})
                        
                        alt_id = ess.get("alertId", f"ALT-{len(alerts)+1}")
                        rule = ess.get("alertRule", "ObservabilityAlert")
                        sev = ess.get("severity", "warning")
                        comp = ctx.get("component", "SystemHost")
                        desc = ess.get("description", "")
                        fired = ess.get("firedDateTime", "")
                        
                        alerts.append({
                            "id": alt_id,
                            "alertId": alt_id,
                            "alert_id": alt_id,
                            "alertname": rule,
                            "title": rule,
                            "severity": sev,
                            "status": "firing",
                            "state": "firing",
                            "component": comp,
                            "cmdb_id": comp,
                            "description": desc,
                            "activeAt": fired,
                            "firedDateTime": fired,
                            "labels": {
                                "alertname": rule,
                                "cmdb_id": comp,
                                "severity": sev,
                                "instance": comp
                            },
                            "annotations": {
                                "summary": rule,
                                "description": desc
                            }
                        })
                        if len(alerts) >= limit:
                            break
                except Exception:
                    pass
    return alerts

@router.get("/incidents")
def get_vm_incidents(
    cmdb_id: Optional[str] = Query(None, description="Filter by component name"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(200, description="Limit records"),
    raw: bool = Query(False, description="Return raw array directly")
):
    try:
        url = f"{VM_API_URL}/incidents"
        params = {"limit": limit, "raw": raw}
        if cmdb_id: params["cmdb_id"] = cmdb_id
        if status: params["status"] = status
        
        log.info(f"Proxying request to VM: {url}")
        res = requests.get(url, params=params, timeout=2)
        res.raise_for_status()
        return res.json()
    except requests.exceptions.RequestException as e:
        log.warning(f"Failed to fetch from VM API ({e}). Falling back to local data.")
        local_data = _get_local_bank_incidents(limit)
        return {
            "status": "success",
            "source": "local_fallback",
            "count": len(local_data),
            "incidents": local_data,
        }


@router.get("/alerts")
def get_vm_alerts(
    state: Optional[str] = Query(None, description="Filter state"),
    limit: int = Query(500, description="Limit records"),
    raw: bool = Query(False, description="Return raw array directly")
):
    try:
        url = f"{VM_API_URL}/alerts"
        params = {"limit": limit, "raw": raw}
        if state: params["state"] = state
        
        log.info(f"Proxying request to VM: {url}")
        res = requests.get(url, params=params, timeout=2)
        res.raise_for_status()
        return res.json()
    except requests.exceptions.RequestException as e:
        log.warning(f"Failed to fetch from VM API ({e}). Falling back to local alerts data.")
        local_data = _get_local_bank_alerts(limit)
        return {
            "status": "success",
            "source": "local_fallback",
            "count": len(local_data),
            "alerts": local_data,
        }
