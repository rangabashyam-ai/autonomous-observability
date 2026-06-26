"""
parquet_store.py
Queries bank telemetry parquet files and returns data shaped identically
to the JSON files they replace.  Called by data_store.read_json() when
the corresponding JSON file does not exist on disk.

Default parquet directory: C:\\Users\\Infobell\\Desktop\\RCA_CORR\\openRCA_Bank\\parquet
Override with the PARQUET_DIR environment variable.

Parquet files consumed:
  metric_app.parquet       — per-service request metrics (rr, sr, cnt, mrt)
  metric_container.parquet — per-host OS/infra KPI metrics
  log_service.parquet      — raw service log entries
  service_host_map.parquet — service <-> cmdb_id co-occurrence mapping
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

PARQUET_DIR = Path(
    os.environ.get(
        "PARQUET_DIR",
        str(Path(__file__).resolve().parent.parent.parent / "openRCA_Bank" / "parquet"),
    )
)

def is_dataset_available() -> bool:
    required_files = [
        "service_host_map.parquet",
        "metric_app.parquet",
        "metric_container.parquet",
        "log_service.parquet"
    ]
    if not PARQUET_DIR.exists():
        return False
    for f in required_files:
        if not (PARQUET_DIR / f).exists():
            return False
    return True


def get_business_services() -> list[dict]:
    if not is_dataset_available():
        return []
    try:
        shm = _svc_host_map()
        unique_svcs = sorted(shm["service"].dropna().unique().tolist())
        return [
            {
                "id": f"{svc}-bs",
                "name": svc.replace("-", " ").title(),
                "microservices": [svc]
            }
            for svc in unique_svcs
        ]
    except Exception:
        return []


def get_bs_microservices() -> dict[str, list[str]]:
    if not is_dataset_available():
        return {}
    try:
        shm = _svc_host_map()
        unique_svcs = shm["service"].dropna().unique().tolist()
        return {f"{svc}-bs": [svc] for svc in unique_svcs}
    except Exception:
        return {}


def get_ms_to_bs() -> dict[str, str]:
    if not is_dataset_available():
        return {}
    try:
        shm = _svc_host_map()
        unique_svcs = shm["service"].dropna().unique().tolist()
        return {svc: f"{svc}-bs" for svc in unique_svcs}
    except Exception:
        return {}

# ── lazy in-memory cache (loaded once per process) ──────────────────────────────
_cache: dict[str, pd.DataFrame] = {}


def _load(name: str, **kw) -> pd.DataFrame:
    if name not in _cache:
        _cache[name] = pd.read_parquet(PARQUET_DIR / name, **kw)
    return _cache[name]


def _svc_host_map() -> pd.DataFrame:
    return _load("service_host_map.parquet")


def _metric_app() -> pd.DataFrame:
    return _load("metric_app.parquet")


def _metric_cpu() -> pd.DataFrame:
    """Host CPU data only — predicate push-down keeps the load small."""
    key = "metric_container_cpu"
    if key not in _cache:
        _cache[key] = pd.read_parquet(
            PARQUET_DIR / "metric_container.parquet",
            filters=[("kpi_name", "==", "OSLinux-CPU_CPU_CPUCpuUtil")],
        )
    return _cache[key]


# ── helpers ──────────────────────────────────────────────────────────────────────

def _ts_iso(ts_s) -> str:
    return datetime.fromtimestamp(int(ts_s), tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def _sid(prefix: str, *parts) -> str:
    h = hashlib.md5("".join(str(p) for p in parts).encode()).hexdigest()[:8]
    return f"{prefix}-{h}"


def _host_type_layer(cid: str) -> tuple[str, str]:
    u = cid.upper()
    if u.startswith("IG"):
        return "load_balancer", "server"
    if u.startswith("MG"):
        return "gateway", "server"
    if u.startswith("TOMCAT"):
        return "server", "server"
    if u.startswith("DOCKER"):
        return "container", "server"
    if u.startswith("MYSQL"):
        return "database", "server"
    return "server", "server"


# ── public router ────────────────────────────────────────────────────────────────

_ROUTES: dict[str, str | None] = {
    "monitoring/metrics.json":              "_q_metrics",
    "monitoring/alerts.json":               "_q_alerts",
    "monitoring/events.json":               "_q_events",
    "monitoring/dashboard.json":            "_q_dashboard",
    "dependencies/services.json":           "_q_services",
    "dependencies/infrastructure.json":     "_q_infrastructure",
    "dependencies/dependency_graph.json":   "_q_dep_graph",
    "incidents/service_now_incidents.json": "_q_incidents",
    "incidents/jira_tickets.json":          None,
    "incidents/change_requests.json":       None,
    "changes/change_records.json":          None,
    "changes/deployments.json":             None,
    "rca/knowledge_graph.json":             "_q_knowledge_graph",
    "rca/incident_graph.json":              "_q_incident_graph",
}

_EMPTY_WRAPPERS: dict[str, dict] = {
    "incidents/jira_tickets.json":    {"tickets": []},
    "incidents/change_requests.json": {"change_requests": []},
    "changes/change_records.json":    {"changes": []},
    "changes/deployments.json":       {"deployments": []},
}


_query_cache: dict[str, dict | list] = {}


def query(filename: str) -> dict | list:
    """Route a logical JSON filename to its parquet query function."""
    if filename in _query_cache:
        return _query_cache[filename]
    handler_name = _ROUTES.get(filename)
    if handler_name is None:
        return _EMPTY_WRAPPERS.get(filename, {})
    fn = globals().get(handler_name)
    if fn is None:
        return _EMPTY_WRAPPERS.get(filename, {})
    res = fn()
    if is_dataset_available():
        _query_cache[filename] = res
    return res


# ── query implementations ────────────────────────────────────────────────────────

def _q_metrics() -> dict:
    if not is_dataset_available():
        return {"metrics": [], "dataset_available": False}
    ma = _metric_app().copy()
    ma["hour"] = (ma["timestamp_s"] // 3600) * 3600
    hourly = (
        ma.groupby(["service", "hour"])
          .agg(rr=("rr", "mean"), sr=("sr", "mean"), cnt=("cnt", "sum"), mrt=("mrt", "mean"))
          .reset_index()
          .sort_values("hour")
    )

    COLS = [
        ("request_rate",       "rr",  "req/s"),
        ("success_rate",       "sr",  "%"),
        ("request_count",      "cnt", "count"),
        ("mean_response_time", "mrt", "ms"),
    ]

    metrics: list[dict] = []
    for svc, grp in hourly.groupby("service"):
        for metric_name, col, unit in COLS:
            pts = [
                {"timestamp": _ts_iso(int(r.hour)), "value": round(float(getattr(r, col)), 3)}
                for r in grp.itertuples()
                if not pd.isna(getattr(r, col))
            ]
            if pts:
                metrics.append({"entity_id": svc, "metric": metric_name, "unit": unit, "points": pts})

    # Per-host CPU time series from metric_container
    try:
        cpu = _metric_cpu().copy()
        cpu["hour"] = (cpu["timestamp_s"] // 3600) * 3600
        cpu_h = (
            cpu.groupby(["cmdb_id", "hour"])["value"]
               .mean()
               .reset_index()
               .sort_values("hour")
        )
        for cid, grp in cpu_h.groupby("cmdb_id"):
            pts = [
                {"timestamp": _ts_iso(int(r.hour)), "value": round(float(r.value), 3)}
                for r in grp.itertuples()
            ]
            if pts:
                metrics.append({"entity_id": cid, "metric": "cpu", "unit": "%", "points": pts})
    except Exception:
        pass

    return {"metrics": metrics}


def _q_alerts() -> dict:
    if not is_dataset_available():
        return {"alerts": [], "dataset_available": False}
    ma = _metric_app().copy()
    ma["hour"] = (ma["timestamp_s"] // 3600) * 3600

    # One alert per (service, hour) for each anomaly type
    sr_bad = ma[(ma["sr"] < 99.0) & (ma["cnt"] > 5)]
    sr_agg = (
        sr_bad.groupby(["service", "hour"])
              .agg(sr=("sr", "min"), timestamp_s=("timestamp_s", "first"))
              .reset_index()
    )

    mrt_bad = ma[(ma["mrt"] > 500.0) & (ma["cnt"] > 5)]
    mrt_agg = (
        mrt_bad.groupby(["service", "hour"])
               .agg(mrt=("mrt", "max"), timestamp_s=("timestamp_s", "first"))
               .reset_index()
    )

    alerts: list[dict] = []

    for r in sr_agg.itertuples():
        alerts.append({
            "id": _sid("alert", r.service, "sr", int(r.hour)),
            "title": "High Error Rate",
            "description": f"Success rate dropped to {r.sr:.1f}% on {r.service}",
            "source": "metric_app",
            "severity": "critical" if r.sr < 95.0 else "warning",
            "status": "open",
            "metric": "success_rate",
            "entity_id": r.service,
            "entity_type": "service",
            "value": round(float(r.sr), 2),
            "threshold": 99.0,
            "triggered_at": _ts_iso(r.timestamp_s),
        })

    for r in mrt_agg.itertuples():
        alerts.append({
            "id": _sid("alert", r.service, "mrt", int(r.hour)),
            "title": "High Latency",
            "description": f"Mean response time reached {r.mrt:.0f} ms on {r.service}",
            "source": "metric_app",
            "severity": "critical" if r.mrt > 1000.0 else "warning",
            "status": "open",
            "metric": "mean_response_time",
            "entity_id": r.service,
            "entity_type": "service",
            "value": round(float(r.mrt), 2),
            "threshold": 500.0,
            "triggered_at": _ts_iso(r.timestamp_s),
        })

    alerts.sort(key=lambda a: a["triggered_at"], reverse=True)
    return {"alerts": alerts[:1000]}


def _q_events() -> dict:
    """Stream log_service.parquet in batches; stop once 500 unique events are collected."""
    if not is_dataset_available():
        return {"events": [], "dataset_available": False}
    events: list[dict] = []
    seen: set[tuple] = set()

    pf = pq.ParquetFile(PARQUET_DIR / "log_service.parquet")
    cols = ["cmdb_id", "log_name", "value", "timestamp_s"]

    for batch in pf.iter_batches(batch_size=100_000, columns=cols):
        df = batch.to_pandas()
        df["hour"] = (df["timestamp_s"] // 3600) * 3600

        for r in df.drop_duplicates(["cmdb_id", "log_name", "hour"]).itertuples():
            key = (r.cmdb_id, r.log_name, int(r.hour))
            if key in seen:
                continue
            seen.add(key)
            msg = str(r.value)
            events.append({
                "id": _sid("event", r.cmdb_id, r.log_name, int(r.hour)),
                "type": r.log_name,
                "source": "log_collector",
                "entity_id": r.cmdb_id,
                "message": msg[:200],
                "severity": (
                    "warning"
                    if any(w in msg.lower() for w in ("error", "exception", "fail", "oom"))
                    else "info"
                ),
                "timestamp": _ts_iso(r.timestamp_s),
            })

        if len(events) >= 500:
            break

    return {"events": events[:500]}


def _q_dashboard() -> dict:
    if not is_dataset_available():
        return {
            "dashboard": {
                "id": "bank-observability",
                "title": "Bank Observability Dashboard",
                "services": [],
                "refresh_interval": 60,
            },
            "dataset_available": False
        }
    services = sorted(_svc_host_map()["service"].unique())
    return {
        "dashboard": {
            "id": "bank-observability",
            "title": "Bank Observability Dashboard",
            "services": services,
            "refresh_interval": 60,
        }
    }


def _q_services() -> dict:
    if not is_dataset_available():
        return {"services": [], "dataset_available": False}
    shm = _svc_host_map()
    ma = _metric_app()

    latest = (
        ma.sort_values("timestamp_s", ascending=False)
          .groupby("service")
          .first()
          .reset_index()
    )
    latest_map = {r.service: r for r in latest.itertuples()}
    svc_hosts = shm.groupby("service")["cmdb_id"].apply(list).to_dict()

    services: list[dict] = []

    # ── microservices (ServiceTest1-11) from parquet ──────────────────────────
    for svc, hosts in svc_hosts.items():
        r = latest_map.get(svc)
        sr  = float(r.sr)  if r else 100.0
        mrt = float(r.mrt) if r else 0.0
        rr  = float(r.rr)  if r else 0.0
        health = "critical" if sr < 95 else ("degraded" if sr < 99 else "healthy")
        risk = round(max(0.0, (100 - sr) * 2 + max(0.0, mrt - 200) / 10), 1)

        services.append({
            "id": svc,
            "name": svc,
            "type": "microservice",
            "layer": "microservice",
            "applications": hosts,
            "metrics": {
                "request_rate": round(rr, 2),
                "success_rate": round(sr, 2),
                "mean_response_time": round(mrt, 2),
                "incident_count": 0,
                "risk_score": risk,
            },
            "health": health,
            "sla": {
                "availability_target": 99.9,
                "current_availability": round(sr, 3),
            },
        })

    # ── business services (domain names) — aggregate child microservice metrics ─
    for bs in get_business_services():
        child_rows = [latest_map[ms] for ms in get_bs_microservices().get(bs["id"], []) if ms in latest_map]
        if child_rows:
            avg_sr  = sum(float(r.sr)  for r in child_rows) / len(child_rows)
            avg_mrt = sum(float(r.mrt) for r in child_rows) / len(child_rows)
            avg_rr  = sum(float(r.rr)  for r in child_rows) / len(child_rows)
        else:
            avg_sr, avg_mrt, avg_rr = 100.0, 0.0, 0.0
        health = "critical" if avg_sr < 95 else ("degraded" if avg_sr < 99 else "healthy")
        risk = round(max(0.0, (100 - avg_sr) * 2 + max(0.0, avg_mrt - 200) / 10), 1)
        all_hosts = [h for ms in get_bs_microservices().get(bs["id"], []) for h in svc_hosts.get(ms, [])]

        services.append({
            "id": bs["id"],
            "name": bs["name"],
            "type": "business_service",
            "layer": "business_service",
            "applications": bs["microservices"],
            "metrics": {
                "request_rate": round(avg_rr, 2),
                "success_rate": round(avg_sr, 2),
                "mean_response_time": round(avg_mrt, 2),
                "incident_count": 0,
                "risk_score": risk,
            },
            "health": health,
            "sla": {
                "availability_target": 99.9,
                "current_availability": round(avg_sr, 3),
            },
        })

    return {"services": services}


def _q_infrastructure() -> dict:
    if not is_dataset_available():
        return {"nodes": [], "dataset_available": False}
    shm = _svc_host_map()

    try:
        latest_cpu = (
            _metric_cpu()
            .sort_values("timestamp_s", ascending=False)
            .groupby("cmdb_id")["value"]
            .first()
            .to_dict()
        )
    except Exception:
        latest_cpu = {}

    host_services = shm.groupby("cmdb_id")["service"].apply(list).to_dict()

    nodes: list[dict] = []
    for cid in sorted(shm["cmdb_id"].unique()):
        htype, layer = _host_type_layer(cid)
        cpu = float(latest_cpu.get(cid, 0.0))
        health = "critical" if cpu > 90 else ("degraded" if cpu > 75 else "healthy")

        nodes.append({
            "id": cid,
            "name": cid,
            "type": htype,
            "layer": layer,
            "services": host_services.get(cid, []),
            "metrics": {
                "cpu": round(cpu, 2),
                "memory": 0.0,
                "incident_count": 0,
                "risk_score": round(cpu / 10, 1),
            },
            "health": health,
            "platform": "on-prem-physical",
            "region": "bank-dc1",
        })

    return {"nodes": nodes}


def _q_dep_graph() -> dict:
    if not is_dataset_available():
        return {"edges": [], "dataset_available": False}
    shm = _svc_host_map()

    edges: list[dict] = []

    # business service → microservice edges
    for bs in get_business_services():
        for ms in get_bs_microservices().get(bs["id"], []):
            edges.append({
                "source": bs["id"],
                "target": ms,
                "relationship": "depends_on",
                "type": "service_dependency",
            })

    # microservice → host edges (from service_host_map)
    for r in shm.itertuples():
        edges.append({
            "source": r.service,
            "target": r.cmdb_id,
            "relationship": "runs_on",
            "type": "infra_dependency",
        })

    return {"edges": edges}


def _q_incidents() -> dict:
    if not is_dataset_available():
        return {"incidents": [], "dataset_available": False}
    ma = _metric_app().copy()
    ma["day"] = (ma["timestamp_s"] // 86400) * 86400

    anom = ma[((ma["sr"] < 95.0) | (ma["mrt"] > 1000.0)) & (ma["cnt"] > 5)]
    svc_hosts = _svc_host_map().groupby("service")["cmdb_id"].apply(list).to_dict()

    incidents: list[dict] = []
    inc_num = 1000

    for (svc, day), grp in anom.groupby(["service", "day"]):
        ts0 = int(grp["timestamp_s"].min())
        ts1 = int(grp["timestamp_s"].max())
        min_sr  = float(grp["sr"].min())
        max_mrt = float(grp["mrt"].max())

        if min_sr < 95.0:
            cause    = "High Error Rate"
            symptoms = ["Elevated error rate", "Service degradation"]
            fix      = "Investigate error logs and check downstream dependencies"
        else:
            cause    = "High Latency"
            symptoms = ["Increased response time", "Slow queries"]
            fix      = "Profile request handling and check database query performance"

        sev   = "P1" if (min_sr < 90.0 or max_mrt > 2000.0) else "P2"
        hosts = svc_hosts.get(svc, [])
        iid   = f"INC-{inc_num}"
        parent_bs = get_ms_to_bs().get(svc, svc)

        incidents.append({
            "incident_id": iid,
            "id": iid,
            "number": iid,
            "title": f"{svc} ({parent_bs}) — {cause}",
            "short_description": f"{cause} detected on {svc}",
            "severity": sev,
            "priority": "1 - Critical" if sev == "P1" else "2 - High",
            "state": "In Progress" if sev == "P1" else "Open",
            "service": svc,
            "service_id": svc,
            "affected_service": svc,
            "alerts": ["High Error Rate"] if min_sr < 95.0 else ["High Latency"],
            "symptoms": symptoms,
            "root_cause": cause,
            "fix": fix,
            "impacted_components": hosts,
            "impacted_services": [svc, parent_bs],
            "region": "bank-dc1",
            "environment": "production",
            "owner_team": "platform-ops",
            "assignment_group": "SRE",
            "assigned_to": "on-call-engineer",
            "start_time": _ts_iso(ts0),
            "end_time": _ts_iso(ts1),
            "created_at": _ts_iso(ts0),
            "resolved_at": _ts_iso(ts1) if sev != "P1" else None,
            "duration_minutes": max(1, (ts1 - ts0) // 60),
            "confidence_training_value": 0.9,
            "resolution_notes": fix,
            "change_records": [],
            "similar_incidents": [],
            "category": "performance",
        })
        inc_num += 1

    return {"incidents": incidents[:500]}


def _q_knowledge_graph() -> dict:
    if not is_dataset_available():
        return {
            "nodes": [],
            "edges": [],
            "pattern_library": [],
            "stats": {"node_count": 0, "edge_count": 0},
            "generated_at": "",
            "dataset_available": False
        }
    shm = _svc_host_map()
    services = sorted(shm["service"].unique())
    cmdb_ids = sorted(shm["cmdb_id"].unique())

    nodes: list[dict] = []
    edges: list[dict] = []

    # business service nodes
    for bs in get_business_services():
        nodes.append({"id": f"component-{bs['id']}", "type": "business_service", "label": bs["name"]})
    # microservice nodes
    for svc in services:
        nodes.append({"id": f"component-{svc}", "type": "microservice", "label": svc})
    # host nodes
    for cid in cmdb_ids:
        nodes.append({"id": f"host-{cid}", "type": "host", "label": cid})
    # alert type nodes
    for at in ("High Error Rate", "High Latency", "No Traffic"):
        nodes.append({"id": f"alert-{at.lower().replace(' ', '-')}", "type": "alert", "label": at})

    # business service → microservice edges
    for bs in get_business_services():
        for ms in get_bs_microservices().get(bs["id"], []):
            edges.append({
                "source": f"component-{bs['id']}",
                "target": f"component-{ms}",
                "relationship": "DEPENDS_ON",
                "frequency": 1,
                "confidence": 1.0,
                "time_proximity_minutes": 0,
                "environments": ["production"],
                "incident_refs": [],
            })

    # microservice → host edges
    for r in shm.itertuples():
        edges.append({
            "source": f"component-{r.service}",
            "target": f"host-{r.cmdb_id}",
            "relationship": "RUNS_ON",
            "frequency": int(r.co_occurrence_count),
            "confidence": 1.0,
            "time_proximity_minutes": 0,
            "environments": ["production"],
            "incident_refs": [],
        })

    pattern_library = [
        {
            "id": "pattern-high-error-rate",
            "alerts": ["High Error Rate"],
            "symptoms": ["Elevated error rate", "Service degradation"],
            "expected_service": services[0] if services else "unknown",
            "occurrence_count": 10,
            "avg_time_to_incident_minutes": 5.0,
            "confidence": 0.85,
        },
        {
            "id": "pattern-high-latency",
            "alerts": ["High Latency"],
            "symptoms": ["Increased response time", "Slow queries"],
            "expected_service": services[0] if services else "unknown",
            "occurrence_count": 8,
            "avg_time_to_incident_minutes": 15.0,
            "confidence": 0.80,
        },
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "pattern_library": pattern_library,
        "stats": {"node_count": len(nodes), "edge_count": len(edges)},
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def query_incident_runbook(
    service: str,
    cmdb_ids: list[str],
    start_ts: int,
    end_ts: int,
    root_cause: str,
    severity: str,
    similar_incidents: list[dict],
) -> dict:
    if not is_dataset_available():
        return {
            "golden_signals": {"baseline": {}, "incident": {}, "deltas": {}},
            "host_saturation": [],
            "gc_pressure": False,
            "runbook": [],
            "dataset_available": False,
        }
    """
    Compute golden-signal deltas and generate an ordered SRE runbook.

    Golden Signals (Latency · Traffic · Errors · Saturation) are computed
    across three windows:
      baseline  = 1 h before incident start
      incident  = start_ts → end_ts  (capped at 4 h)
    """
    BASELINE_H = 3600
    end_ts = min(end_ts, start_ts + 14400)
    b0, b1 = start_ts - BASELINE_H, start_ts

    # ── Helper: aggregate one metric_app window ──────────────────────────────
    def _agg(df: pd.DataFrame, t0: int, t1: int) -> dict | None:
        w = df[(df["service"] == service) & (df["timestamp_s"] >= t0) & (df["timestamp_s"] <= t1)]
        if w.empty:
            return None
        return {
            "sr_avg":   round(float(w["sr"].mean()),  2),
            "sr_min":   round(float(w["sr"].min()),   2),
            "mrt_avg":  round(float(w["mrt"].mean()), 2),
            "mrt_max":  round(float(w["mrt"].max()),  2),
            "rr_avg":   round(float(w["rr"].mean()),  2),
            "cnt_total": int(w["cnt"].sum()),
        }

    ma       = _metric_app()
    baseline = _agg(ma, b0, b1)
    incident = _agg(ma, start_ts, end_ts)

    deltas: dict = {}
    if baseline and incident:
        deltas = {
            "sr_pp":  round(incident["sr_avg"]  - baseline["sr_avg"],  2),
            "mrt_ms": round(incident["mrt_avg"] - baseline["mrt_avg"], 1),
            "rr_pct": round(
                (incident["rr_avg"] - baseline["rr_avg"]) / max(baseline["rr_avg"], 0.001) * 100, 1
            ),
        }

    golden_signals = {"baseline": baseline, "incident": incident, "deltas": deltas}

    # ── Host saturation from metric_container (CPU) ──────────────────────────
    host_saturation: list[dict] = []
    if cmdb_ids:
        try:
            cpu = _metric_cpu()
            hdf = cpu[
                (cpu["cmdb_id"].isin(cmdb_ids))
                & (cpu["timestamp_s"] >= start_ts)
                & (cpu["timestamp_s"] <= end_ts)
            ]
            if not hdf.empty:
                agg = hdf.groupby("cmdb_id")["value"].agg(["mean", "max"]).reset_index()
                host_saturation = sorted([
                    {
                        "host":      str(r.cmdb_id),
                        "cpu_avg":   round(float(r["mean"]), 1),
                        "cpu_peak":  round(float(r["max"]),  1),
                        "status": (
                            "critical"  if float(r["max"]) > 90 else
                            "degraded"  if float(r["max"]) > 75 else
                            "healthy"
                        ),
                    }
                    for r in agg.itertuples()
                ], key=lambda h: -h["cpu_peak"])
        except Exception:
            pass

    # ── GC pressure check (log_service) ─────────────────────────────────────
    gc_pressure = False
    try:
        tomcat_hosts = [c for c in cmdb_ids if c.lower().startswith("tomcat")]
        if tomcat_hosts:
            pf = pq.ParquetFile(PARQUET_DIR / "log_service.parquet")
            for batch in pf.iter_batches(
                batch_size=100_000,
                columns=["cmdb_id", "log_name", "value", "timestamp_s"],
            ):
                df_gc = batch.to_pandas()
                gc_rows = df_gc[
                    (df_gc["cmdb_id"].isin(tomcat_hosts))
                    & (df_gc["log_name"] == "gc")
                    & (df_gc["timestamp_s"] >= start_ts)
                    & (df_gc["timestamp_s"] <= end_ts)
                ]
                if gc_rows["value"].str.contains(
                    r"CMS Final Remark|Full GC|GC pause", case=False, regex=True, na=False
                ).any():
                    gc_pressure = True
                    break
    except Exception:
        pass

    # ── Generate ordered runbook steps ───────────────────────────────────────
    runbook = _build_runbook_steps(
        root_cause, severity, service,
        golden_signals, host_saturation, gc_pressure, similar_incidents,
    )

    return {
        "golden_signals": golden_signals,
        "host_saturation": host_saturation,
        "gc_pressure": gc_pressure,
        "runbook": runbook,
    }


def _host_layer(host: str) -> str:
    u = host.upper()
    if u.startswith("IG"):     return "load balancer"
    if u.startswith("MG"):     return "gateway"
    if u.startswith("TOMCAT"): return "app server"
    if u.startswith("DOCKER"): return "container"
    if u.startswith("MYSQL"):  return "database"
    return "host"


def _build_runbook_steps(
    root_cause: str,
    severity: str,
    service: str,
    golden_signals: dict,
    host_saturation: list[dict],
    gc_pressure: bool,
    similar: list[dict],
) -> list[dict]:
    gs_i = golden_signals.get("incident") or {}
    gs_b = golden_signals.get("baseline") or {}
    d    = golden_signals.get("deltas") or {}

    sr_now   = gs_i.get("sr_avg",  100.0)
    mrt_now  = gs_i.get("mrt_avg", 0.0)
    sr_base  = gs_b.get("sr_avg",  100.0)
    mrt_base = gs_b.get("mrt_avg", 0.0)
    rr_now   = gs_i.get("rr_avg",  0.0)

    err_rate  = round(100.0 - sr_now, 1)
    err_delta = round(sr_base - sr_now, 1)
    mrt_delta = round(mrt_now - mrt_base, 0)

    critical_hosts = [h for h in host_saturation if h["status"] == "critical"]
    degraded_hosts = [h for h in host_saturation if h["status"] in ("critical", "degraded")]

    proven_fix = similar[0]["fix"] if similar else None
    steps: list[dict] = []

    def _step(sid: str, cat: str, action: str, evidence: str,
               lever: str | None = None, confidence: str = "medium") -> dict:
        return {
            "id": sid, "step": len(steps) + 1,
            "category": cat, "action": action,
            "evidence": evidence, "lever": lever,
            "confidence": confidence,
        }

    # ── 1. Assess & communicate ──────────────────────────────────────────────
    steps.append(_step(
        "assess", "diagnose",
        f"Confirm blast radius — declare {severity} incident and notify owner team",
        f"Severity: {severity}.  Service: {service}.  SR now: {sr_now:.1f}%  MRT now: {mrt_now:.0f} ms.",
    ))

    # ── 2. Golden Signals snapshot ───────────────────────────────────────────
    gs_parts = []
    if d.get("sr_pp", 0) < -0.5:
        gs_parts.append(f"Errors ↑ {err_delta:.1f}pp (SR {sr_base:.1f}% → {sr_now:.1f}%)")
    if d.get("mrt_ms", 0) > 50:
        gs_parts.append(f"Latency ↑ {mrt_delta:.0f} ms ({mrt_base:.0f} → {mrt_now:.0f} ms)")
    if abs(d.get("rr_pct", 0)) > 10:
        direction = "↑" if d["rr_pct"] > 0 else "↓"
        gs_parts.append(f"Traffic {direction} {abs(d['rr_pct']):.0f}%  ({rr_now:.1f} req/s now)")

    steps.append(_step(
        "golden-signals", "diagnose",
        "Cross-reference the 4 Golden Signals against the 1-hour baseline",
        "  ·  ".join(gs_parts) if gs_parts else "Open telemetry panel — metrics match root cause.",
    ))

    # ── 3. Recent changes ────────────────────────────────────────────────────
    steps.append(_step(
        "check-changes", "diagnose",
        "Check Change Requests — any deployment or config push in the past 2 hours?",
        "Deployment is the most common trigger for both error-rate and latency incidents.",
        lever="change_requests",
    ))

    # ── Root-cause branch ────────────────────────────────────────────────────
    is_error   = root_cause == "High Error Rate" or sr_now < 95
    is_latency = root_cause == "High Latency"    or mrt_now > 1000

    if is_error:
        steps.append(_step(
            "rollback", "mitigate",
            f"Rollback the last deployment for {service}",
            (
                f"Error rate is {err_rate:.1f}% (baseline was {100 - sr_base:.1f}%).  "
                f"Rollback is the fastest path to restore SR above 99%.  "
                + (f"Proven fix from similar incident: '{proven_fix}'." if proven_fix else "")
            ),
            lever="rollback",
            confidence="high" if proven_fix else "medium",
        ))

        steps.append(_step(
            "feature-flag", "mitigate",
            "Toggle a feature flag to disable the broken code path",
            "Surgical alternative to rollback — kills one endpoint without reverting everything.",
            lever="feature_flag",
        ))

        steps.append(_step(
            "downstream-check", "diagnose",
            f"Check downstream containers on the call path ({service} → MG → Docker)",
            "Errors may originate in a downstream container, not the entry service itself.  "
            "See Telemetry → Traces for the failing hops.",
            lever="traces",
        ))

        steps.append(_step(
            "circuit-breaker", "mitigate",
            "Enable circuit breaker on the failing downstream dependency",
            "Stops cascading failures propagating upstream to customer-facing endpoints.",
            lever="circuit_breaker",
        ))

    if is_latency:
        top = host_saturation[0] if host_saturation else None
        steps.append(_step(
            "bottleneck", "diagnose",
            "Identify the slow hop: IG → Tomcat → MG → Docker — which layer adds the most latency?",
            (
                f"MRT is {mrt_now:.0f} ms (+{mrt_delta:.0f} ms vs baseline).  "
                + (f"Hottest host: {top['host']} ({_host_layer(top['host'])}) at {top['cpu_peak']:.1f}% CPU." if top else
                   "Open Telemetry → Traces to inspect span durations.")
            ),
            lever="traces",
        ))

        for h in critical_hosts[:2]:
            steps.append(_step(
                f"route-shift-{h['host']}", "mitigate",
                f"Route traffic away from {h['host']} ({_host_layer(h['host'])}, CPU {h['cpu_peak']:.1f}%)",
                f"Host is saturated (>90% CPU).  Shifting requests to a peer reduces queuing and MRT.",
                lever="route_shift",
                confidence="high",
            ))

        steps.append(_step(
            "load-shed", "mitigate",
            "Enable load shedding — drop P3/P4 background traffic",
            f"Current traffic: {rr_now:.1f} req/s.  Shedding non-critical requests "
            "preserves capacity for P1/P2 customer-facing calls.",
            lever="load_shed",
        ))

        if gc_pressure:
            steps.append(_step(
                "gc-pressure", "diagnose",
                "Investigate GC pressure on Tomcat — CMS/Full GC pauses detected in logs",
                "GC stop-the-world pauses directly cause MRT spikes.  "
                "Short-term: restart the affected Tomcat to clear heap.  "
                "Long-term: tune heap size or switch to G1GC.",
                lever="logs",
                confidence="high",
            ))

    # ── Verify recovery ──────────────────────────────────────────────────────
    steps.append(_step(
        "verify", "verify",
        "Confirm service recovery — SR back above 99% and MRT below 500 ms",
        f"Baseline SR: {sr_base:.1f}%  MRT: {mrt_base:.0f} ms.  "
        "Watch the Golden Signals panel for the next 5 minutes.",
        lever="metrics",
    ))

    # ── Resolve & document ───────────────────────────────────────────────────
    steps.append(_step(
        "resolve", "resolve",
        "Mark the incident Resolved and record which lever was pulled",
        "Write resolution notes so the RCA can reference the exact mitigation action.",
        lever="resolve",
        confidence="high",
    ))

    return steps


def query_incident_telemetry(
    service: str,
    cmdb_ids: list[str],
    start_ts: int,
    end_ts: int,
) -> dict:
    """Query logs, metrics, and traces from parquet for a specific incident time window."""
    # Cap to 4-hour window to prevent excessive data
    end_ts = min(end_ts, start_ts + 14400)

    result: dict = {
        "service": service,
        "window": {"start": _ts_iso(start_ts), "end": _ts_iso(end_ts)},
        "metrics": [],
        "host_metrics": [],
        "logs": [],
        "traces": [],
    }

    # ── App metrics (already cached, fast) ───────────────────────────────────
    try:
        ma = _metric_app()
        svc_df = ma[
            (ma["service"] == service)
            & (ma["timestamp_s"] >= start_ts)
            & (ma["timestamp_s"] <= end_ts)
        ].sort_values("timestamp_s")
        result["metrics"] = [
            {
                "timestamp": _ts_iso(int(r.timestamp_s)),
                "request_rate": round(float(r.rr), 2),
                "success_rate": round(float(r.sr), 2),
                "request_count": int(r.cnt),
                "mean_response_time": round(float(r.mrt), 2),
            }
            for r in svc_df.itertuples()
        ]
        # Host CPU for impacted components
        if cmdb_ids:
            try:
                cpu = _metric_cpu()
                host_df = cpu[
                    (cpu["cmdb_id"].isin(cmdb_ids))
                    & (cpu["timestamp_s"] >= start_ts)
                    & (cpu["timestamp_s"] <= end_ts)
                ].sort_values("timestamp_s")
                result["host_metrics"] = [
                    {
                        "timestamp": _ts_iso(int(r.timestamp_s)),
                        "host": str(r.cmdb_id),
                        "cpu": round(float(r.value), 2),
                    }
                    for r in host_df.head(100).itertuples()
                ]
            except Exception:
                pass
    except Exception as e:
        result["metric_error"] = str(e)

    # ── Logs (predicate pushdown on time + host) ──────────────────────────────
    try:
        log_filters: list = [
            ("timestamp_s", ">=", start_ts),
            ("timestamp_s", "<=", end_ts),
        ]
        if cmdb_ids:
            log_filters.append(("cmdb_id", "in", cmdb_ids))
        log_df = pd.read_parquet(
            PARQUET_DIR / "log_service.parquet",
            filters=log_filters,
            columns=["cmdb_id", "log_name", "value", "timestamp_s"],
        )
        result["logs"] = [
            {
                "timestamp": _ts_iso(int(r.timestamp_s)),
                "host": str(r.cmdb_id),
                "log_name": str(r.log_name),
                "message": str(r.value)[:300],
                "severity": (
                    "error"
                    if any(
                        w in str(r.value).lower()
                        for w in ("error", "exception", "fail", "oom", "timeout", "critical")
                    )
                    else "info"
                ),
            }
            for r in log_df.sort_values("timestamp_s").head(100).itertuples()
        ]
    except Exception as e:
        result["log_error"] = str(e)

    # ── Traces (predicate pushdown on time + service) ─────────────────────────
    try:
        trace_filters: list = [
            ("timestamp_s", ">=", start_ts),
            ("timestamp_s", "<=", end_ts),
            ("service", "==", service),
        ]
        trace_df = pd.read_parquet(
            PARQUET_DIR / "trace_span.parquet",
            filters=trace_filters,
            columns=["service", "cmdb_id", "parent_span_id", "trace_id", "timestamp_s"],
        )
        if not trace_df.empty:
            sampled = (
                trace_df.sort_values("timestamp_s")
                .groupby("trace_id", observed=True)
                .first()
                .reset_index()
                .head(20)
            )
            result["traces"] = [
                {
                    "trace_id": str(r.trace_id),
                    "service": str(r.service),
                    "host": str(r.cmdb_id),
                    "timestamp": _ts_iso(int(r.timestamp_s)),
                    "has_parent": bool(r.parent_span_id),
                }
                for r in sampled.itertuples()
            ]
    except Exception as e:
        result["trace_error"] = str(e)

    return result


def _q_incident_graph() -> dict:
    if not is_dataset_available():
        return {"nodes": [], "edges": [], "dataset_available": False}
    incidents = _q_incidents().get("incidents", [])[:100]

    raw_nodes: list[dict] = []
    edges: list[dict] = []
    svc_seen: set[str] = set()

    for inc in incidents:
        iid = f"incident-{inc['incident_id']}"
        raw_nodes.append({
            "id": iid,
            "type": "incident",
            "label": inc["title"],
            "severity": inc["severity"],
        })
        sid = f"service-{inc['service_id']}"
        if sid not in svc_seen:
            svc_seen.add(sid)
            raw_nodes.append({"id": sid, "type": "service", "label": inc["service"]})
        edges.append({"source": iid, "target": sid, "relationship": "AFFECTED"})

    return {"nodes": raw_nodes, "edges": edges}


# ── SLO burn rate ────────────────────────────────────────────────────────────────

def query_slo_burn_multiservice(
    incident_start_ts: int,
    incident_end_ts: int,
    slo_target: float = 0.999,
) -> dict:
    if not is_dataset_available():
        return {
            "slo_target": slo_target,
            "error_budget_pct": 0.0,
            "error_budget_minutes": 0.0,
            "overall_highest_tier": None,
            "recommended_action": "Dataset not available",
            "services": [],
            "dataset_available": False,
        }
    """
    Auto-detect which services had elevated SLO burn during an incident window.

    ref_ts = end_ts (or start+3h for zero-duration incidents) so look-back
    windows capture the error burst that occurred *during* the incident.
    Only services with max burn_rate > 1× (above normal budget draw) are returned.
    """
    from app.services.slo_burn_rate import (
        SLOConfig,
        evaluate_multiwindow_alerts,
        label_to_minutes,
    )

    slo = SLOConfig(target=slo_target)
    ma = _metric_app()

    ref_ts = (
        incident_end_ts
        if incident_end_ts > incident_start_ts
        else incident_start_ts + 3 * 3600
    )

    window_labels = ["5m", "30m", "1h", "2h", "6h", "24h", "72h"]
    _sev_rank = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    _tier_actions = {
        "P0": "War room now. Rollback last deployment or route-shift all traffic immediately.",
        "P1": "Page on-call lead. Apply feature flag / circuit breaker within 30 minutes.",
        "P2": "Open hotfix ticket. Apply config change or graceful degradation within 2 hours.",
        "P3": "Schedule fix for next sprint. Root cause analysis required before next release.",
    }

    service_results: list[dict] = []

    for service in sorted(ma["service"].unique()):
        svc_df = ma[ma["service"] == service]
        burn_rates: dict[str, float] = {}
        window_details: dict[str, dict] = {}

        for label in window_labels:
            minutes = label_to_minutes(label)
            t0 = ref_ts - minutes * 60
            w = svc_df[(svc_df["timestamp_s"] >= t0) & (svc_df["timestamp_s"] <= ref_ts)]

            total_cnt = float(w["cnt"].sum()) if not w.empty else 0.0
            if total_cnt == 0:
                burn_rates[label] = 0.0
                window_details[label] = {"error_rate_pct": 0.0, "burn_rate": 0.0, "data_points": 0}
                continue

            weighted_sr = float((w["sr"] * w["cnt"]).sum()) / total_cnt
            error_rate = max(0.0, 1.0 - weighted_sr / 100.0)
            br = round(error_rate / slo.error_budget, 2) if slo.error_budget > 0 else 0.0
            burn_rates[label] = br
            window_details[label] = {
                "error_rate_pct": round(error_rate * 100, 3),
                "burn_rate": br,
                "data_points": len(w),
            }

        max_burn = max(burn_rates.values(), default=0.0)
        if max_burn < 1.0:
            continue  # within normal budget draw — not implicated in this incident

        alerts = evaluate_multiwindow_alerts(slo, burn_rates)
        firing = [a for a in alerts if a.firing]
        highest_tier = min(firing, key=lambda a: _sev_rank[a.tier]).tier if firing else None

        br_1h = burn_rates.get("1h", 0.0)
        tte = round(slo.window_days * 24.0 / br_1h, 1) if br_1h > 0 else None

        service_results.append({
            "service": service,
            "highest_firing_tier": highest_tier,
            "time_to_exhaustion_hours": tte,
            "max_burn_rate": max_burn,
            "burn_rates": burn_rates,
            "window_details": window_details,
            "alerts": [
                {
                    "tier": a.tier,
                    "firing": a.firing,
                    "primary_window": a.primary_window.label,
                    "confirmation_window": a.confirmation_window.label,
                    "primary_burn_rate": a.primary_window.burn_rate,
                    "confirmation_burn_rate": a.confirmation_window.burn_rate,
                    "threshold": a.primary_window.threshold,
                    "budget_consumed_pct": round(a.primary_window.budget_consumed_percent, 1),
                }
                for a in alerts
            ],
        })

    # Sort: firing tiers first (lowest rank = most severe), then by max burn rate
    service_results.sort(
        key=lambda r: (
            _sev_rank.get(r["highest_firing_tier"], 99) if r["highest_firing_tier"] else 99,
            -r["max_burn_rate"],
        )
    )

    all_tiers = [r["highest_firing_tier"] for r in service_results if r["highest_firing_tier"]]
    overall_tier = min(all_tiers, key=lambda t: _sev_rank[t]) if all_tiers else None

    return {
        "slo_target": slo.target,
        "error_budget_pct": round(slo.error_budget * 100, 4),
        "error_budget_minutes": round(slo.error_budget_minutes, 1),
        "overall_highest_tier": overall_tier,
        "recommended_action": _tier_actions.get(overall_tier, "All services within SLO. No immediate action required."),
        "services": service_results,
    }


def query_slo_burn(service: str, incident_ts: int, slo_target: float = 0.999) -> dict:
    if not is_dataset_available():
        return {
            "service": service,
            "slo_target": slo_target,
            "error_budget_pct": 0.0,
            "error_budget_minutes": 0.0,
            "highest_firing_tier": None,
            "time_to_exhaustion_hours": None,
            "recommended_action": "Dataset not available",
            "burn_rates": {},
            "window_details": {},
            "alerts": [],
            "dataset_available": False,
        }
    """
    Compute SLO burn rates at the moment of an incident using metric_app.parquet.

    error_rate per window = 1 - weighted_mean(sr/100, weights=cnt)
    burn_rate             = error_rate / error_budget
    """
    from app.services.slo_burn_rate import (
        SLOConfig,
        evaluate_multiwindow_alerts,
        label_to_minutes,
    )

    slo = SLOConfig(target=slo_target)
    ma = _metric_app()
    svc = ma[ma["service"] == service].copy()

    # Windows needed by the two-window evaluator
    window_labels = ["5m", "30m", "1h", "2h", "6h", "24h", "72h"]
    burn_rates: dict[str, float] = {}
    window_details: dict[str, dict] = {}

    for label in window_labels:
        minutes = label_to_minutes(label)
        t0 = incident_ts - minutes * 60
        w = svc[(svc["timestamp_s"] >= t0) & (svc["timestamp_s"] <= incident_ts)]

        total_cnt = float(w["cnt"].sum()) if not w.empty else 0.0
        if total_cnt == 0:
            burn_rates[label] = 0.0
            window_details[label] = {"error_rate_pct": 0.0, "burn_rate": 0.0, "data_points": 0}
            continue

        weighted_sr = float((w["sr"] * w["cnt"]).sum()) / total_cnt  # success rate %
        error_rate = max(0.0, 1.0 - weighted_sr / 100.0)
        br = round(error_rate / slo.error_budget, 2) if slo.error_budget > 0 else 0.0
        burn_rates[label] = br
        window_details[label] = {
            "error_rate_pct": round(error_rate * 100, 3),
            "burn_rate": br,
            "data_points": len(w),
        }

    alerts = evaluate_multiwindow_alerts(slo, burn_rates)

    _sev_rank = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    firing = [a for a in alerts if a.firing]
    highest_tier = min(firing, key=lambda a: _sev_rank[a.tier]).tier if firing else None

    br_1h = burn_rates.get("1h", 0.0)
    tte_hours: float | None = (
        round(slo.window_days * 24.0 / br_1h, 1) if br_1h > 0 else None
    )

    _tier_actions = {
        "P0": "War room now. Rollback last deployment or route-shift all traffic immediately.",
        "P1": "Page on-call lead. Apply feature flag / circuit breaker within 30 minutes.",
        "P2": "Open hotfix ticket. Apply config change or graceful degradation within 2 hours.",
        "P3": "Schedule fix for next sprint. Root cause analysis required before next release.",
    }
    recommended_action = _tier_actions.get(highest_tier, "Error budget within SLO. No immediate action required.") if highest_tier else "Error budget within SLO. No immediate action required."

    return {
        "service": service,
        "slo_target": slo.target,
        "error_budget_pct": round(slo.error_budget * 100, 4),
        "error_budget_minutes": round(slo.error_budget_minutes, 1),
        "highest_firing_tier": highest_tier,
        "time_to_exhaustion_hours": tte_hours,
        "recommended_action": recommended_action,
        "burn_rates": burn_rates,
        "window_details": window_details,
        "alerts": [
            {
                "tier": a.tier,
                "firing": a.firing,
                "primary_window": a.primary_window.label,
                "confirmation_window": a.confirmation_window.label,
                "primary_burn_rate": a.primary_window.burn_rate,
                "confirmation_burn_rate": a.confirmation_window.burn_rate,
                "threshold": a.primary_window.threshold,
                "budget_consumed_pct": round(a.primary_window.budget_consumed_percent, 1),
            }
            for a in alerts
        ],
    }
