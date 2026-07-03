from typing import Optional

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


@router.get("/dashboard")
def get_monitoring_dashboard():
    from app import parquet_store
    from app.services.intelligence import _load_incidents, _load_alerts

    services_raw = parquet_store.query("dependencies/services.json").get("services", [])
    infra_raw    = parquet_store.query("dependencies/infrastructure.json").get("nodes", [])

    # Service tab — microservices only, shaped for MonitoringDashboard
    service_metrics = []
    for svc in services_raw:
        if svc.get("type") != "microservice":
            continue
        m  = svc.get("metrics", {})
        sr = m.get("success_rate", 100.0)
        service_metrics.append({
            "id":                 svc["id"],
            "name":               svc["name"],
            "health":             svc["health"],
            "latency_p99_ms":     round(m.get("mean_response_time", 0.0), 1),
            "error_rate":         round(max(0.0, 100.0 - sr), 2),
            "throughput_rps":     round(m.get("request_rate", 0.0), 2),
            "transaction_volume": int(m.get("request_rate", 0.0) * 1800),
            "availability":       round(sr, 3),
        })

    # Infrastructure tab
    servers  = []
    cpu_sum  = 0.0
    for node in infra_raw:
        m   = node.get("metrics", {})
        cpu = m.get("cpu", 0.0)
        cpu_sum += cpu
        servers.append({
            "id":      node["id"],
            "cpu":     round(cpu, 2),
            "memory":  round(m.get("memory", 0.0), 2),
            "storage": 0.0,
            "network": 0.0,
            "io":      0.0,
        })
    avg_cpu = round(cpu_sum / max(1, len(servers)), 2)

    # Executive summary
    all_sr = [s["availability"] for s in service_metrics]
    avg_sr = sum(all_sr) / max(1, len(all_sr)) if all_sr else 100.0
    services_at_risk = sum(1 for s in service_metrics if s["health"] != "healthy")

    try:
        incidents   = _load_incidents()
        alerts      = _load_alerts()
        active_inc  = len([i for i in incidents if i.get("state") in ("Open", "In Progress", "New")])
        open_alerts = len([a for a in alerts   if a.get("status") in ("open", "Pending", "Fired")])
    except Exception:
        active_inc  = 0
        open_alerts = 0

    # Technical tab — split infra nodes by component type
    containers = [
        {"id": n["id"], "status": n["health"], "cpu": n["metrics"]["cpu"], "memory": 0.0}
        for n in infra_raw if "docker" in n["id"].lower()
    ]
    databases = [
        {"id": n["id"], "connections": 0, "query_latency_ms": 0.0, "replication_lag_ms": 0.0}
        for n in infra_raw if any(k in n["id"].lower() for k in ("mysql", "redis"))
    ]
    jvm_nodes = [
        {"service": n["id"], "heap_used_pct": 0.0, "thread_count": 0, "gc_pause_ms": 0.0}
        for n in infra_raw if any(k in n["id"].lower() for k in ("tomcat", "ig", "mg"))
    ]
    apis = [
        {
            "name":             s["id"],
            "latency_ms":       s["latency_p99_ms"],
            "error_rate":       s["error_rate"],
            "requests_per_sec": s["throughput_rps"],
        }
        for s in service_metrics[:8]
    ]

    return {
        "dataset_available": parquet_store.is_dataset_available(),
        "executive": {
            "service_availability":     round(avg_sr, 2),
            "transaction_success_rate": round(avg_sr, 2),
            "sla_compliance":           round(min(100.0, avg_sr), 2),
            "revenue_impact_usd":       0,
            "customer_impact_count":    0,
            "services_at_risk":         services_at_risk,
            "active_incidents":         active_inc,
            "open_alerts":              open_alerts,
        },
        "service":        {"services": service_metrics},
        "technical":      {
            "containers": containers,
            "apis":       apis,
            "databases":  databases,
            "queues":     [],
            "jvm":        jvm_nodes,
        },
        "infrastructure": {
            "summary": {
                "avg_cpu":     avg_cpu,
                "avg_memory":  0.0,
                "avg_storage": 0.0,
                "avg_network": 0.0,
                "avg_io":      0.0,
            },
            "servers": servers,
        },
    }


@router.get("/alerts")
def get_alerts(
    status:   Optional[str] = None,
    severity: Optional[str] = None,
    limit:    int = Query(default=50, le=500),
):
    from app.services.intelligence import _load_alerts, get_service_for_entity
    alerts = _load_alerts()

    if status:
        alerts = [a for a in alerts if a.get("status") == status]
    if severity:
        alerts = [a for a in alerts if a.get("severity") == severity]

    for a in alerts:
        a["service"] = get_service_for_entity(a.get("entity_id", ""))

    return {"alerts": alerts[:limit], "total": len(alerts)}


@router.get("/metrics")
def get_metrics(entity_id: Optional[str] = None, metric: Optional[str] = None):
    from app import parquet_store
    data    = parquet_store.query("monitoring/metrics.json")
    metrics = data.get("metrics", [])
    if entity_id:
        metrics = [m for m in metrics if m.get("entity_id") == entity_id]
    if metric:
        metrics = [m for m in metrics if m.get("metric") == metric]
    return {"metrics": metrics}


@router.get("/events")
def get_events(limit: int = Query(default=50, le=500)):
    from app import parquet_store
    data   = parquet_store.query("monitoring/events.json")
    events = data.get("events", [])
    return {"events": events[:limit], "total": len(events)}


@router.get("/node-metrics/{node_id}")
def get_node_metrics(node_id: str, window: int = Query(default=30, ge=1, le=60)):
    """
    Time-series metrics with type-aware anomaly detection for a single dependency-map node.
    window = look-back minutes (5 | 10 | 30 | 60); anchored to latest data point, not real-time.
    """
    from app import parquet_store
    # Snap to one of the four UI options
    window = min([w for w in (5, 10, 30, 60) if w >= window] or [60])
    return parquet_store.query_node_metrics_timeseries(node_id, window)
