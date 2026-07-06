"""Build unified OpsEntity registry from services, infrastructure, and graph data."""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Optional

from app.ops.models import OpsEntity

_BUSINESS_SERVICE_NAMES = {
    "payments": "Payments",
    "orders": "Orders",
    "auth": "Authentication",
    "authentication": "Authentication",
    "inventory": "Inventory",
    "shipping": "Shipping",
    "billing": "Billing",
    "notification": "Notifications",
    "customer": "Customer Portal",
    "hr": "HR",
    "finance": "Finance",
    "analytics": "Analytics",
    "reporting": "Reporting",
}


def _infer_entity_type(node_id: str, node_type: str, metrics: dict) -> str:
    lid = node_id.lower()
    ntype = (node_type or "").lower()

    if ntype in ("business_service", "business"):
        return "business_service"
    if ntype == "application":
        return "application"
    if ntype in ("microservice", "service"):
        return "microservice"
    if ntype == "api":
        return "api"
    if any(k in lid for k in ("frontend", "web-ui", "portal", "bff")):
        return "frontend"
    if any(k in lid for k in ("gateway", "ig", "nginx", "ingress")):
        return "gateway"
    if any(k in lid for k in ("worker", "consumer", "processor")):
        return "worker"
    if any(k in lid for k in ("batch", "cron", "job", "scheduler")):
        return "batch_job"
    if any(k in lid for k in ("pipeline", "etl", "airflow", "spark", "flink")):
        return "pipeline"
    if any(k in lid for k in ("ai", "ml", "model", "inference", "llm")):
        return "ai_service"
    if any(k in lid for k in ("docker", "container")) and "k8s" not in lid:
        return "container"
    if any(k in lid for k in ("pod", "k8s")):
        return "pod"
    if any(k in lid for k in ("mysql", "postgres", "mongo", "redis", "oracle", "db", "database", "cassandra")):
        return "database"
    if "redis" in lid or "cache" in lid or "memcached" in lid:
        return "cache"
    if any(k in lid for k in ("kafka", "rabbit", "queue", "sqs", "sns", "mq", "pulsar")):
        return "queue"
    if any(k in lid for k in ("volume", "disk", "storage", "bucket", "s3", "ebs")):
        return "storage"
    if any(k in lid for k in ("lb", "loadbalancer", "alb", "nlb", "elb")):
        return "load_balancer"
    if any(k in lid for k in ("lambda", "function", "serverless", "cloudrun")):
        return "function"
    if any(k in lid for k in ("vm", "ec2", "instance", "compute")):
        return "vm"
    if any(k in lid for k in ("esxi", "hyperv", "vmware", "hyper-v")):
        return "vm"
    if any(k in lid for k in ("host", "server", "rack", "node")):
        return "host" if "k8s" not in lid else "node"
    if any(k in lid for k in ("tomcat", "jvm", "dotnet", "nodejs", "runtime")):
        return "runtime"
    if any(k in lid for k in ("vpc", "subnet", "network", "dns", "firewall")):
        return "network"
    if ntype:
        return ntype
    return "node"


def _infer_business_service(service_id: str, service_name: str) -> Optional[str]:
    for key, label in _BUSINESS_SERVICE_NAMES.items():
        if key in service_id.lower() or key in service_name.lower():
            return label
    return None


def _normalize_health(health: Any) -> str:
    h = str(health or "unknown").lower()
    if h in ("healthy", "ok", "running", "up"):
        return "healthy"
    if h in ("warning", "degraded", "warn"):
        return "warning"
    if h in ("critical", "down", "failed", "error"):
        return "critical"
    return "unknown"


def _service_metrics(raw: dict) -> dict[str, Any]:
    m = raw.get("metrics") or {}
    sr = float(m.get("success_rate", 100.0))
    return {
        "availability": round(sr, 3),
        "latency_p50": round(float(m.get("mean_response_time", 0)) * 0.7, 1),
        "latency_p95": round(float(m.get("mean_response_time", 0)) * 0.95, 1),
        "latency_p99": round(float(m.get("mean_response_time", 0)), 1),
        "throughput": round(float(m.get("request_rate", 0)), 2),
        "error_rate": round(max(0.0, 100.0 - sr), 2),
        "apdex": round(min(1.0, sr / 100.0), 2),
        "slo_burn_rate": 0.4 if sr < 99.5 else 0.1,
    }


def _infra_metrics(raw: dict) -> dict[str, Any]:
    m = raw.get("metrics") or {}
    cpu = float(m.get("cpu", 0))
    mem = float(m.get("memory", 0))
    return {
        "cpu": cpu,
        "cpu_usage": cpu,
        "memory": mem,
        "memory_usage": mem,
        "memory_usage_pct": mem,
        "disk_usage_pct": float(m.get("storage", 0)),
        "network_mbps": float(m.get("network", 0)),
        "load_avg_5m": round(cpu / 50.0, 2),
        "connections": int(m.get("connections", 0)),
        "query_latency_ms": float(m.get("query_latency_ms", 0)),
        "queue_depth": int(m.get("queue_depth", 0)),
        "consumer_lag": int(m.get("consumer_lag", 0)),
    }


def _load_nodes() -> dict[str, dict]:
    from app.data_store import read_json

    services_data = read_json("dependencies/services.json")
    infra_data = read_json("dependencies/infrastructure.json")
    if not services_data or not infra_data:
        from app import parquet_store

        if not services_data:
            services_data = parquet_store.query("dependencies/services.json")
        if not infra_data:
            infra_data = parquet_store.query("dependencies/infrastructure.json")

    nodes: dict[str, dict] = {}
    for svc in services_data.get("services", []):
        nodes[svc["id"]] = svc
    for node in infra_data.get("nodes", []):
        nodes[node["id"]] = node
    return nodes


def _load_edges() -> list[dict]:
    from app.data_store import read_json

    data = read_json("dependencies/dependency_graph.json")
    if not data:
        from app import parquet_store

        data = parquet_store.query("dependencies/dependency_graph.json")
    return data.get("edges", [])


@lru_cache(maxsize=1)
def build_entity_registry() -> list[OpsEntity]:
    nodes = _load_nodes()
    edges = _load_edges()

    downstream: dict[str, list[str]] = {}
    upstream: dict[str, list[str]] = {}
    for e in edges:
        downstream.setdefault(e["source"], []).append(e["target"])
        upstream.setdefault(e["target"], []).append(e["source"])

    entities: list[OpsEntity] = []
    business_services_created: set[str] = set()

    for node_id, raw in nodes.items():
        ntype = raw.get("type", "")
        entity_type = _infer_entity_type(node_id, ntype, raw.get("metrics") or {})
        health = _normalize_health(raw.get("health"))
        is_service = entity_type in (
            "microservice", "application", "api", "frontend", "backend",
            "gateway", "worker", "business_service",
        )
        metrics = _service_metrics(raw) if is_service else _infra_metrics(raw)

        biz = _infer_business_service(node_id, raw.get("name", node_id))
        metadata: dict[str, Any] = {
            "description": raw.get("description", ""),
            "layer": raw.get("layer", ""),
            "business_service": biz,
        }
        if entity_type == "pod":
            metadata.update({"namespace": "default", "status": health, "node": "cluster-node-1"})
        if entity_type == "database":
            metadata["engine"] = "PostgreSQL" if "postgres" in node_id.lower() else "MySQL"
        if entity_type == "queue":
            metadata["broker_type"] = "Kafka" if "kafka" in node_id.lower() else "RabbitMQ"

        entities.append(
            OpsEntity(
                id=node_id,
                name=raw.get("name", node_id),
                entity_type=entity_type,
                layer=raw.get("layer"),
                health=health,  # type: ignore[arg-type]
                platform=raw.get("platform"),
                region=raw.get("region"),
                owner=raw.get("owner", "Platform Engineering"),
                metrics=metrics,
                metadata=metadata,
                relationships=downstream.get(node_id, []) + upstream.get(node_id, []),
            )
        )

        if biz and biz not in business_services_created:
            business_services_created.add(biz)
            child_services = [
                e for e in entities
                if e.metadata.get("business_service") == biz and e.entity_type == "microservice"
            ]
            avg_avail = (
                sum(e.metrics.get("availability", 100) for e in child_services) / len(child_services)
                if child_services else 99.9
            )
            worst_health = "healthy"
            for e in child_services:
                if e.health == "critical":
                    worst_health = "critical"
                    break
                if e.health == "warning":
                    worst_health = "warning"

            entities.append(
                OpsEntity(
                    id=f"biz-{biz.lower().replace(' ', '-')}",
                    name=biz,
                    entity_type="business_service",
                    layer="business",
                    health=worst_health,  # type: ignore[arg-type]
                    owner="Business Operations",
                    metrics={
                        "availability": round(avg_avail, 2),
                        "service_count": len(child_services),
                        "latency_p99": round(
                            sum(e.metrics.get("latency_p99", 0) for e in child_services) / max(1, len(child_services)), 1
                        ),
                        "error_rate": round(
                            sum(e.metrics.get("error_rate", 0) for e in child_services) / max(1, len(child_services)), 2
                        ),
                    },
                    metadata={"constituent_services": [e.id for e in child_services]},
                    relationships=[e.id for e in child_services],
                )
            )

    # Synthetic cloud accounts when platforms detected — removed; only real entities from data sources
    return entities


def clear_entity_registry_cache() -> None:
    build_entity_registry.cache_clear()


def get_entities(
    entity_type: Optional[str] = None,
    perspective: Optional[str] = None,
    health: Optional[str] = None,
) -> list[OpsEntity]:
    from app.ops.catalog import ENTITY_TYPES

    entities = build_entity_registry()
    type_perspective = {t.id: t.perspective for t in ENTITY_TYPES}

    if entity_type:
        entities = [e for e in entities if e.entity_type == entity_type]
    if perspective:
        entities = [e for e in entities if type_perspective.get(e.entity_type) == perspective]
    if health:
        entities = [e for e in entities if e.health == health]
    return entities
