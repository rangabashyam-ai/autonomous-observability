"""MinIO parquet — sole source for incidents and alerts."""

from __future__ import annotations

import os
from typing import Optional

import duckdb
from fastapi import HTTPException

INCIDENTS_KEY = "incidents.parquet"
ALERTS_KEY = "alerts.parquet"


class MinioIntelUnavailable(Exception):
    pass


def _bucket() -> str:
    return os.getenv("MINIO_INTEL_BUCKET", "obs-intelligence")


def _client():
    import boto3
    from botocore.client import Config

    endpoint = os.getenv("MINIO_ENDPOINT", "127.0.0.1:9000")
    secure = os.getenv("MINIO_SECURE", "false").lower() in ("1", "true", "yes")
    scheme = "https" if secure else "http"
    return boto3.client(
        "s3",
        endpoint_url=f"{scheme}://{endpoint}",
        aws_access_key_id=os.getenv("MINIO_ACCESS_KEY", "admin"),
        aws_secret_access_key=os.getenv("MINIO_SECRET_KEY", "password"),
        config=Config(
            signature_version="s3v4",
            connect_timeout=3,
            read_timeout=5,
            retries={"max_attempts": 1},
        ),
        region_name="us-east-1",
    )


def _object_exists(key: str) -> bool:
    try:
        _client().head_object(Bucket=_bucket(), Key=key)
        return True
    except Exception:
        return False


def _s3_uri(key: str) -> str:
    return f"s3://{_bucket()}/{key}"


def _duckdb():
    con = duckdb.connect()
    con.execute("LOAD httpfs;")
    endpoint = os.getenv("MINIO_ENDPOINT", "127.0.0.1:9000")
    con.execute(f"SET s3_endpoint='{endpoint}';")
    con.execute(f"SET s3_access_key_id='{os.getenv('MINIO_ACCESS_KEY', 'admin')}';")
    con.execute(f"SET s3_secret_access_key='{os.getenv('MINIO_SECRET_KEY', 'password')}';")
    con.execute(f"SET s3_use_ssl={'true' if os.getenv('MINIO_SECURE', 'false').lower() in ('1', 'true', 'yes') else 'false'};")
    con.execute("SET s3_url_style='path';")
    return con


def _require_incidents() -> None:
    if not _object_exists(INCIDENTS_KEY):
        raise MinioIntelUnavailable(f"Missing s3://{_bucket()}/{INCIDENTS_KEY}")


def _require_alerts() -> None:
    if not _object_exists(ALERTS_KEY):
        raise MinioIntelUnavailable(f"Missing s3://{_bucket()}/{ALERTS_KEY}")


def incidents_parquet_available() -> bool:
    return _object_exists(INCIDENTS_KEY)


def alerts_parquet_available() -> bool:
    return _object_exists(ALERTS_KEY)


def _normalize_entities(entities) -> list:
    if hasattr(entities, "tolist"):
        return entities.tolist()
    if isinstance(entities, list):
        return entities
    if entities:
        return [str(entities)]
    return []


def _normalize_list(value) -> list:
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, list):
        return value
    return []


def _load_raw_incidents() -> list[dict]:
    _require_incidents()
    con = _duckdb()
    rows = con.execute(f"SELECT * FROM read_parquet('{_s3_uri(INCIDENTS_KEY)}')").df().to_dict(orient="records")
    con.close()
    return rows


def to_intelligence_incident(r: dict, idx: int) -> dict:
    inc_id = str(r.get("incidentId") or f"INC-{idx + 1}")
    entities = _normalize_entities(r.get("entities"))
    alerts_data = r.get("alerts", {})
    items = alerts_data.get("items", []) if isinstance(alerts_data, dict) else []
    alert_rules = [a.get("alertRule", "") for a in items if isinstance(a, dict)]
    tactics = _normalize_list(r.get("tactics"))
    component = entities[0] if entities else "SystemComponent"
    tw = r.get("timeWindow") if isinstance(r.get("timeWindow"), dict) else {}
    desc = str(r.get("description") or "")
    return {
        "incident_id": inc_id,
        "original_id": inc_id,
        "title": str(r.get("title") or ""),
        "severity": str(r.get("severity") or "Low"),
        "state": str(r.get("status") or "Open"),
        "alerts": alert_rules,
        "symptoms": tactics,
        "root_cause": desc or "Unknown",
        "component": component,
        "fix": "Pending investigation",
        "impacted_components": entities,
        "impacted_services": [e for e in entities if str(e).startswith("ServiceTest")],
        "service": component,
        "service_id": component,
        "region": "bank-dc1",
        "environment": "production",
        "owner_team": "bank-ops",
        "start_time": tw.get("start", ""),
        "end_time": tw.get("end", ""),
        "resolution_notes": "",
        "confidence_training_value": 0.9,
    }


def to_router_incident(r: dict, idx: int) -> dict:
    base = to_intelligence_incident(r, idx)
    tw = r.get("timeWindow") if isinstance(r.get("timeWindow"), dict) else {}
    start = tw.get("start", "")
    end = tw.get("end", "")
    entities = _normalize_entities(r.get("entities"))
    return {
        **base,
        "id": base["incident_id"],
        "incidentId": base["incident_id"],
        "parquet_start_time": start,
        "parquet_end_time": end,
        "incident_time": start,
        "true_root_cause": base["root_cause"],
        "details": base["root_cause"],
        "entities": entities,
        "timeWindow": tw,
        "description": str(r.get("description") or ""),
        "status": str(r.get("status") or "Open"),
    }


def to_api_incident(r: dict, idx: int) -> dict:
    inc_id = str(r.get("incidentId") or f"INC-{idx + 1}")
    entities = _normalize_entities(r.get("entities"))
    comp = entities[0] if entities else "SystemComponent"
    created = str(r.get("createdTime") or "")
    return {
        "id": inc_id,
        "incidentId": inc_id,
        "incident_id": inc_id,
        "title": str(r.get("title") or f"Incident {inc_id}"),
        "description": str(r.get("description") or ""),
        "severity": str(r.get("severity") or "Medium"),
        "status": str(r.get("status") or "Open"),
        "component": comp,
        "cmdb_id": comp,
        "entities": entities,
        "createdTime": created,
        "created_at": created,
        "active_at": created,
        "timeWindow": r.get("timeWindow"),
        "alerts": r.get("alerts"),
        "evidence": r.get("evidence"),
        "rcaStatus": r.get("rcaStatus", "Pending"),
    }


def to_api_alert(r: dict, idx: int) -> dict:
    alt_id = str(r.get("alert_id") or f"ALT-{idx + 1}")
    rule = str(r.get("alertname") or "ObservabilityAlert")
    sev = str(r.get("severity") or "warning")
    comp = str(r.get("cmdb_id") or "SystemHost")
    desc = str(r.get("description") or "")
    fired = str(r.get("activeAt") or "")
    return {
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
        "labels": {"alertname": rule, "cmdb_id": comp, "severity": sev, "instance": comp},
        "annotations": {"summary": rule, "description": desc},
    }


def to_intelligence_alert(r: dict, idx: int) -> dict:
    flat = to_api_alert(r, idx)
    return {
        "id": flat["id"],
        "alert_id": flat["alert_id"],
        "rule": flat["alertname"],
        "title": flat["title"],
        "severity": flat["severity"],
        "signal_type": "Metric",
        "resource_type": "",
        "entity_id": flat["component"],
        "status": "open",
        "rca_status": "Pending",
        "fired_at": flat["activeAt"],
        "window_start": "",
        "window_end": "",
        "description": flat["description"],
    }


def fetch_intelligence_incidents() -> list[dict]:
    return [to_intelligence_incident(r, i) for i, r in enumerate(_load_raw_incidents())]


def fetch_router_incidents() -> list[dict]:
    return [to_router_incident(r, i) for i, r in enumerate(_load_raw_incidents())]


def fetch_incidents(
    status: Optional[str] = None,
    cmdb_id: Optional[str] = None,
    limit: int = 200,
) -> list[dict]:
    out: list[dict] = []
    for idx, r in enumerate(_load_raw_incidents()):
        item = to_api_incident(r, idx)
        st = item["status"]
        comp = item["component"]
        entities = item["entities"]
        if status and status.lower() != "all":
            if status.lower() == "open" and st.lower() in ["resolved", "closed"]:
                continue
            if status.lower() == "resolved" and st.lower() not in ["resolved", "closed"]:
                continue
            if status.lower() not in st.lower():
                continue
        if cmdb_id and cmdb_id.lower() not in comp.lower() and cmdb_id.lower() not in str(entities).lower():
            continue
        out.append(item)
        if len(out) >= limit:
            break
    return out


def fetch_alerts(limit: int = 500) -> list[dict]:
    _require_alerts()
    con = _duckdb()
    rows = con.execute(f"""
        SELECT
            data.essentials.alertId as alert_id,
            data.essentials.alertRule as alertname,
            data.essentials.severity as severity,
            data.alertContext.properties.component as cmdb_id,
            data.essentials.description as description,
            data.essentials.firedDateTime as activeAt
        FROM read_parquet('{_s3_uri(ALERTS_KEY)}')
        LIMIT {limit}
    """).df().to_dict(orient="records")
    con.close()
    return [to_api_alert(r, idx) for idx, r in enumerate(rows)]


def fetch_intelligence_alerts(limit: int = 100_000) -> list[dict]:
    return [to_intelligence_alert(r, i) for i, r in enumerate(_query_alert_rows(limit))]


def _query_alert_rows(limit: int) -> list[dict]:
    _require_alerts()
    con = _duckdb()
    rows = con.execute(f"""
        SELECT
            data.essentials.alertId as alert_id,
            data.essentials.alertRule as alertname,
            data.essentials.severity as severity,
            data.alertContext.properties.component as cmdb_id,
            data.essentials.description as description,
            data.essentials.firedDateTime as activeAt
        FROM read_parquet('{_s3_uri(ALERTS_KEY)}')
        LIMIT {limit}
    """).df().to_dict(orient="records")
    con.close()
    return rows


def find_router_incident(incident_id: str) -> dict | None:
    for inc in fetch_router_incidents():
        if inc.get("incident_id") == incident_id or inc.get("id") == incident_id or inc.get("original_id") == incident_id:
            return inc
    return None


def find_raw_incident(incident_id: str) -> dict | None:
    for idx, r in enumerate(_load_raw_incidents()):
        inc_id = str(r.get("incidentId") or f"INC-{idx + 1}")
        if inc_id == incident_id:
            return r
    return None


def http_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=str(exc))
