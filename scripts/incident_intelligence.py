"""Incident pattern templates and knowledge graph builder."""

from __future__ import annotations

import json
import random
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ALERTS = [
    "CPU Saturation", "API Error Spike", "Packet Loss", "Disk I/O Saturation",
    "Memory Pressure", "Connection Pool Exhaustion", "Queue Buildup Alert",
    "Certificate Expiry Warning", "Network Latency Alert", "Pod Crash Loop",
]

SYMPTOMS = [
    "Latency Increase", "Retry Storm", "Queue Buildup", "Timeout Increase",
    "Connection Refused", "Throughput Drop", "Error Rate Spike", "Cache Miss Storm",
]

ROOT_CAUSES = [
    "DB Index Regression", "Bad Deployment", "Network Congestion",
    "Memory Leak", "Misconfigured Load Balancer", "Certificate Expiry",
    "Connection Pool Exhaustion", "Disk Full", "Cache Invalidation Bug",
    "Kafka Consumer Lag", "DNS Resolution Failure", "Thread Pool Exhaustion",
]

FIXES = [
    "Rollback deployment", "Add database index", "Restart service",
    "Scale pods", "Update load balancer config", "Clear cache",
    "Failover to secondary", "Increase connection pool", "Renew certificate",
    "Purge queue backlog", "Update DNS records", "Increase thread pool",
]

BUSINESS_SERVICES = [
    {"id": "payment-authorization", "name": "Payment Authorization"},
    {"id": "settlement-processing", "name": "Settlement Processing"},
    {"id": "fraud-detection", "name": "Fraud Detection"},
    {"id": "merchant-services", "name": "Merchant Services"},
    {"id": "api-gateway-services", "name": "API Gateway Services"},
    {"id": "partner-integrations", "name": "Partner Integrations"},
]

COMPONENTS = [
    "auth-service", "api-gateway", "settlement-service", "fraud-service",
    "postgres-cluster", "redis-cluster", "cassandra-cluster", "kafka-cluster",
    "external-lb", "internal-lb", "identity-service", "notification-service",
    "merchant-api", "partner-api", "k8s-cluster-a", "k8s-cluster-b",
]

REGIONS = ["us-east", "us-west", "eu-central", "ap-southeast"]
ENVIRONMENTS = ["production", "staging"]
TEAMS = ["SRE Team", "Platform Ops", "Database Team", "Network Team", "Payment Ops"]
SEVERITIES = ["P1", "P2", "P3", "P4"]

# Canonical patterns linking alerts -> symptoms -> root cause -> fix
PATTERNS = [
    {
        "alerts": ["CPU Saturation", "API Error Spike"],
        "symptoms": ["Latency Increase", "Retry Storm"],
        "root_cause": "DB Index Regression",
        "fix": "Add database index",
        "components": ["auth-service", "postgres-cluster", "api-gateway"],
        "services": ["payment-authorization"],
    },
    {
        "alerts": ["API Error Spike", "Pod Crash Loop"],
        "symptoms": ["Error Rate Spike", "Throughput Drop"],
        "root_cause": "Bad Deployment",
        "fix": "Rollback deployment",
        "components": ["settlement-service", "kafka-cluster"],
        "services": ["settlement-processing"],
    },
    {
        "alerts": ["Packet Loss", "Network Latency Alert"],
        "symptoms": ["Timeout Increase", "Connection Refused"],
        "root_cause": "Network Congestion",
        "fix": "Update load balancer config",
        "components": ["external-lb", "api-gateway", "network-spine-1"],
        "services": ["api-gateway-services"],
    },
    {
        "alerts": ["Memory Pressure", "CPU Saturation"],
        "symptoms": ["Latency Increase", "Queue Buildup"],
        "root_cause": "Memory Leak",
        "fix": "Restart service",
        "components": ["fraud-service", "ml-scoring-service", "k8s-cluster-a"],
        "services": ["fraud-detection"],
    },
    {
        "alerts": ["Connection Pool Exhaustion", "API Error Spike"],
        "symptoms": ["Timeout Increase", "Retry Storm"],
        "root_cause": "Connection Pool Exhaustion",
        "fix": "Increase connection pool",
        "components": ["auth-service", "postgres-cluster"],
        "services": ["payment-authorization"],
    },
    {
        "alerts": ["Disk I/O Saturation", "CPU Saturation"],
        "symptoms": ["Latency Increase", "Cache Miss Storm"],
        "root_cause": "Disk Full",
        "fix": "Scale pods",
        "components": ["postgres-cluster", "storage-cluster-1"],
        "services": ["settlement-processing"],
    },
    {
        "alerts": ["Queue Buildup Alert", "CPU Saturation"],
        "symptoms": ["Queue Buildup", "Latency Increase"],
        "root_cause": "Kafka Consumer Lag",
        "fix": "Purge queue backlog",
        "components": ["kafka-cluster", "settlement-service", "notification-service"],
        "services": ["settlement-processing", "payment-authorization"],
    },
    {
        "alerts": ["Certificate Expiry Warning", "API Error Spike"],
        "symptoms": ["Connection Refused", "Error Rate Spike"],
        "root_cause": "Certificate Expiry",
        "fix": "Renew certificate",
        "components": ["external-lb", "api-gateway", "partner-api"],
        "services": ["partner-integrations"],
    },
    {
        "alerts": ["CPU Saturation", "Memory Pressure"],
        "symptoms": ["Latency Increase", "Throughput Drop"],
        "root_cause": "Misconfigured Load Balancer",
        "fix": "Update load balancer config",
        "components": ["internal-lb", "auth-service", "api-gateway"],
        "services": ["payment-authorization"],
    },
    {
        "alerts": ["API Error Spike", "Memory Pressure"],
        "symptoms": ["Cache Miss Storm", "Latency Increase"],
        "root_cause": "Cache Invalidation Bug",
        "fix": "Clear cache",
        "components": ["redis-cluster", "auth-service", "rate-limiter"],
        "services": ["payment-authorization", "api-gateway-services"],
    },
]


def _slug(text: str) -> str:
    return text.lower().replace(" ", "-").replace("/", "-")


def generate_incidents(count: int = 500, seed: int = 42) -> dict:
    random.seed(seed)
    now = datetime.now(timezone.utc)
    incidents = []
    incident_by_pattern: dict[int, list[str]] = defaultdict(list)

    for i in range(count):
        pattern = PATTERNS[i % len(PATTERNS)]
        pattern_idx = i % len(PATTERNS)
        inc_id = f"INC-{1000 + i}"
        start = now - timedelta(days=random.randint(1, 730), hours=random.randint(0, 23))
        duration_hours = random.uniform(0.5, 48)
        end = start + timedelta(hours=duration_hours)
        service = random.choice(pattern["services"])
        svc_meta = next(s for s in BUSINESS_SERVICES if s["id"] == service)

        alerts = list(pattern["alerts"])
        if random.random() > 0.7:
            alerts.append(random.choice(ALERTS))
        symptoms = list(pattern["symptoms"])
        components = list(pattern["components"])
        if random.random() > 0.5:
            components.append(random.choice(COMPONENTS))

        incident = {
            "incident_id": inc_id,
            "id": inc_id,
            "number": inc_id,
            "title": f"{svc_meta['name']} degradation - {pattern['root_cause']}",
            "short_description": f"{svc_meta['name']} performance degradation",
            "severity": random.choices(SEVERITIES, weights=[15, 30, 35, 20])[0],
            "priority": random.choice(["1 - Critical", "2 - High", "3 - Moderate", "4 - Low"]),
            "state": "Resolved",
            "service": svc_meta["name"],
            "service_id": service,
            "affected_service": service,
            "alerts": alerts,
            "symptoms": symptoms,
            "root_cause": pattern["root_cause"],
            "fix": pattern["fix"],
            "impacted_components": components,
            "impacted_services": [svc_meta["name"]] + (
                [BUSINESS_SERVICES[(BUSINESS_SERVICES.index(svc_meta) + 1) % len(BUSINESS_SERVICES)]["name"]]
                if random.random() > 0.6 else []
            ),
            "region": random.choice(REGIONS),
            "environment": random.choices(ENVIRONMENTS, weights=[85, 15])[0],
            "owner_team": random.choice(TEAMS),
            "assignment_group": random.choice(TEAMS),
            "assigned_to": f"engineer-{random.randint(1, 30)}@company.com",
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "created_at": start.isoformat(),
            "resolved_at": end.isoformat(),
            "duration_minutes": round(duration_hours * 60, 1),
            "confidence_training_value": round(random.uniform(0.75, 0.98), 2),
            "resolution_notes": (
                f"Identified {pattern['root_cause']} affecting {svc_meta['name']}. "
                f"Applied fix: {pattern['fix']}. Validated recovery via synthetic monitoring."
            ),
            "change_records": [
                {
                    "id": f"change-{uuid.uuid4().hex[:8]}",
                    "title": random.choice([
                        "Deployment", "Config update", "Database migration",
                        "Certificate renewal", "Firewall rule change",
                    ]),
                    "hours_before_incident": round(random.uniform(0.5, 72), 1),
                    "risk": random.choice(["low", "medium", "high"]),
                }
            ],
            "similar_incidents": [],
            "category": random.choice(["Infrastructure", "Application", "Network", "Database"]),
        }
        incidents.append(incident)
        incident_by_pattern[pattern_idx].append(inc_id)

    # Link similar incidents within same pattern
    for inc in incidents:
        pattern_idx = (int(inc["incident_id"].split("-")[1]) - 1000) % len(PATTERNS)
        peers = [p for p in incident_by_pattern[pattern_idx] if p != inc["incident_id"]]
        inc["similar_incidents"] = random.sample(peers, k=min(3, len(peers)))

    return {"incidents": incidents, "generated_at": now.isoformat(), "count": len(incidents)}


def build_knowledge_graph(incidents: list[dict], changes_data: list[dict] | None = None) -> dict:
    """Build aggregated knowledge graph with relationship metadata."""
    nodes: dict[str, dict] = {}
    edge_agg: dict[tuple, dict] = defaultdict(lambda: {
        "frequency": 0, "incident_refs": [], "environments": set(), "time_proximities": [],
    })

    def ensure_node(nid: str, ntype: str, label: str, **extra):
        if nid not in nodes:
            nodes[nid] = {"id": nid, "type": ntype, "label": label, **extra}

    def add_edge(src: str, tgt: str, rel: str, inc_id: str, env: str, proximity: float = 5.0):
        key = (src, tgt, rel)
        edge_agg[key]["frequency"] += 1
        if inc_id not in edge_agg[key]["incident_refs"]:
            edge_agg[key]["incident_refs"].append(inc_id)
        edge_agg[key]["environments"].add(env)
        edge_agg[key]["time_proximities"].append(proximity)

    for inc in incidents:
        inc_id = inc["incident_id"]
        env = inc["environment"]

        for alert in inc["alerts"]:
            aid = f"alert-{_slug(alert)}"
            ensure_node(aid, "alert", alert)
        for symptom in inc["symptoms"]:
            sid = f"symptom-{_slug(symptom)}"
            ensure_node(sid, "symptom", symptom)

        rc_id = f"rc-{_slug(inc['root_cause'])}"
        fix_id = f"fix-{_slug(inc['fix'])}"
        inc_node = f"incident-{inc_id}"
        ensure_node(inc_node, "incident", inc_id, severity=inc["severity"])
        ensure_node(rc_id, "root_cause", inc["root_cause"])
        ensure_node(fix_id, "fix", inc["fix"])

        ctx_id = f"context-{inc_id}"
        ensure_node(ctx_id, "context", f"{inc['environment']} / {inc['region']}", **{
            "environment": inc["environment"],
            "region": inc["region"],
            "owner_team": inc["owner_team"],
            "start_time": inc["start_time"],
            "end_time": inc["end_time"],
            "duration_minutes": inc["duration_minutes"],
            "severity": inc["severity"],
        })

        for comp in inc["impacted_components"]:
            cid = f"component-{_slug(comp)}"
            ensure_node(cid, "impacted_component", comp)
            add_edge(inc_node, cid, "IMPACTED", inc_id, env)

        for svc in inc.get("impacted_services", [inc["service"]]):
            sid = f"service-{_slug(svc)}"
            ensure_node(sid, "impacted_component", svc, subtype="service")

        for alert in inc["alerts"]:
            aid = f"alert-{_slug(alert)}"
            for symptom in inc["symptoms"]:
                sid = f"symptom-{_slug(symptom)}"
                add_edge(aid, sid, "TRIGGERS", inc_id, env)

        for symptom in inc["symptoms"]:
            sid = f"symptom-{_slug(symptom)}"
            add_edge(sid, inc_node, "ASSOCIATED_WITH", inc_id, env)

        add_edge(inc_node, rc_id, "CAUSED_BY", inc_id, env)
        add_edge(rc_id, fix_id, "RESOLVED_BY", inc_id, env)
        add_edge(inc_node, ctx_id, "HAS_CONTEXT", inc_id, env)

        # Co-occurring alerts
        for i, a1 in enumerate(inc["alerts"]):
            for a2 in inc["alerts"][i + 1:]:
                add_edge(f"alert-{_slug(a1)}", f"alert-{_slug(a2)}", "CO_OCCURS_WITH", inc_id, env, 0)

        # Root cause recurs with symptoms
        for symptom in inc["symptoms"]:
            add_edge(rc_id, f"symptom-{_slug(symptom)}", "RECURS_WITH", inc_id, env)

        # Change precedes incident
        for ch in inc.get("change_records", []):
            ch_id = f"change-{ch['id']}"
            ensure_node(ch_id, "change", ch["title"])
            add_edge(ch_id, inc_node, "PRECEDES", inc_id, env, ch.get("hours_before_incident", 24) * 60)

    # Service depends on component from dependency patterns
    dep_pairs = [
        ("service-payment-authorization", "component-auth-service"),
        ("service-payment-authorization", "component-postgres-cluster"),
        ("service-settlement-processing", "component-settlement-service"),
        ("service-fraud-detection", "component-fraud-service"),
        ("component-auth-service", "component-postgres-cluster"),
        ("component-api-gateway", "component-auth-service"),
    ]
    for src, tgt in dep_pairs:
        add_edge(src, tgt, "DEPENDS_ON", "synthetic", "production", 0)

    edges = []
    for (src, tgt, rel), meta in edge_agg.items():
        freq = meta["frequency"]
        max_freq = max(e["frequency"] for e in edge_agg.values()) or 1
        avg_prox = (
            sum(meta["time_proximities"]) / len(meta["time_proximities"])
            if meta["time_proximities"] else 0
        )
        edges.append({
            "source": src,
            "target": tgt,
            "relationship": rel,
            "frequency": freq,
            "confidence": round(min(0.99, 0.5 + (freq / max_freq) * 0.49), 2),
            "time_proximity_minutes": round(avg_prox, 1),
            "environments": sorted(meta["environments"]),
            "incident_refs": meta["incident_refs"][:10],
        })

    # Build pattern library for early detection
    pattern_library = []
    pattern_counts: dict[str, dict] = defaultdict(lambda: {"count": 0, "services": set(), "eta_minutes": []})
    for inc in incidents:
        key = "|".join(sorted(inc["alerts"][:2])) + "->" + inc["service_id"]
        pattern_counts[key]["count"] += 1
        pattern_counts[key]["services"].add(inc["service_id"])
        pattern_counts[key]["eta_minutes"].append(inc["duration_minutes"] / 10)

    for key, meta in pattern_counts.items():
        if meta["count"] >= 3:
            alerts_part = key.split("->")[0].split("|")
            service = key.split("->")[1]
            avg_eta = sum(meta["eta_minutes"]) / len(meta["eta_minutes"])
            pattern_library.append({
                "id": f"pattern-{_slug(key)[:40]}",
                "alerts": alerts_part,
                "symptoms": [],
                "expected_service": service,
                "occurrence_count": meta["count"],
                "avg_time_to_incident_minutes": round(avg_eta, 1),
                "confidence": round(min(0.95, 0.6 + meta["count"] / 50), 2),
            })

    # Enrich patterns with symptoms from PATTERNS
    for p in pattern_library:
        for pat in PATTERNS:
            if pat["services"][0] == p["expected_service"]:
                p["symptoms"] = pat["symptoms"]
                break

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
        "pattern_library": pattern_library,
        "stats": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "incident_count": len(incidents),
            "alert_types": len([n for n in nodes.values() if n["type"] == "alert"]),
            "root_cause_types": len([n for n in nodes.values() if n["type"] == "root_cause"]),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def build_per_incident_graph(incidents: list[dict]) -> dict:
    """Legacy per-incident graph for explorer detail view."""
    nodes, edges = [], []
    for inc in incidents[:100]:  # cap for file size in detail view sample
        inc_id = inc["incident_id"]
        for alert in inc["alerts"]:
            aid = f"{inc_id}-alert-{_slug(alert)}"
            nodes.append({"id": aid, "type": "alert", "label": alert, "incident_id": inc_id})
        for symptom in inc["symptoms"]:
            sid = f"{inc_id}-symptom-{_slug(symptom)}"
            nodes.append({"id": sid, "type": "symptom", "label": symptom, "incident_id": inc_id})
        inc_node = f"{inc_id}-incident"
        rc_id = f"{inc_id}-rc"
        fix_id = f"{inc_id}-fix"
        nodes.extend([
            {"id": inc_node, "type": "incident", "label": inc_id, "incident_id": inc_id},
            {"id": rc_id, "type": "root_cause", "label": inc["root_cause"], "incident_id": inc_id},
            {"id": fix_id, "type": "fix", "label": inc["fix"], "incident_id": inc_id},
        ])
        for comp in inc["impacted_components"]:
            cid = f"{inc_id}-comp-{_slug(comp)}"
            nodes.append({"id": cid, "type": "impacted_component", "label": comp, "incident_id": inc_id})
            edges.append({"source": inc_node, "target": cid, "relationship": "IMPACTED"})
    return {"nodes": nodes, "edges": edges}
