#!/usr/bin/env python3
"""Generate synthetic data for the Autonomous IT Operations Intelligence Platform MVP."""

import json
import random
import uuid
from datetime import datetime, timedelta
import sys
from pathlib import Path

# Allow importing incident_intelligence from scripts/
sys.path.insert(0, str(Path(__file__).resolve().parent))

from incident_intelligence import (
    generate_incidents as generate_rich_incidents,
    build_knowledge_graph,
    build_per_incident_graph,
)

random.seed(42)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

BUSINESS_SERVICES = [
    "payment-authorization",
    "settlement-processing",
    "fraud-detection",
    "merchant-services",
    "api-gateway-services",
    "partner-integrations",
]

APPLICATIONS = {
    "payment-authorization": ["auth-app", "token-app"],
    "settlement-processing": ["settlement-app", "reconciliation-app"],
    "fraud-detection": ["fraud-app", "ml-scoring-app"],
    "merchant-services": ["merchant-portal-app", "merchant-api-app"],
    "api-gateway-services": ["gateway-app", "rate-limiter-app"],
    "partner-integrations": ["partner-api-app", "webhook-app"],
}

MICROSERVICES = [
    "api-gateway", "auth-service", "settlement-service", "fraud-service",
    "customer-service", "identity-service", "notification-service", "audit-service",
    "merchant-api", "partner-api", "webhook-handler", "rate-limiter",
    "token-service", "reconciliation-service", "ml-scoring-service",
]

DATABASES = ["postgres-cluster", "cassandra-cluster", "redis-cluster"]
QUEUES = ["kafka-cluster", "rabbitmq-cluster"]
K8S_CLUSTERS = ["k8s-cluster-a", "k8s-cluster-b"]
LOAD_BALANCERS = ["external-lb", "internal-lb"]
STORAGE = ["storage-cluster-1", "storage-cluster-2", "storage-cluster-3", "storage-cluster-4", "storage-cluster-5"]
NETWORKS = ["network-spine-1", "network-spine-2", "network-spine-3", "network-spine-4"]
TOR_SWITCHES = [f"tor-switch-{i}" for i in range(1, 21)]


def health_status(value: float) -> str:
    if value >= 80:
        return "critical"
    if value >= 60:
        return "warning"
    return "healthy"


def metric_value(base: float, variance: float = 20) -> float:
    return max(0, min(100, base + random.uniform(-variance, variance)))


def generate_racks_and_servers():
    racks = []
    servers = []
    for rack_num in range(1, 11):
        rack_id = f"rack-{rack_num:02d}"
        rack_servers = []
        for slot in range(1, 11):
            server_id = f"server-r{rack_num:02d}-s{slot:02d}"
            cpu = metric_value(random.uniform(20, 70))
            memory = metric_value(random.uniform(25, 75))
            storage = metric_value(random.uniform(30, 65))
            io_util = metric_value(random.uniform(15, 60))
            network = metric_value(random.uniform(10, 55))
            latency = metric_value(random.uniform(5, 40), 15)
            error_rate = metric_value(random.uniform(0, 15), 10)
            incident_count = random.randint(0, 8)
            risk_score = metric_value(
                (cpu + memory + error_rate * 3 + incident_count * 5) / 4
            )
            server = {
                "id": server_id,
                "name": f"Server R{rack_num:02d}-S{slot:02d}",
                "type": "server",
                "layer": "server",
                "rack_id": rack_id,
                "tor_switch": TOR_SWITCHES[(rack_num - 1) % 20],
                "network_id": NETWORKS[(rack_num - 1) % 4],
                "metrics": {
                    "cpu": round(cpu, 1),
                    "memory": round(memory, 1),
                    "storage": round(storage, 1),
                    "io": round(io_util, 1),
                    "network": round(network, 1),
                    "latency": round(latency, 1),
                    "error_rate": round(error_rate, 2),
                    "incident_count": incident_count,
                    "risk_score": round(risk_score, 1),
                },
                "health": health_status(max(cpu, memory, error_rate * 5)),
            }
            servers.append(server)
            rack_servers.append(server_id)
        racks.append({
            "id": rack_id,
            "name": f"Rack {rack_num:02d}",
            "type": "rack",
            "layer": "rack",
            "location": f"DC1-Row-{((rack_num - 1) // 5) + 1}",
            "server_count": 10,
            "servers": rack_servers,
            "network_id": NETWORKS[(rack_num - 1) % 4],
            "metrics": {
                "cpu": round(metric_value(45), 1),
                "memory": round(metric_value(50), 1),
                "storage": round(metric_value(40), 1),
                "io": round(metric_value(35), 1),
                "network": round(metric_value(30), 1),
                "latency": round(metric_value(20), 1),
                "error_rate": round(metric_value(5), 2),
                "incident_count": random.randint(0, 15),
                "risk_score": round(metric_value(35), 1),
            },
            "health": "healthy",
        })
    return racks, servers


def generate_infrastructure(racks, servers):
    nodes = list(racks) + list(servers)

    for net_id in NETWORKS:
        nodes.append({
            "id": net_id,
            "name": net_id.replace("-", " ").title(),
            "type": "network",
            "layer": "network",
            "metrics": {
                "cpu": round(metric_value(25), 1),
                "memory": round(metric_value(20), 1),
                "storage": round(metric_value(10), 1),
                "io": round(metric_value(45), 1),
                "network": round(metric_value(55), 1),
                "latency": round(metric_value(15), 1),
                "error_rate": round(metric_value(3), 2),
                "incident_count": random.randint(0, 5),
                "risk_score": round(metric_value(25), 1),
            },
            "health": "healthy",
        })

    for tor in TOR_SWITCHES:
        nodes.append({
            "id": tor,
            "name": tor.replace("-", " ").title(),
            "type": "tor_switch",
            "layer": "network",
            "metrics": {
                "cpu": round(metric_value(30), 1),
                "memory": round(metric_value(25), 1),
                "storage": round(metric_value(5), 1),
                "io": round(metric_value(50), 1),
                "network": round(metric_value(60), 1),
                "latency": round(metric_value(10), 1),
                "error_rate": round(metric_value(2), 2),
                "incident_count": random.randint(0, 3),
                "risk_score": round(metric_value(20), 1),
            },
            "health": "healthy",
        })

    for cluster in K8S_CLUSTERS:
        pods = []
        for i in range(1, 11):
            pod_id = f"{cluster}-pod-{i:02d}"
            pods.append(pod_id)
            nodes.append({
                "id": pod_id,
                "name": f"{cluster} Pod {i:02d}",
                "type": "pod",
                "layer": "container",
                "cluster_id": cluster,
                "server_id": random.choice(servers)["id"],
                "metrics": {
                    "cpu": round(metric_value(40), 1),
                    "memory": round(metric_value(45), 1),
                    "storage": round(metric_value(20), 1),
                    "io": round(metric_value(30), 1),
                    "network": round(metric_value(35), 1),
                    "latency": round(metric_value(25), 1),
                    "error_rate": round(metric_value(8), 2),
                    "incident_count": random.randint(0, 4),
                    "risk_score": round(metric_value(30), 1),
                },
                "health": health_status(metric_value(40)),
            })
        nodes.append({
            "id": cluster,
            "name": cluster.replace("-", " ").title(),
            "type": "kubernetes_cluster",
            "layer": "platform",
            "pods": pods,
            "metrics": {
                "cpu": round(metric_value(50), 1),
                "memory": round(metric_value(55), 1),
                "storage": round(metric_value(35), 1),
                "io": round(metric_value(40), 1),
                "network": round(metric_value(45), 1),
                "latency": round(metric_value(20), 1),
                "error_rate": round(metric_value(6), 2),
                "incident_count": random.randint(0, 6),
                "risk_score": round(metric_value(35), 1),
            },
            "health": "healthy",
        })

    for db in DATABASES:
        nodes.append({
            "id": db,
            "name": db.replace("-", " ").title(),
            "type": "database",
            "layer": "platform",
            "metrics": {
                "cpu": round(metric_value(55), 1),
                "memory": round(metric_value(60), 1),
                "storage": round(metric_value(70), 1),
                "io": round(metric_value(65), 1),
                "network": round(metric_value(40), 1),
                "latency": round(metric_value(30), 1),
                "error_rate": round(metric_value(4), 2),
                "incident_count": random.randint(0, 7),
                "risk_score": round(metric_value(40), 1),
            },
            "health": health_status(metric_value(50)),
        })

    for queue in QUEUES:
        nodes.append({
            "id": queue,
            "name": queue.replace("-", " ").title(),
            "type": "message_queue",
            "layer": "platform",
            "metrics": {
                "cpu": round(metric_value(35), 1),
                "memory": round(metric_value(40), 1),
                "storage": round(metric_value(25), 1),
                "io": round(metric_value(55), 1),
                "network": round(metric_value(50), 1),
                "latency": round(metric_value(18), 1),
                "error_rate": round(metric_value(3), 2),
                "incident_count": random.randint(0, 4),
                "risk_score": round(metric_value(28), 1),
            },
            "health": "healthy",
        })

    for lb in LOAD_BALANCERS:
        nodes.append({
            "id": lb,
            "name": lb.replace("-", " ").title(),
            "type": "load_balancer",
            "layer": "platform",
            "metrics": {
                "cpu": round(metric_value(30), 1),
                "memory": round(metric_value(25), 1),
                "storage": round(metric_value(10), 1),
                "io": round(metric_value(40), 1),
                "network": round(metric_value(70), 1),
                "latency": round(metric_value(12), 1),
                "error_rate": round(metric_value(2), 2),
                "incident_count": random.randint(0, 3),
                "risk_score": round(metric_value(22), 1),
            },
            "health": "healthy",
        })

    for storage in STORAGE:
        nodes.append({
            "id": storage,
            "name": storage.replace("-", " ").title(),
            "type": "storage",
            "layer": "platform",
            "metrics": {
                "cpu": round(metric_value(20), 1),
                "memory": round(metric_value(30), 1),
                "storage": round(metric_value(75), 1),
                "io": round(metric_value(60), 1),
                "network": round(metric_value(35), 1),
                "latency": round(metric_value(22), 1),
                "error_rate": round(metric_value(1), 2),
                "incident_count": random.randint(0, 2),
                "risk_score": round(metric_value(18), 1),
            },
            "health": "healthy",
        })

    return {"nodes": nodes, "generated_at": datetime.utcnow().isoformat() + "Z"}


def generate_services():
    services = []
    for bs in BUSINESS_SERVICES:
        bs_metrics = {
            "cpu": round(metric_value(35), 1),
            "memory": round(metric_value(40), 1),
            "storage": round(metric_value(25), 1),
            "io": round(metric_value(20), 1),
            "network": round(metric_value(30), 1),
            "latency": round(metric_value(18), 1),
            "error_rate": round(metric_value(5), 2),
            "incident_count": random.randint(0, 10),
            "risk_score": round(metric_value(25), 1),
        }
        services.append({
            "id": bs,
            "name": bs.replace("-", " ").title(),
            "type": "business_service",
            "layer": "business_service",
            "applications": APPLICATIONS[bs],
            "metrics": bs_metrics,
            "health": health_status(max(bs_metrics["error_rate"] * 5, bs_metrics["latency"])),
            "sla": {
                "availability_target": 99.95,
                "current_availability": round(random.uniform(99.5, 99.99), 3),
                "latency_p99_target_ms": 200,
                "current_latency_p99_ms": round(random.uniform(80, 250), 1),
            },
        })

    for bs, apps in APPLICATIONS.items():
        for app in apps:
            app_metrics = {
                "cpu": round(metric_value(40), 1),
                "memory": round(metric_value(45), 1),
                "storage": round(metric_value(30), 1),
                "io": round(metric_value(25), 1),
                "network": round(metric_value(35), 1),
                "latency": round(metric_value(22), 1),
                "error_rate": round(metric_value(6), 2),
                "incident_count": random.randint(0, 6),
                "risk_score": round(metric_value(30), 1),
            }
            services.append({
                "id": app,
                "name": app.replace("-", " ").title(),
                "type": "application",
                "layer": "application",
                "business_service_id": bs,
                "microservices": random.sample(MICROSERVICES, k=min(3, len(MICROSERVICES))),
                "metrics": app_metrics,
                "health": health_status(app_metrics["error_rate"] * 5),
            })

    for ms in MICROSERVICES:
        ms_metrics = {
            "cpu": round(metric_value(45), 1),
            "memory": round(metric_value(50), 1),
            "storage": round(metric_value(20), 1),
            "io": round(metric_value(30), 1),
            "network": round(metric_value(40), 1),
            "latency": round(metric_value(28), 1),
            "error_rate": round(metric_value(7), 2),
            "incident_count": random.randint(0, 5),
            "risk_score": round(metric_value(32), 1),
        }
        services.append({
            "id": ms,
            "name": ms.replace("-", " ").title(),
            "type": "microservice",
            "layer": "microservice",
            "cluster_id": random.choice(K8S_CLUSTERS),
            "metrics": ms_metrics,
            "health": health_status(ms_metrics["error_rate"] * 5),
        })

    return {"services": services, "generated_at": datetime.utcnow().isoformat() + "Z"}


def generate_dependency_graph():
    edges = [
        {"source": "api-gateway-services", "target": "gateway-app", "relationship": "contains", "type": "hierarchy"},
        {"source": "payment-authorization", "target": "auth-app", "relationship": "contains", "type": "hierarchy"},
        {"source": "settlement-processing", "target": "settlement-app", "relationship": "contains", "type": "hierarchy"},
        {"source": "fraud-detection", "target": "fraud-app", "relationship": "contains", "type": "hierarchy"},
        {"source": "merchant-services", "target": "merchant-portal-app", "relationship": "contains", "type": "hierarchy"},
        {"source": "partner-integrations", "target": "partner-api-app", "relationship": "contains", "type": "hierarchy"},
        {"source": "gateway-app", "target": "api-gateway", "relationship": "contains", "type": "hierarchy"},
        {"source": "auth-app", "target": "auth-service", "relationship": "contains", "type": "hierarchy"},
        {"source": "auth-app", "target": "token-service", "relationship": "contains", "type": "hierarchy"},
        {"source": "settlement-app", "target": "settlement-service", "relationship": "contains", "type": "hierarchy"},
        {"source": "fraud-app", "target": "fraud-service", "relationship": "contains", "type": "hierarchy"},
        {"source": "fraud-app", "target": "ml-scoring-service", "relationship": "contains", "type": "hierarchy"},
        {"source": "api-gateway", "target": "auth-service", "relationship": "calls", "type": "dependency"},
        {"source": "api-gateway", "target": "settlement-service", "relationship": "calls", "type": "dependency"},
        {"source": "api-gateway", "target": "fraud-service", "relationship": "calls", "type": "dependency"},
        {"source": "auth-service", "target": "postgres-cluster", "relationship": "queries", "type": "dependency"},
        {"source": "auth-service", "target": "redis-cluster", "relationship": "uses", "type": "dependency"},
        {"source": "auth-service", "target": "identity-service", "relationship": "calls", "type": "dependency"},
        {"source": "settlement-service", "target": "postgres-cluster", "relationship": "queries", "type": "dependency"},
        {"source": "settlement-service", "target": "kafka-cluster", "relationship": "publishes", "type": "dependency"},
        {"source": "fraud-service", "target": "cassandra-cluster", "relationship": "queries", "type": "dependency"},
        {"source": "fraud-service", "target": "ml-scoring-service", "relationship": "calls", "type": "dependency"},
        {"source": "merchant-api", "target": "postgres-cluster", "relationship": "queries", "type": "dependency"},
        {"source": "partner-api", "target": "webhook-handler", "relationship": "calls", "type": "dependency"},
        {"source": "external-lb", "target": "api-gateway", "relationship": "routes", "type": "dependency"},
        {"source": "internal-lb", "target": "auth-service", "relationship": "routes", "type": "dependency"},
        {"source": "k8s-cluster-a", "target": "k8s-cluster-a-pod-01", "relationship": "hosts", "type": "hierarchy"},
        {"source": "auth-service", "target": "k8s-cluster-a-pod-01", "relationship": "runs_on", "type": "hierarchy"},
        {"source": "k8s-cluster-a-pod-01", "target": "server-r01-s01", "relationship": "runs_on", "type": "hierarchy"},
        {"source": "server-r01-s01", "target": "rack-01", "relationship": "located_in", "type": "hierarchy"},
        {"source": "rack-01", "target": "tor-switch-1", "relationship": "connected_to", "type": "hierarchy"},
        {"source": "tor-switch-1", "target": "network-spine-1", "relationship": "connected_to", "type": "hierarchy"},
        {"source": "notification-service", "target": "rabbitmq-cluster", "relationship": "uses", "type": "dependency"},
        {"source": "audit-service", "target": "cassandra-cluster", "relationship": "writes", "type": "dependency"},
        {"source": "rate-limiter", "target": "redis-cluster", "relationship": "uses", "type": "dependency"},
        {"source": "settlement-service", "target": "notification-service", "relationship": "calls", "type": "dependency"},
        {"source": "fraud-service", "target": "audit-service", "relationship": "calls", "type": "dependency"},
        {"source": "postgres-cluster", "target": "storage-cluster-1", "relationship": "uses", "type": "dependency"},
        {"source": "cassandra-cluster", "target": "storage-cluster-2", "relationship": "uses", "type": "dependency"},
    ]
    return {"edges": edges, "generated_at": datetime.utcnow().isoformat() + "Z"}


def generate_alerts(count=200):
    alert_types = [
        ("CPU Saturation", "cpu", "critical"),
        ("Memory Pressure", "memory", "warning"),
        ("High Latency", "latency", "warning"),
        ("Error Rate Spike", "error_rate", "critical"),
        ("Network Packet Loss", "network", "critical"),
        ("Queue Buildup", "queue", "warning"),
        ("Disk I/O Saturation", "io", "warning"),
        ("Connection Pool Exhaustion", "connections", "critical"),
    ]
    services = BUSINESS_SERVICES + MICROSERVICES + DATABASES
    alerts = []
    base_time = datetime.utcnow()
    for i in range(count):
        alert_type, metric, severity = random.choice(alert_types)
        triggered = base_time - timedelta(minutes=random.randint(1, 1440))
        alerts.append({
            "id": f"alert-{uuid.uuid4().hex[:8]}",
            "title": alert_type,
            "description": f"{alert_type} detected on {random.choice(services)}",
            "source": random.choice(["datadog", "dynatrace", "prometheus", "splunk"]),
            "severity": severity if random.random() > 0.3 else random.choice(["info", "warning", "critical"]),
            "status": random.choice(["open", "acknowledged", "resolved"]),
            "metric": metric,
            "entity_id": random.choice(services),
            "entity_type": random.choice(["business_service", "microservice", "database", "server"]),
            "value": round(random.uniform(70, 99), 1),
            "threshold": round(random.uniform(60, 90), 1),
            "triggered_at": triggered.isoformat() + "Z",
        })
    return {"alerts": alerts, "generated_at": datetime.utcnow().isoformat() + "Z"}


def generate_metrics():
    now = datetime.utcnow()
    time_series = []
    entities = BUSINESS_SERVICES + MICROSERVICES[:5] + DATABASES
    metric_names = ["cpu", "memory", "latency", "error_rate", "throughput", "network"]
    for entity in entities:
        for metric in metric_names:
            points = []
            base = random.uniform(20, 60)
            for h in range(24):
                ts = now - timedelta(hours=23 - h)
                points.append({
                    "timestamp": ts.isoformat() + "Z",
                    "value": round(max(0, base + random.uniform(-15, 15)), 2),
                })
            time_series.append({
                "entity_id": entity,
                "metric": metric,
                "unit": "%" if metric in ("cpu", "memory", "error_rate", "network") else "ms" if metric == "latency" else "req/s",
                "points": points,
            })
    return {"metrics": time_series, "generated_at": datetime.utcnow().isoformat() + "Z"}


def generate_events(count=150):
    event_types = ["deployment", "scale_event", "config_change", "failover", "restart", "health_check"]
    events = []
    base_time = datetime.utcnow()
    for i in range(count):
        events.append({
            "id": f"event-{uuid.uuid4().hex[:8]}",
            "type": random.choice(event_types),
            "source": random.choice(["kubernetes", "vmware", "aws", "internal"]),
            "entity_id": random.choice(MICROSERVICES + DATABASES),
            "message": f"{random.choice(event_types).replace('_', ' ').title()} on {random.choice(MICROSERVICES)}",
            "severity": random.choice(["info", "warning", "error"]),
            "timestamp": (base_time - timedelta(minutes=random.randint(1, 2880))).isoformat() + "Z",
        })
    return {"events": events, "generated_at": datetime.utcnow().isoformat() + "Z"}


def generate_incidents(count=50):
    root_causes = [
        "DB Index Regression", "Bad Deployment", "Network Congestion",
        "Memory Leak", "Misconfigured Load Balancer", "Certificate Expiry",
        "Connection Pool Exhaustion", "Disk Full", "Cache Invalidation Bug",
    ]
    fixes = ["Rollback", "Restart Service", "Scale Up", "Create Index", "Failover", "Clear Cache", "Update Config"]
    symptoms = ["Latency Increase", "Queue Build Up", "Retry Storm", "Timeout Errors", "Connection Refused"]
    incidents = []
    base_time = datetime.utcnow()
    for i in range(count):
        inc_id = f"INC-{1000 + i}"
        created = base_time - timedelta(days=random.randint(1, 365))
        resolved = created + timedelta(hours=random.randint(1, 48))
        incidents.append({
            "id": inc_id,
            "number": inc_id,
            "short_description": f"Service degradation on {random.choice(MICROSERVICES)}",
            "description": f"Performance degradation detected affecting {random.choice(BUSINESS_SERVICES)}",
            "priority": random.choice(["1 - Critical", "2 - High", "3 - Moderate", "4 - Low"]),
            "state": "Resolved",
            "assignment_group": random.choice(["SRE Team", "Platform Ops", "Database Team", "Network Team"]),
            "assigned_to": f"engineer-{random.randint(1, 20)}@company.com",
            "category": random.choice(["Infrastructure", "Application", "Network", "Database"]),
            "subcategory": random.choice(["Performance", "Availability", "Configuration"]),
            "affected_service": random.choice(BUSINESS_SERVICES),
            "created_at": created.isoformat() + "Z",
            "resolved_at": resolved.isoformat() + "Z",
            "root_cause": random.choice(root_causes),
            "fix": random.choice(fixes),
            "symptoms": random.sample(symptoms, k=random.randint(1, 3)),
            "alerts": random.sample(["CPU Saturation", "High Latency", "Error Rate Spike", "Queue Buildup"], k=2),
        })
    return {"incidents": incidents, "generated_at": datetime.utcnow().isoformat() + "Z"}


def generate_jira_tickets(count=30):
    tickets = []
    base_time = datetime.utcnow()
    for i in range(count):
        tickets.append({
            "id": f"JIRA-{5000 + i}",
            "key": f"OPS-{100 + i}",
            "summary": f"Investigate {random.choice(MICROSERVICES)} performance issue",
            "status": random.choice(["Done", "In Progress", "To Do", "Closed"]),
            "priority": random.choice(["Highest", "High", "Medium", "Low"]),
            "issue_type": random.choice(["Bug", "Incident", "Task"]),
            "assignee": f"engineer-{random.randint(1, 15)}",
            "reporter": f"oncall-{random.randint(1, 5)}",
            "created_at": (base_time - timedelta(days=random.randint(1, 180))).isoformat() + "Z",
            "linked_incident": f"INC-{1000 + random.randint(0, 49)}",
            "labels": random.sample(["sre", "production", "payment", "urgent", "postmortem"], k=2),
        })
    return {"tickets": tickets, "generated_at": datetime.utcnow().isoformat() + "Z"}


def generate_changes():
    deployments = []
    base_time = datetime.utcnow()
    for i in range(40):
        deployments.append({
            "id": f"deploy-{uuid.uuid4().hex[:8]}",
            "service": random.choice(MICROSERVICES),
            "version": f"v{random.randint(1, 5)}.{random.randint(0, 20)}.{random.randint(0, 99)}",
            "environment": random.choice(["production", "staging"]),
            "status": random.choice(["success", "failed", "rolled_back"]),
            "deployed_by": f"ci-pipeline-{random.randint(1, 3)}",
            "deployed_at": (base_time - timedelta(hours=random.randint(1, 720))).isoformat() + "Z",
            "commit": uuid.uuid4().hex[:8],
        })
    changes = []
    for i in range(25):
        changes.append({
            "id": f"change-{uuid.uuid4().hex[:8]}",
            "title": f"{random.choice(['Config update', 'Firewall rule', 'Database migration', 'Certificate renewal'])} for {random.choice(MICROSERVICES)}",
            "type": random.choice(["standard", "normal", "emergency"]),
            "status": random.choice(["completed", "scheduled", "in_progress"]),
            "risk": random.choice(["low", "medium", "high"]),
            "requested_by": f"engineer-{random.randint(1, 10)}",
            "scheduled_at": (base_time - timedelta(hours=random.randint(1, 480))).isoformat() + "Z",
            "affected_services": random.sample(MICROSERVICES, k=random.randint(1, 3)),
        })
    return deployments, changes


def generate_incident_graph(incidents_data):
    nodes = []
    edges = []
    for inc in incidents_data["incidents"]:
        inc_id = inc["id"]
        alert_nodes = []
        symptom_nodes = []
        for alert in inc["alerts"]:
            alert_id = f"{inc_id}-alert-{alert.lower().replace(' ', '-')}"
            nodes.append({"id": alert_id, "type": "alert", "label": alert, "incident_id": inc_id})
            alert_nodes.append(alert_id)
        for symptom in inc["symptoms"]:
            sym_id = f"{inc_id}-symptom-{symptom.lower().replace(' ', '-')}"
            nodes.append({"id": sym_id, "type": "symptom", "label": symptom, "incident_id": inc_id})
            symptom_nodes.append(sym_id)
        rc_id = f"{inc_id}-rc"
        fix_id = f"{inc_id}-fix"
        inc_node_id = f"{inc_id}-incident"
        comp_id = f"{inc_id}-component"
        nodes.extend([
            {"id": inc_node_id, "type": "incident", "label": inc_id, "incident_id": inc_id},
            {"id": rc_id, "type": "root_cause", "label": inc["root_cause"], "incident_id": inc_id},
            {"id": fix_id, "type": "fix", "label": inc["fix"], "incident_id": inc_id},
            {"id": comp_id, "type": "impacted_component", "label": inc["affected_service"], "incident_id": inc_id},
        ])
        for a in alert_nodes:
            for s in symptom_nodes:
                edges.append({"source": a, "target": s, "relationship": "causes"})
        for s in symptom_nodes:
            edges.append({"source": s, "target": inc_node_id, "relationship": "triggers"})
        edges.extend([
            {"source": inc_node_id, "target": rc_id, "relationship": "caused_by"},
            {"source": rc_id, "target": fix_id, "relationship": "resolved_by"},
            {"source": fix_id, "target": comp_id, "relationship": "restored"},
        ])
    return {"nodes": nodes, "edges": edges, "generated_at": datetime.utcnow().isoformat() + "Z"}


def generate_monitoring_dashboard():
    return {
        "executive": {
            "service_availability": round(random.uniform(99.5, 99.99), 3),
            "transaction_success_rate": round(random.uniform(97, 99.9), 2),
            "sla_compliance": round(random.uniform(95, 100), 1),
            "revenue_impact_usd": round(random.uniform(0, 50000), 2),
            "customer_impact_count": random.randint(0, 500),
            "services_at_risk": random.randint(0, 3),
            "active_incidents": random.randint(0, 5),
        },
        "service": {
            "services": [
                {
                    "id": bs,
                    "name": bs.replace("-", " ").title(),
                    "health": random.choice(["healthy", "warning", "critical"]),
                    "latency_p99_ms": round(random.uniform(50, 300), 1),
                    "error_rate": round(random.uniform(0.01, 2.5), 3),
                    "throughput_rps": round(random.uniform(100, 5000), 0),
                    "transaction_volume": random.randint(10000, 500000),
                    "availability": round(random.uniform(99, 99.99), 3),
                }
                for bs in BUSINESS_SERVICES
            ]
        },
        "technical": {
            "containers": [
                {"id": f"k8s-cluster-a-pod-{i:02d}", "status": random.choice(["running", "running", "running", "warning"]), "cpu": round(random.uniform(20, 80), 1), "memory": round(random.uniform(25, 85), 1)}
                for i in range(1, 11)
            ],
            "apis": [
                {"name": f"/api/v1/{ms.replace('-service', '')}", "latency_ms": round(random.uniform(10, 200), 1), "error_rate": round(random.uniform(0, 3), 2), "requests_per_sec": round(random.uniform(50, 2000), 0)}
                for ms in MICROSERVICES[:8]
            ],
            "databases": [
                {"id": db, "connections": random.randint(50, 500), "query_latency_ms": round(random.uniform(1, 50), 1), "replication_lag_ms": round(random.uniform(0, 100), 1)}
                for db in DATABASES
            ],
            "queues": [
                {"id": q, "depth": random.randint(0, 10000), "consumer_lag": random.randint(0, 5000), "throughput_msg_s": round(random.uniform(100, 5000), 0)}
                for q in QUEUES
            ],
            "jvm": [
                {"service": ms, "heap_used_pct": round(random.uniform(40, 90), 1), "thread_count": random.randint(50, 500), "gc_pause_ms": round(random.uniform(5, 200), 1)}
                for ms in MICROSERVICES[:6]
            ],
        },
        "infrastructure": {
            "summary": {
                "avg_cpu": round(random.uniform(35, 65), 1),
                "avg_memory": round(random.uniform(40, 70), 1),
                "avg_storage": round(random.uniform(45, 75), 1),
                "avg_network": round(random.uniform(25, 55), 1),
                "avg_io": round(random.uniform(30, 60), 1),
            },
            "servers": [
                {"id": f"server-r{(i // 10) + 1:02d}-s{(i % 10) + 1:02d}", "cpu": round(random.uniform(15, 90), 1), "memory": round(random.uniform(20, 85), 1), "storage": round(random.uniform(30, 80), 1), "network": round(random.uniform(10, 70), 1), "io": round(random.uniform(10, 75), 1)}
                for i in range(20)
            ],
        },
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Written {path}")


def main():
    print("Generating synthetic data...")
    racks, servers = generate_racks_and_servers()
    infrastructure = generate_infrastructure(racks, servers)
    services = generate_services()
    dependency_graph = generate_dependency_graph()
    alerts = generate_alerts(200)
    metrics = generate_metrics()
    events = generate_events(150)
    incidents = generate_rich_incidents(500)
    jira = generate_jira_tickets(30)
    deployments, changes = generate_changes()
    knowledge_graph = build_knowledge_graph(incidents["incidents"])
    incident_graph = build_per_incident_graph(incidents["incidents"])
    monitoring = generate_monitoring_dashboard()

    write_json(DATA_DIR / "dependencies" / "infrastructure.json", infrastructure)
    write_json(DATA_DIR / "dependencies" / "services.json", services)
    write_json(DATA_DIR / "dependencies" / "dependency_graph.json", dependency_graph)
    write_json(DATA_DIR / "monitoring" / "alerts.json", alerts)
    write_json(DATA_DIR / "monitoring" / "metrics.json", metrics)
    write_json(DATA_DIR / "monitoring" / "events.json", events)
    write_json(DATA_DIR / "monitoring" / "dashboard.json", monitoring)
    write_json(DATA_DIR / "incidents" / "service_now_incidents.json", incidents)
    write_json(DATA_DIR / "incidents" / "jira_tickets.json", jira)
    write_json(DATA_DIR / "changes" / "deployments.json", {"deployments": deployments, "generated_at": datetime.utcnow().isoformat() + "Z"})
    write_json(DATA_DIR / "changes" / "change_records.json", {"changes": changes, "generated_at": datetime.utcnow().isoformat() + "Z"})
    write_json(DATA_DIR / "rca" / "knowledge_graph.json", knowledge_graph)
    write_json(DATA_DIR / "rca" / "incident_graph.json", incident_graph)
    print("Done!")


if __name__ == "__main__":
    main()
