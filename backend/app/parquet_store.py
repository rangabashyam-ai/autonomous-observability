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
        r"C:\Users\Infobell\Desktop\RCA_CORR\openRCA_Bank\parquet",
    )
)

# Business services (domain names) → microservices (ServiceTestN) mapping
BUSINESS_SERVICES = [
    {"id": "payment-authorization",  "name": "Payment Authorization",  "microservices": ["ServiceTest1", "ServiceTest2"]},
    {"id": "settlement-processing",  "name": "Settlement Processing",  "microservices": ["ServiceTest3", "ServiceTest4"]},
    {"id": "fraud-detection",        "name": "Fraud Detection",        "microservices": ["ServiceTest5", "ServiceTest6"]},
    {"id": "merchant-services",      "name": "Merchant Services",      "microservices": ["ServiceTest7", "ServiceTest8"]},
    {"id": "api-gateway-services",   "name": "Api Gateway Services",   "microservices": ["ServiceTest9", "ServiceTest10"]},
    {"id": "partner-integrations",   "name": "Partner Integrations",   "microservices": ["ServiceTest11"]},
]

# Reverse lookup: microservice → parent business service id
_MS_TO_BS: dict[str, str] = {
    ms: bs["id"]
    for bs in BUSINESS_SERVICES
    for ms in bs["microservices"]
}

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
    if u.startswith("REDIS"):
        return "cache", "server"
    if u.startswith("APACHE"):
        return "web_server", "server"
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


def query(filename: str) -> dict | list:
    """Route a logical JSON filename to its parquet query function."""
    handler_name = _ROUTES.get(filename)
    if handler_name is None:
        return _EMPTY_WRAPPERS.get(filename, {})
    fn = globals().get(handler_name)
    if fn is None:
        return _EMPTY_WRAPPERS.get(filename, {})
    return fn()


# ── query implementations ────────────────────────────────────────────────────────

def _q_metrics() -> dict:
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
            "status": "active",
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
            "status": "active",
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
    services = sorted(_svc_host_map()["service"].unique())
    return {
        "dashboard": {
            "id": "bank-observability",
            "title": "Bank Observability Dashboard",
            "services": services,
            "refresh_interval": 60,
        }
    }


def _gs(sr: float, mrt: float, rr: float) -> dict:
    """Compute the 4 Google SRE Golden Signals normalized to 0-100 (higher = worse)."""
    return {
        "latency":    round(min(mrt / 10.0, 100.0), 1),   # 1000 ms → 100
        "traffic":    round(min(rr,          100.0), 1),   # req/s capped at 100
        "errors":     round(min(100.0 - sr,  100.0), 1),   # 0 % error → 0
        "saturation": 0.0,                                  # filled in by callers
    }


def _q_services() -> dict:
    shm = _svc_host_map()
    ma = _metric_app()

    # Latest row — used for current health/SLA display
    latest = (
        ma.sort_values("timestamp_s", ascending=False)
          .groupby("service").first().reset_index()
    )
    latest_map = {r.service: r for r in latest.itertuples()}

    # Period aggregates — used for golden signals (whole dataset = better signal)
    period = (
        ma.groupby("service")
          .agg(avg_sr=("sr", "mean"), avg_mrt=("mrt", "mean"),
               avg_rr=("rr", "mean"), min_sr=("sr", "min"),
               p90_mrt=("mrt", lambda x: float(x.quantile(0.90))))
          .reset_index()
    )
    period_map = {r.service: r for r in period.itertuples()}

    svc_hosts = shm.groupby("service")["cmdb_id"].apply(list).to_dict()

    # Latest CPU per host (for saturation of services via their hosts)
    CPU_KPIS = ["OSLinux-CPU_CPU_CPUCpuUtil", "OSLinux-CPU_CPU_CPULoad"]
    try:
        mc = _load("metric_container.parquet")
        cpu_df = mc[mc["kpi_name"].isin(CPU_KPIS)].sort_values(
            ["cmdb_id", "kpi_name", "timestamp_s"], ascending=[True, True, False]
        )
        host_cpu: dict[str, float] = {}
        for cid, grp in cpu_df.groupby("cmdb_id"):
            for kpi in CPU_KPIS:
                row = grp[grp["kpi_name"] == kpi]
                if not row.empty:
                    host_cpu[str(cid)] = float(row.iloc[0]["value"])
                    break
    except Exception:
        host_cpu = {}

    services: list[dict] = []

    # ── microservices (ServiceTest1-11) from parquet ──────────────────────────
    for svc, hosts in svc_hosts.items():
        r = latest_map.get(svc)
        sr  = float(r.sr)  if r else 100.0
        mrt = float(r.mrt) if r else 0.0
        rr  = float(r.rr)  if r else 0.0
        health = "critical" if sr < 95 else ("degraded" if sr < 99 else "healthy")
        risk = round(max(0.0, (100 - sr) * 2 + max(0.0, mrt - 200) / 10), 1)

        # Golden signals from period aggregates (captures anomalies, not just latest)
        p = period_map.get(svc)
        gs_sr  = float(p.avg_sr)  if p else sr
        gs_mrt = float(p.p90_mrt) if p else mrt   # P90 latency is a better signal
        gs_rr  = float(p.avg_rr)  if p else rr
        cpu_vals = [host_cpu[h] for h in hosts if h in host_cpu]
        gs = _gs(gs_sr, gs_mrt, gs_rr)
        gs["saturation"] = round(sum(cpu_vals) / len(cpu_vals), 1) if cpu_vals else 0.0

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
                **gs,
            },
            "health": health,
            "sla": {
                "availability_target": 99.9,
                "current_availability": round(sr, 3),
            },
        })

    # ── business services (domain names) — aggregate child microservice metrics ─
    for bs in BUSINESS_SERVICES:
        child_rows = [latest_map[ms] for ms in bs["microservices"] if ms in latest_map]
        if child_rows:
            avg_sr  = sum(float(r.sr)  for r in child_rows) / len(child_rows)
            avg_mrt = sum(float(r.mrt) for r in child_rows) / len(child_rows)
            avg_rr  = sum(float(r.rr)  for r in child_rows) / len(child_rows)
        else:
            avg_sr, avg_mrt, avg_rr = 100.0, 0.0, 0.0
        health = "critical" if avg_sr < 95 else ("degraded" if avg_sr < 99 else "healthy")
        risk = round(max(0.0, (100 - avg_sr) * 2 + max(0.0, avg_mrt - 200) / 10), 1)
        all_hosts = [h for ms in bs["microservices"] for h in svc_hosts.get(ms, [])]
        cpu_vals = [host_cpu[h] for h in all_hosts if h in host_cpu]

        # Period-aggregate golden signals for business services
        child_period = [period_map[ms] for ms in bs["microservices"] if ms in period_map]
        if child_period:
            gs_sr  = sum(float(r.avg_sr)  for r in child_period) / len(child_period)
            gs_mrt = sum(float(r.p90_mrt) for r in child_period) / len(child_period)
            gs_rr  = sum(float(r.avg_rr)  for r in child_period) / len(child_period)
        else:
            gs_sr, gs_mrt, gs_rr = avg_sr, avg_mrt, avg_rr
        gs = _gs(gs_sr, gs_mrt, gs_rr)
        gs["saturation"] = round(sum(cpu_vals) / len(cpu_vals), 1) if cpu_vals else 0.0

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
                **gs,
            },
            "health": health,
            "sla": {
                "availability_target": 99.9,
                "current_availability": round(avg_sr, 3),
            },
        })

    return {"services": services}


def _q_infrastructure() -> dict:
    shm = _svc_host_map()
    ma = _metric_app()

    # Period aggregates for infra proxy signals (whole dataset captures anomalies)
    period_svc = (
        ma.groupby("service")
          .agg(avg_sr=("sr", "mean"), avg_rr=("rr", "mean"),
               p90_mrt=("mrt", lambda x: float(x.quantile(0.90))))
          .reset_index()
    )
    period_svc_map = {r.service: r for r in period_svc.itertuples()}
    # All-service averages — used for gateway/LB/storage nodes that serve everything
    all_sr  = [float(r.avg_sr)  for r in period_svc_map.values()]
    all_mrt = [float(r.p90_mrt) for r in period_svc_map.values()]
    all_rr  = [float(r.avg_rr)  for r in period_svc_map.values()]
    global_gs = _gs(
        sum(all_sr)  / len(all_sr)  if all_sr  else 100.0,
        sum(all_mrt) / len(all_mrt) if all_mrt else 0.0,
        sum(all_rr)  / len(all_rr)  if all_rr  else 0.0,
    )

    # Prefer CPUCpuUtil; fall back to CPULoad for hosts that only report that
    CPU_KPIS = ["OSLinux-CPU_CPU_CPUCpuUtil", "OSLinux-CPU_CPU_CPULoad"]
    try:
        mc = _load("metric_container.parquet")
        cpu_df = (
            mc[mc["kpi_name"].isin(CPU_KPIS)]
            .sort_values(["cmdb_id", "kpi_name", "timestamp_s"],
                         ascending=[True, True, False])
        )
        latest_cpu: dict[str, float] = {}
        for cid, grp in cpu_df.groupby("cmdb_id"):
            for kpi in CPU_KPIS:
                row = grp[grp["kpi_name"] == kpi]
                if not row.empty:
                    latest_cpu[str(cid)] = float(row.iloc[0]["value"])
                    break
    except Exception:
        latest_cpu = {}

    host_services = shm.groupby("cmdb_id")["service"].apply(list).to_dict()

    # Union of hosts from service_host_map AND metric_container
    try:
        all_cmdb_ids = sorted(
            set(shm["cmdb_id"].unique()) | set(_load("metric_container.parquet")["cmdb_id"].unique())
        )
    except Exception:
        all_cmdb_ids = sorted(shm["cmdb_id"].unique())

    # Hosts that handle all traffic (gateways, LBs, web servers, storage backends)
    GLOBAL_SIGNAL_PREFIXES = ("IG", "MG", "APACHE", "MYSQL", "REDIS")

    nodes: list[dict] = []
    for cid in all_cmdb_ids:
        htype, layer = _host_type_layer(cid)
        cpu = float(latest_cpu.get(cid, 0.0))
        health = "critical" if cpu > 90 else ("degraded" if cpu > 75 else "healthy")

        # Compute golden signals from associated service metrics
        use_global = cid.upper().startswith(GLOBAL_SIGNAL_PREFIXES)
        svcs = host_services.get(cid, [])
        if use_global or not svcs:
            gs = dict(global_gs)          # gateway/LB/storage → all-service proxy
        else:
            svc_rows = [period_svc_map[s] for s in svcs if s in period_svc_map]
            if svc_rows:
                gs = _gs(
                    sum(float(r.avg_sr)  for r in svc_rows) / len(svc_rows),
                    sum(float(r.p90_mrt) for r in svc_rows) / len(svc_rows),
                    sum(float(r.avg_rr)  for r in svc_rows) / len(svc_rows),
                )
            else:
                gs = dict(global_gs)
        gs["saturation"] = round(cpu, 1)   # CPU is the primary saturation signal

        nodes.append({
            "id": cid,
            "name": cid,
            "type": htype,
            "layer": layer,
            "services": svcs,
            "metrics": {
                "cpu": round(cpu, 2),
                "memory": 0.0,
                "incident_count": 0,
                "risk_score": round(cpu / 10, 1),
                **gs,
            },
            "health": health,
            "platform": "on-prem-physical",
            "region": "bank-dc1",
        })

    return {"nodes": nodes}


def _q_dep_graph() -> dict:
    edges: list[dict] = []

    # ── Business Service → Microservice ─────────────────────────────────────────
    for bs in BUSINESS_SERVICES:
        for ms in bs["microservices"]:
            edges.append({"source": bs["id"], "target": ms,
                          "relationship": "depends_on", "type": "service_dependency"})

    # ── Microservice → Gateway  (curated 1-to-1 for clean presentation) ─────────
    # Each MS routes through exactly one gateway; gateways then route to compute.
    _SVC_GATEWAY: dict[str, str] = {
        "ServiceTest1":  "IG01",   # Payment Auth
        "ServiceTest2":  "IG02",
        "ServiceTest3":  "IG01",   # Settlement Processing
        "ServiceTest4":  "MG01",
        "ServiceTest5":  "IG02",   # Fraud Detection
        "ServiceTest6":  "MG02",
        "ServiceTest7":  "MG01",   # Merchant Services
        "ServiceTest8":  "MG02",
        "ServiceTest9":  "IG01",   # API Gateway Services
        "ServiceTest10": "IG02",
        "ServiceTest11": "MG01",   # Partner Integrations
    }
    for svc, gw in _SVC_GATEWAY.items():
        edges.append({"source": svc, "target": gw,
                      "relationship": "routes_through", "type": "infra_dependency"})

    # ── Physical topology: Network → Compute → Storage (1-to-1 chain) ───────────
    # IG → apache (one-to-one)
    for ig, apache in (("IG01", "apache01"), ("IG02", "apache02")):
        edges.append({"source": ig, "target": apache,
                      "relationship": "forwards_to", "type": "infra_dependency"})

    # MG → Tomcat (one-to-one)
    for mg, tomcat in (("MG01", "Tomcat03"), ("MG02", "Tomcat04")):
        edges.append({"source": mg, "target": tomcat,
                      "relationship": "forwards_to", "type": "infra_dependency"})

    # apache → Tomcat (one-to-one)
    for apache, tomcat in (("apache01", "Tomcat01"), ("apache02", "Tomcat02")):
        edges.append({"source": apache, "target": tomcat,
                      "relationship": "proxies_to", "type": "infra_dependency"})

    # Tomcat → Storage (specific pairing)
    for tomcat, redis, mysql in (
        ("Tomcat01", "Redis01", "Mysql01"),
        ("Tomcat02", "Redis02", "Mysql02"),
        ("Tomcat03", "Redis01", "Mysql01"),
        ("Tomcat04", "Redis02", "Mysql02"),
    ):
        edges.append({"source": tomcat, "target": redis,
                      "relationship": "uses_cache", "type": "infra_dependency"})
        edges.append({"source": tomcat, "target": mysql,
                      "relationship": "uses_db",    "type": "infra_dependency"})

    # Docker containers → Storage (A-side cache, B-side DB)
    for d in ("dockerA1", "dockerA2"):
        edges.append({"source": d, "target": "Redis01",
                      "relationship": "uses_cache", "type": "infra_dependency"})
    for d in ("dockerB1", "dockerB2"):
        edges.append({"source": d, "target": "Mysql01",
                      "relationship": "uses_db", "type": "infra_dependency"})

    return {"edges": edges}


def _q_incidents() -> dict:
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
        parent_bs = _MS_TO_BS.get(svc, svc)

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
    shm = _svc_host_map()
    services = sorted(shm["service"].unique())
    cmdb_ids = sorted(shm["cmdb_id"].unique())

    nodes: list[dict] = []
    edges: list[dict] = []

    # business service nodes
    for bs in BUSINESS_SERVICES:
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
    for bs in BUSINESS_SERVICES:
        for ms in bs["microservices"]:
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
    if u.startswith("REDIS"):  return "cache"
    if u.startswith("APACHE"): return "web server"
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


# Hosts that always have log_service entries (Tomcat/Apache app tier)
_LOG_HOSTS = ["Tomcat01", "Tomcat02", "Tomcat03", "Tomcat04", "apache01", "apache02"]

# Which services flow through each infra node
_INFRA_SVCS: dict[str, list[str]] = {
    "IG01":     ["ServiceTest1", "ServiceTest3", "ServiceTest9"],
    "IG02":     ["ServiceTest2", "ServiceTest5", "ServiceTest10"],
    "MG01":     ["ServiceTest4", "ServiceTest7", "ServiceTest11"],
    "MG02":     ["ServiceTest6", "ServiceTest8"],
    "apache01": ["ServiceTest1", "ServiceTest3", "ServiceTest9"],
    "apache02": ["ServiceTest2", "ServiceTest5", "ServiceTest10"],
    "Tomcat01": ["ServiceTest1", "ServiceTest3", "ServiceTest9"],
    "Tomcat02": ["ServiceTest2", "ServiceTest5", "ServiceTest10"],
    "Tomcat03": ["ServiceTest4", "ServiceTest7", "ServiceTest11"],
    "Tomcat04": ["ServiceTest6", "ServiceTest8"],
    "Redis01":  ["ServiceTest1", "ServiceTest3", "ServiceTest4", "ServiceTest7", "ServiceTest9", "ServiceTest11"],
    "Redis02":  ["ServiceTest2", "ServiceTest5", "ServiceTest6", "ServiceTest8", "ServiceTest10"],
    "Mysql01":  ["ServiceTest1", "ServiceTest3", "ServiceTest4", "ServiceTest7", "ServiceTest9", "ServiceTest11"],
    "Mysql02":  ["ServiceTest2", "ServiceTest5", "ServiceTest6", "ServiceTest8", "ServiceTest10"],
}


def infer_services_from_hosts(hosts: list[str]) -> list[str]:
    """Given a list of infra host IDs, return all service IDs that flow through them."""
    seen: set[str] = set()
    for h in hosts:
        for svc in _INFRA_SVCS.get(h, []):
            seen.add(svc)
    return sorted(seen)


def query_incident_telemetry(
    service: str,
    cmdb_ids: list[str],
    start_ts: int,
    end_ts: int,
) -> dict:
    """
    Query metrics, logs, and traces for a specific incident time window.

    When `service` is empty (infra-only incidents), metrics are fetched for
    all services inferred from the `cmdb_ids` host list.
    Logs are always queried from the known app-tier log hosts (Tomcat/Apache)
    as well as any explicitly provided `cmdb_ids`.
    """
    end_ts = min(end_ts, start_ts + 14400)

    # Infer services when the incident has no explicit service (infra entities only)
    services: list[str] = []
    if service:
        services = [service]
    else:
        services = infer_services_from_hosts(cmdb_ids) or []

    # Log hosts = explicitly provided cmdb_ids + all known app-tier hosts
    log_hosts = sorted(set(cmdb_ids) | set(_LOG_HOSTS))

    result: dict = {
        "service": service or (services[0] if services else ""),
        "services": services,
        "window": {"start": _ts_iso(start_ts), "end": _ts_iso(end_ts)},
        "metrics": [],
        "service_metrics": {},   # per-service breakdown
        "host_metrics": [],
        "logs": [],
        "traces": [],
    }

    # ── App metrics — all inferred services ─────────────────────────────────
    try:
        ma = _metric_app()
        w = ma[
            (ma["service"].isin(services))
            & (ma["timestamp_s"] >= start_ts)
            & (ma["timestamp_s"] <= end_ts)
        ].sort_values("timestamp_s") if services else ma.iloc[0:0]

        # Aggregate across services for backward-compat "metrics" list
        result["metrics"] = [
            {
                "timestamp": _ts_iso(int(r.timestamp_s)),
                "service": str(r.service),
                "request_rate": round(float(r.rr), 2),
                "success_rate": round(float(r.sr), 2),
                "request_count": int(r.cnt),
                "mean_response_time": round(float(r.mrt), 2),
            }
            for r in w.itertuples()
        ]

        # Per-service summary (min/avg/max) for richer context
        for svc, grp in w.groupby("service"):
            result["service_metrics"][str(svc)] = {
                "success_rate":        {"min": round(float(grp["sr"].min()), 2),
                                        "avg": round(float(grp["sr"].mean()), 2),
                                        "max": round(float(grp["sr"].max()), 2)},
                "mean_response_time":  {"min": round(float(grp["mrt"].min()), 0),
                                        "avg": round(float(grp["mrt"].mean()), 0),
                                        "max": round(float(grp["mrt"].max()), 0)},
                "request_rate":        {"min": round(float(grp["rr"].min()), 2),
                                        "avg": round(float(grp["rr"].mean()), 2),
                                        "max": round(float(grp["rr"].max()), 2)},
                "data_points": len(grp),
            }

        # Host CPU
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
                    for r in host_df.head(200).itertuples()
                ]
            except Exception:
                pass
    except Exception as e:
        result["metric_error"] = str(e)

    # ── Logs — include known app-tier hosts even if not in entities ──────────
    try:
        log_filters: list = [
            ("timestamp_s", ">=", start_ts),
            ("timestamp_s", "<=", end_ts),
        ]
        if log_hosts:
            log_filters.append(("cmdb_id", "in", log_hosts))
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
                        kw in str(r.value).lower()
                        for kw in ("error", "exception", "fail", "oom", "timeout", "critical",
                                   "allocation failure", "gc pause", "full gc")
                    )
                    else "info"
                ),
            }
            for r in log_df.sort_values("timestamp_s").head(200).itertuples()
        ]
    except Exception as e:
        result["log_error"] = str(e)

    # ── Traces ────────────────────────────────────────────────────────────────
    try:
        for svc in services[:3]:   # try up to 3 services
            trace_filters: list = [
                ("timestamp_s", ">=", start_ts),
                ("timestamp_s", "<=", end_ts),
                ("service", "==", svc),
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
                result["traces"] += [
                    {
                        "trace_id": str(r.trace_id),
                        "service": str(r.service),
                        "host": str(r.cmdb_id),
                        "timestamp": _ts_iso(int(r.timestamp_s)),
                        "has_parent": bool(r.parent_span_id),
                    }
                    for r in sampled.itertuples()
                ]
                if result["traces"]:
                    break
    except Exception as e:
        result["trace_error"] = str(e)

    return result


def _q_incident_graph() -> dict:
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


def query_node_metrics_timeseries(node_id: str, window_minutes: int) -> dict:
    """
    Return per-metric time-series with type-aware anomaly detection for one dependency-map node.

    Window anchor = latest available timestamp for that node (parquet data, not real-time).
    Baseline     = all data *before* the window (falls back to full dataset if window covers all data).

    Metric types and anomaly methods:
      Gauge        → MAD / robust-z vs baseline
      Rate         → MAD / robust-z vs baseline
      Counter      → diff() / interval → rate  then MAD / robust-z on rate
      State        → event detection: 0→1 transitions in incident window (sr < 99 %)
      HighWaterMark→ monotone break: value rising faster than baseline linear trend
    """
    import numpy as np

    window_sec = window_minutes * 60
    bs_ids = {bs["id"] for bs in BUSINESS_SERVICES}
    ms_set = {ms for bs in BUSINESS_SERVICES for ms in bs["microservices"]}

    # ── anomaly helpers ──────────────────────────────────────────────────────────

    def _robust_z(arr: np.ndarray, baseline: np.ndarray):
        valid_b = baseline[~np.isnan(baseline)]
        if len(valid_b) == 0:
            valid_b = arr[~np.isnan(arr)]
        med = float(np.nanmedian(valid_b)) if len(valid_b) else 0.0
        mad = float(np.nanmedian(np.abs(valid_b - med))) if len(valid_b) else 0.0
        # Fall back to std-based scaling when MAD ≈ 0 (uniform baseline)
        scale = 1.4826 * mad
        if scale < 1e-6:
            scale = float(np.nanstd(valid_b)) if len(valid_b) > 1 else 1.0
            if scale < 1e-6:
                scale = 1.0
        zs = np.clip((arr - med) / scale, -99.9, 99.9)
        return zs, med, mad

    def _severity(max_abs_z: float) -> str:
        if max_abs_z >= 3.5: return "critical"
        if max_abs_z >= 2.0: return "warning"
        return "normal"

    def _z_ok(z: float) -> bool:
        return not (np.isnan(z) or np.isinf(z))

    def _max_absz(zs: np.ndarray) -> float:
        valid = zs[np.isfinite(zs)]
        return float(np.max(np.abs(valid))) if len(valid) else 0.0

    # ── series builders ──────────────────────────────────────────────────────────

    def _gauge(name: str, label: str, unit: str, w_df, b_df, col: str) -> dict | None:
        if w_df.empty: return None
        vals = w_df[col].values.astype(float)
        ts   = w_df["timestamp_s"].values.astype(float)
        b_v  = b_df[col].values.astype(float) if not b_df.empty else vals
        zs, med, mad = _robust_z(vals, b_v)
        mz = _max_absz(zs)
        return {
            "name": name, "label": label, "unit": unit,
            "metric_type": "Gauge",
            "anomaly_method": "MAD / robust-z vs baseline",
            "preprocessing": None,
            "points": [
                {"ts": _ts_iso(int(t)), "value": round(float(v), 3),
                 "z_score": round(float(z), 3) if _z_ok(z) else None,
                 "is_anomaly": bool(_z_ok(z) and abs(z) >= 3.5)}
                for t, v, z in zip(ts, vals, zs)
            ],
            "current_value": round(float(vals[-1]), 3),
            "baseline_median": round(med, 3),
            "baseline_mad": round(mad, 3),
            "max_z_score": round(mz, 3),
            "anomaly_severity": _severity(mz),
        }

    def _rate(name: str, label: str, unit: str, w_df, b_df, col: str) -> dict | None:
        """Already a rate (e.g. req/s) — same as gauge but labelled Rate."""
        s = _gauge(name, label, unit, w_df, b_df, col)
        if s: s["metric_type"] = "Rate"
        return s

    def _counter(name: str, label: str, unit: str, w_df, b_df, col: str) -> dict | None:
        if len(w_df) < 2: return None
        ts   = w_df["timestamp_s"].values.astype(float)
        raw  = w_df[col].values.astype(float)
        dt   = np.diff(ts);   dc = np.diff(raw)
        rates = np.where(dt > 0, np.clip(dc, 0, None) / dt, 0.0)
        # baseline rates
        if len(b_df) >= 2:
            b_ts  = b_df["timestamp_s"].values.astype(float)
            b_raw = b_df[col].values.astype(float)
            b_dt  = np.diff(b_ts); b_dc = np.diff(b_raw)
            b_rates = np.where(b_dt > 0, np.clip(b_dc, 0, None) / b_dt, 0.0)
        else:
            b_rates = rates
        zs, med, mad = _robust_z(rates, b_rates)
        mz = _max_absz(zs)
        pts = [
            {"ts": _ts_iso(int(ts[i+1])), "value": round(float(r), 4),
             "raw_count": round(float(raw[i+1]), 1),
             "z_score": round(float(z), 3) if _z_ok(z) else None,
             "is_anomaly": bool(_z_ok(z) and abs(z) >= 3.5)}
            for i, (r, z) in enumerate(zip(rates, zs))
        ]
        if not pts: return None
        return {
            "name": name, "label": label, "unit": unit,
            "metric_type": "Counter",
            "anomaly_method": "MAD / robust-z on rate",
            "preprocessing": "diff() / interval → rate",
            "points": pts,
            "current_value": round(float(rates[-1]), 4),
            "baseline_median": round(med, 4),
            "baseline_mad": round(mad, 4),
            "max_z_score": round(mz, 3),
            "anomaly_severity": _severity(mz),
        }

    def _state(name: str, label: str, w_df, col: str, threshold: float = 99.0) -> dict | None:
        """Binary state derived from success_rate: 1 = incident (sr < threshold)."""
        if w_df.empty: return None
        vals   = w_df[col].values.astype(float)
        ts     = w_df["timestamp_s"].values.astype(float)
        states = (vals < threshold).astype(int)
        onsets      = [] if len(states) < 2 else np.where(np.diff(states) > 0)[0].tolist()
        recoveries  = [] if len(states) < 2 else np.where(np.diff(states) < 0)[0].tolist()
        has_incident = bool(states.any())
        return {
            "name": name, "label": label, "unit": "state",
            "metric_type": "State",
            "anomaly_method": "Event detection: 0→1 in incident window",
            "preprocessing": None,
            "threshold": threshold,
            "points": [
                {"ts": _ts_iso(int(t)), "value": round(float(v), 2), "state": int(s)}
                for t, v, s in zip(ts, vals, states)
            ],
            "current_value": float(states[-1]) if len(states) else None,
            "state_events": {"onsets": onsets, "recoveries": recoveries},
            "anomaly_severity": "critical" if has_incident else "normal",
            "max_z_score": None,
            "baseline_median": None,
            "baseline_mad": None,
        }

    def _hwm(name: str, label: str, unit: str, w_df, b_df, col: str) -> dict | None:
        """High-water mark: flag monotone rise faster than baseline linear trend."""
        if w_df.empty: return None
        vals = w_df[col].values.astype(float)
        ts   = w_df["timestamp_s"].values.astype(float)
        b_v  = b_df[col].values.astype(float) if not b_df.empty else vals
        zs, med, mad = _robust_z(vals, b_v)
        mz = _max_absz(zs)
        # Monotone break
        hwm_break = False
        trend_slope = None
        if len(vals) >= 2:
            span = float(max(ts[-1] - ts[0], 1))
            val_slope = (vals[-1] - vals[0]) / span * 60  # per minute
            valid_b   = b_v[~np.isnan(b_v)]
            if len(valid_b) >= 3:
                try:
                    coeffs     = np.polyfit(np.arange(len(valid_b), dtype=float), valid_b, 1)
                    bl_slope   = float(coeffs[0])
                    bl_std     = float(np.nanstd(valid_b))
                    hwm_break  = bool(val_slope > bl_slope + 2 * bl_std)
                    trend_slope = round(bl_slope, 4)
                except Exception:
                    pass
        return {
            "name": name, "label": label, "unit": unit,
            "metric_type": "HighWaterMark",
            "anomaly_method": "Monotone break: value rises faster than baseline trend",
            "preprocessing": None,
            "points": [
                {"ts": _ts_iso(int(t)), "value": round(float(v), 2),
                 "z_score": round(float(z), 3) if _z_ok(z) else None,
                 "is_anomaly": bool(_z_ok(z) and abs(z) >= 3.5)}
                for t, v, z in zip(ts, vals, zs)
            ],
            "current_value": round(float(vals[-1]), 2),
            "baseline_median": round(med, 2),
            "baseline_mad": round(mad, 2),
            "max_z_score": round(mz, 3),
            "anomaly_severity": "critical" if hwm_break else _severity(mz),
            "hwm_break": hwm_break,
            "trend_slope": trend_slope,
        }

    # ── node resolution ──────────────────────────────────────────────────────────

    metrics: list[dict] = []
    anchor_ts = None
    node_type = "unknown"

    if node_id in bs_ids or node_id in ms_set:
        ma = _metric_app()
        if node_id in bs_ids:
            bs = next(b for b in BUSINESS_SERVICES if b["id"] == node_id)
            svc_df = (
                ma[ma["service"].isin(bs["microservices"])]
                .groupby("timestamp_s", observed=True, as_index=False)
                .agg(rr=("rr", "mean"), sr=("sr", "mean"),
                     cnt=("cnt", "sum"), mrt=("mrt", "mean"))
            )
            node_type = "business_service"
        else:
            svc_df = ma[ma["service"] == node_id].copy()
            node_type = "microservice"

        svc_df = svc_df.sort_values("timestamp_s").reset_index(drop=True)
        if svc_df.empty:
            return {"node_id": node_id, "data_available": False, "metrics": []}

        max_ts    = int(svc_df["timestamp_s"].max())
        anchor_ts = _ts_iso(max_ts)
        t0        = max_ts - window_sec
        w = svc_df[svc_df["timestamp_s"] >= t0].reset_index(drop=True)
        b = svc_df[svc_df["timestamp_s"] <  t0].reset_index(drop=True)
        if b.empty: b = svc_df  # fall back to full history as baseline

        for builder in [
            lambda: _rate("request_rate",       "Request Rate",    "req/s", w, b, "rr"),
            lambda: _gauge("success_rate",       "Success Rate",    "%",     w, b, "sr"),
            lambda: _gauge("mean_response_time", "Response Time",   "ms",    w, b, "mrt"),
            lambda: _counter("request_count",    "Request Volume",  "req/s", w, b, "cnt"),
            lambda: _state("error_state",        "Error State",     w, "sr", 99.0),
        ]:
            s = builder()
            if s: metrics.append(s)

    else:
        # ── infra node ───────────────────────────────────────────────────────────
        node_type = _host_type_layer(node_id)[0]

        # Curated mapping: infra node → microservices whose traffic passes through it
        _INFRA_SVCS: dict[str, list[str]] = {
            "IG01":     ["ServiceTest1", "ServiceTest3", "ServiceTest9"],
            "IG02":     ["ServiceTest2", "ServiceTest5", "ServiceTest10"],
            "MG01":     ["ServiceTest4", "ServiceTest7", "ServiceTest11"],
            "MG02":     ["ServiceTest6", "ServiceTest8"],
            "apache01": ["ServiceTest1", "ServiceTest3", "ServiceTest9"],
            "apache02": ["ServiceTest2", "ServiceTest5", "ServiceTest10"],
            "Tomcat01": ["ServiceTest1", "ServiceTest3", "ServiceTest9"],
            "Tomcat02": ["ServiceTest2", "ServiceTest5", "ServiceTest10"],
            "Tomcat03": ["ServiceTest4", "ServiceTest7", "ServiceTest11"],
            "Tomcat04": ["ServiceTest6", "ServiceTest8"],
            "Redis01":  ["ServiceTest1", "ServiceTest3", "ServiceTest4",
                         "ServiceTest7", "ServiceTest9", "ServiceTest11"],
            "Redis02":  ["ServiceTest2", "ServiceTest5", "ServiceTest6",
                         "ServiceTest8", "ServiceTest10"],
            "Mysql01":  ["ServiceTest1", "ServiceTest3", "ServiceTest4",
                         "ServiceTest7", "ServiceTest9", "ServiceTest11"],
            "Mysql02":  ["ServiceTest2", "ServiceTest5", "ServiceTest6",
                         "ServiceTest8", "ServiceTest10"],
        }
        svcs = next((v for k, v in _INFRA_SVCS.items() if k.upper() == node_id.upper()), [])

        # ── Service-derived KPIs (traffic / latency / errors) ─────────────────
        if svcs:
            try:
                ma = _metric_app()
                svc_df = (
                    ma[ma["service"].isin(svcs)]
                    .groupby("timestamp_s", observed=True, as_index=False)
                    .agg(rr=("rr", "mean"), sr=("sr", "mean"),
                         cnt=("cnt", "sum"), mrt=("mrt", "mean"))
                    .sort_values("timestamp_s").reset_index(drop=True)
                )
                if not svc_df.empty:
                    max_ts_svc = int(svc_df["timestamp_s"].max())
                    anchor_ts  = _ts_iso(max_ts_svc)
                    t0_svc     = max_ts_svc - window_sec
                    sw = svc_df[svc_df["timestamp_s"] >= t0_svc].reset_index(drop=True).copy()
                    sb = svc_df[svc_df["timestamp_s"] <  t0_svc].reset_index(drop=True).copy()
                    if sb.empty: sb = svc_df.copy()
                    sw["error_rate"] = 100.0 - sw["sr"]
                    sb["error_rate"] = 100.0 - sb["sr"]

                    for builder in [
                        lambda: _rate("traffic",        "Traffic",        "req/s", sw, sb, "rr"),
                        lambda: _gauge("latency",       "Latency",        "ms",    sw, sb, "mrt"),
                        lambda: _gauge("error_rate",    "Error Rate",     "%",     sw, sb, "error_rate"),
                        lambda: _counter("req_volume",  "Request Volume", "req/s", sw, sb, "cnt"),
                        lambda: _state("svc_health",    "Service Health", sw, "sr", 99.0),
                    ]:
                        s = builder()
                        if s: metrics.append(s)
            except Exception:
                pass

        # ── Host metrics (CPU saturation) ──────────────────────────────────────
        try:
            mc = _load("metric_container.parquet")
            nd = (
                mc[mc["cmdb_id"].str.upper() == node_id.upper()]
                .sort_values("timestamp_s").reset_index(drop=True)
            )
            if not nd.empty:
                max_ts_cpu = int(nd["timestamp_s"].max())
                if anchor_ts is None:
                    anchor_ts = _ts_iso(max_ts_cpu)
                t0_cpu = max_ts_cpu - window_sec

                for kpi_name, label, mtype in [
                    ("OSLinux-CPU_CPU_CPUCpuUtil", "CPU Saturation", "hwm"),
                    ("OSLinux-CPU_CPU_CPULoad",    "CPU Load",       "gauge"),
                ]:
                    kpi_all = nd[nd["kpi_name"] == kpi_name].reset_index(drop=True)
                    if kpi_all.empty: continue
                    kw = kpi_all[kpi_all["timestamp_s"] >= t0_cpu].reset_index(drop=True)
                    kb = kpi_all[kpi_all["timestamp_s"] <  t0_cpu].reset_index(drop=True)
                    if kb.empty: kb = kpi_all
                    slug = kpi_name.lower().replace("-", "_").replace(".", "_")
                    s = (_hwm if mtype == "hwm" else _gauge)(slug, label, "%", kw, kb, "value")
                    if s: metrics.append(s)
        except Exception:
            pass

        if not metrics:
            return {"node_id": node_id, "data_available": False, "metrics": []}

    return {
        "node_id":        node_id,
        "node_type":      node_type,
        "window_minutes": window_minutes,
        "anchor_ts":      anchor_ts,
        "data_available": len(metrics) > 0,
        "metrics":        metrics,
    }


def query_slo_burn(service: str, incident_ts: int, slo_target: float = 0.999) -> dict:
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


# ── Incident Telemetry Scanner ───────────────────────────────────────────────

def query_incident_telemetry_by_entities(t_start: int, t_end: int, entities: list[str]) -> dict:
    """
    Scan metrics, logs, and traces for the given time window and entity list.
    entities: mix of service names (ServiceTestN) and/or host/cmdb_id values.
    Returns structured data ready for LLM context injection.
    """
    import numpy as np

    # ── Resolve entities to services + hosts ────────────────────────────────
    shm = _svc_host_map()
    known_services: set[str] = set(shm["service"].unique())
    known_hosts: set[str] = set(shm["cmdb_id"].unique())
    try:
        mc_all = _load("metric_container.parquet")
        known_hosts.update(mc_all["cmdb_id"].unique())
    except Exception:
        pass

    target_services: set[str] = set()
    target_hosts: set[str] = set()

    for e in entities:
        eu = e.upper()
        matched = False
        for s in known_services:
            if e == s or e.lower() == s.lower():
                target_services.add(s)
                matched = True
        for h in known_hosts:
            if eu == h.upper():
                target_hosts.add(h)
                matched = True
        if not matched:
            # partial / fuzzy match
            for s in known_services:
                if e.lower() in s.lower():
                    target_services.add(s)
            for h in known_hosts:
                if e.lower() in h.lower():
                    target_hosts.add(h)

    # Use all services if none matched
    if not target_services and not target_hosts:
        target_services = set(known_services)

    # Expand services → their hosts
    if target_services:
        svc_hosts_df = shm[shm["service"].isin(target_services)]["cmdb_id"]
        target_hosts.update(svc_hosts_df.unique())

    result: dict = {
        "window": {
            "t_start": t_start,
            "t_end": t_end,
            "target_services": sorted(target_services),
            "target_hosts": sorted(target_hosts),
        }
    }

    # ── Metrics scan (metric_app.parquet) ───────────────────────────────────
    try:
        ma = _metric_app()
        win = ma[(ma["timestamp_s"] >= t_start) & (ma["timestamp_s"] <= t_end)]
        if target_services:
            win = win[win["service"].isin(target_services)]

        metrics_summary: list[dict] = []
        if not win.empty:
            total_intervals = max(1, len(win) // max(1, win["service"].nunique()))
            for svc, grp in win.groupby("service"):
                n = len(grp)
                err_ivl = int((grp["sr"] < 99.0).sum())
                slow_ivl = int((grp["mrt"] > 500.0).sum())
                worst_idx = grp["sr"].idxmin()
                worst_ts = int(grp.loc[worst_idx, "timestamp_s"])
                metrics_summary.append({
                    "service": str(svc),
                    "samples": n,
                    "avg_success_rate_pct": round(float(grp["sr"].mean()), 2),
                    "min_success_rate_pct": round(float(grp["sr"].min()), 2),
                    "avg_request_rate_rps": round(float(grp["rr"].mean()), 2),
                    "avg_response_time_ms": round(float(grp["mrt"].mean()), 1),
                    "max_response_time_ms": round(float(grp["mrt"].max()), 1),
                    "total_requests": int(grp["cnt"].sum()),
                    "error_intervals": err_ivl,
                    "slow_intervals": slow_ivl,
                    "error_interval_pct": round(100.0 * err_ivl / n, 1),
                    "worst_sr_at": _ts_iso(worst_ts),
                })
            metrics_summary.sort(key=lambda x: x["avg_success_rate_pct"])
        result["metrics"] = metrics_summary
    except Exception as exc:
        result["metrics"] = []
        result["metrics_error"] = str(exc)

    # ── Infra / container metrics scan (metric_container.parquet) ────────────
    try:
        mc = _load("metric_container.parquet")
        win_mc = mc[(mc["timestamp_s"] >= t_start) & (mc["timestamp_s"] <= t_end)]
        if target_hosts:
            win_mc = win_mc[win_mc["cmdb_id"].isin(target_hosts)]

        infra_summary: list[dict] = []
        if not win_mc.empty:
            CPU_KPI = "OSLinux-CPU_CPU_CPUCpuUtil"
            for host, grp in win_mc.groupby("cmdb_id"):
                cpu_grp = grp[grp["kpi_name"] == CPU_KPI]
                if cpu_grp.empty:
                    continue
                vals = cpu_grp["value"].dropna()
                infra_summary.append({
                    "host": str(host),
                    "avg_cpu_pct": round(float(vals.mean()), 1),
                    "max_cpu_pct": round(float(vals.max()), 1),
                    "high_cpu_intervals": int((vals > 80.0).sum()),
                    "samples": int(len(vals)),
                })
            infra_summary.sort(key=lambda x: -x["avg_cpu_pct"])
        result["infra_metrics"] = infra_summary
    except Exception as exc:
        result["infra_metrics"] = []
        result["infra_metrics_error"] = str(exc)

    # ── Log scan (log_service.parquet) ──────────────────────────────────────
    ERROR_KWS = ("error", "exception", "fail", "oom", "timeout", "critical", "alert", "crash", "warn")
    try:
        pf_log = pq.ParquetFile(PARQUET_DIR / "log_service.parquet")
        log_chunks: list[pd.DataFrame] = []
        for batch in pf_log.iter_batches(
            batch_size=200_000, columns=["cmdb_id", "log_name", "value", "timestamp_s"]
        ):
            df = batch.to_pandas()
            df = df[(df["timestamp_s"] >= t_start) & (df["timestamp_s"] <= t_end)]
            if target_hosts:
                df = df[df["cmdb_id"].isin(target_hosts)]
            if not df.empty:
                log_chunks.append(df)
            if sum(len(c) for c in log_chunks) >= 100_000:
                break

        if log_chunks:
            logs_df = pd.concat(log_chunks, ignore_index=True)
            log_name_lc = logs_df["log_name"].str.lower()
            is_err = log_name_lc.apply(lambda n: any(kw in n for kw in ERROR_KWS))

            top_types = (
                logs_df.groupby(["cmdb_id", "log_name"]).size()
                .reset_index(name="count")
                .sort_values("count", ascending=False)
                .head(20)
            )
            result["logs"] = {
                "total_entries": int(len(logs_df)),
                "unique_hosts": int(logs_df["cmdb_id"].nunique()),
                "error_entries": int(is_err.sum()),
                "error_rate_pct": round(100.0 * is_err.sum() / max(1, len(logs_df)), 1),
                "top_log_types": [
                    {
                        "host": r["cmdb_id"],
                        "log_type": r["log_name"],
                        "count": int(r["count"]),
                        "is_error": any(kw in str(r["log_name"]).lower() for kw in ERROR_KWS),
                    }
                    for _, r in top_types.iterrows()
                ],
            }
        else:
            result["logs"] = {
                "total_entries": 0, "unique_hosts": 0,
                "error_entries": 0, "error_rate_pct": 0.0, "top_log_types": [],
            }
    except Exception as exc:
        result["logs"] = {"error": str(exc)}

    # ── Trace scan (trace_span.parquet) ─────────────────────────────────────
    try:
        pf_tr = pq.ParquetFile(PARQUET_DIR / "trace_span.parquet")
        tr_chunks: list[pd.DataFrame] = []
        for batch in pf_tr.iter_batches(
            batch_size=200_000,
            columns=["cmdb_id", "span_id", "trace_id", "duration", "timestamp_s"],
        ):
            df = batch.to_pandas()
            df = df[(df["timestamp_s"] >= t_start) & (df["timestamp_s"] <= t_end)]
            if target_hosts:
                df = df[df["cmdb_id"].isin(target_hosts)]
            if not df.empty:
                tr_chunks.append(df)
            if sum(len(c) for c in tr_chunks) >= 100_000:
                break

        if tr_chunks:
            tr_df = pd.concat(tr_chunks, ignore_index=True)
            dur = tr_df["duration"].dropna()
            if not dur.empty:
                p95 = float(np.percentile(dur, 95))
                p99 = float(np.percentile(dur, 99))
                slow_df = tr_df[tr_df["duration"] > p95]
                host_span_counts = (
                    tr_df.groupby("cmdb_id").size()
                    .reset_index(name="span_count")
                    .sort_values("span_count", ascending=False)
                )
                result["traces"] = {
                    "total_spans": int(len(tr_df)),
                    "unique_traces": int(tr_df["trace_id"].nunique()),
                    "avg_duration_ms": round(float(dur.mean()), 1),
                    "median_duration_ms": round(float(dur.median()), 1),
                    "p95_duration_ms": round(p95, 1),
                    "p99_duration_ms": round(p99, 1),
                    "max_duration_ms": round(float(dur.max()), 1),
                    "slow_span_count": int(len(slow_df)),
                    "slow_span_pct": round(100.0 * len(slow_df) / max(1, len(tr_df)), 1),
                    "hosts_with_slow_spans": slow_df["cmdb_id"].unique().tolist()[:10],
                    "spans_per_host": [
                        {"host": r["cmdb_id"], "span_count": int(r["span_count"])}
                        for _, r in host_span_counts.head(10).iterrows()
                    ],
                }
            else:
                result["traces"] = {"total_spans": 0, "unique_traces": 0}
        else:
            result["traces"] = {"total_spans": 0, "unique_traces": 0}
    except Exception as exc:
        result["traces"] = {"error": str(exc)}

    return result
