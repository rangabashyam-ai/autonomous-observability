"""
OpenTelemetry Topology Builder

Parses OTLP trace spans to extract service dependency relationships.

OTel is the industry standard (CNCF) for distributed tracing. It works
across ALL clouds and infrastructure. Spans contain:
  - serviceName (from resource.service.name attribute)
  - parentSpanId → child relationship = caller → callee
  - span attributes: http.url, db.name, net.peer.name, messaging.system, etc.

This gives us the APPLICATION-level call graph:
  "frontend CALLS auth-service"
  "auth-service READS users-postgres"
  "order-service PUBLISHES order-events (Kafka)"

Combined with our structural AWS Tier 2 (ALB → ECS → EC2),
we get the FULL picture from internet → infra → app → database.

OTel Semantic Conventions used:
  https://opentelemetry.io/docs/specs/semconv/
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data"
_OTEL_SPANS_FILE = _DATA_DIR / "integrations" / "otel_spans.json"
_OTEL_TOPOLOGY_FILE = _DATA_DIR / "integrations" / "otel_topology.json"


# ---------------------------------------------------------------------------
# OTel Semantic Convention attribute keys
# (https://opentelemetry.io/docs/specs/semconv/)
# ---------------------------------------------------------------------------

# Service identity
ATTR_SERVICE_NAME      = "service.name"
ATTR_SERVICE_NAMESPACE = "service.namespace"
ATTR_SERVICE_VERSION   = "service.version"
ATTR_DEPLOYMENT_ENV    = "deployment.environment"

# Cloud
ATTR_CLOUD_PROVIDER    = "cloud.provider"
ATTR_CLOUD_REGION      = "cloud.region"
ATTR_CLOUD_ACCOUNT_ID  = "cloud.account.id"

# HTTP calls
ATTR_HTTP_URL          = "http.url"
ATTR_HTTP_METHOD       = "http.method"
ATTR_HTTP_STATUS_CODE  = "http.status_code"
ATTR_HTTP_TARGET       = "url.path"
ATTR_NET_PEER_NAME     = "net.peer.name"
ATTR_NET_PEER_PORT     = "net.peer.port"

# Database
ATTR_DB_SYSTEM         = "db.system"        # postgresql, mysql, redis, mongodb...
ATTR_DB_NAME           = "db.name"
ATTR_DB_OPERATION      = "db.operation"
ATTR_DB_SERVER_ADDRESS = "server.address"

# Messaging (Kafka, SQS, RabbitMQ)
ATTR_MESSAGING_SYSTEM  = "messaging.system"  # kafka, aws_sqs, rabbitmq...
ATTR_MESSAGING_DEST    = "messaging.destination.name"
ATTR_MESSAGING_OP      = "messaging.operation"

# RPC / gRPC
ATTR_RPC_SYSTEM        = "rpc.system"
ATTR_RPC_SERVICE       = "rpc.service"

# AWS-specific
ATTR_AWS_SERVICE       = "aws.service"
ATTR_AWS_QUEUE_URL     = "aws.sqs.queue.url"
ATTR_AWS_STREAM_NAME   = "aws.kinesis.stream.name"
ATTR_AWS_TABLE_NAME    = "aws.dynamodb.table_names"


# ---------------------------------------------------------------------------
# Span ingestion — accept OTLP/HTTP JSON format
# ---------------------------------------------------------------------------

def ingest_otlp_json(otlp_payload: dict) -> int:
    """
    Accept an OTLP/HTTP JSON export payload and append spans to local store.

    OTLP JSON format:
    {
      "resourceSpans": [{
        "resource": { "attributes": [{"key": "service.name", "value": {"stringValue": "frontend"}}] },
        "scopeSpans": [{
          "spans": [{
            "traceId": "...", "spanId": "...", "parentSpanId": "...",
            "name": "GET /api/users",
            "kind": 2,
            "startTimeUnixNano": "...",
            "attributes": [...]
          }]
        }]
      }]
    }
    """
    spans_added = 0
    existing = _load_spans()

    for rs in otlp_payload.get("resourceSpans", []):
        # Extract service name from resource attributes
        resource_attrs = _parse_attrs(rs.get("resource", {}).get("attributes", []))
        service_name = resource_attrs.get(ATTR_SERVICE_NAME, "unknown-service")
        cloud_provider = resource_attrs.get(ATTR_CLOUD_PROVIDER, "")
        cloud_region = resource_attrs.get(ATTR_CLOUD_REGION, "")
        deployment_env = resource_attrs.get(ATTR_DEPLOYMENT_ENV, "")

        for ss in rs.get("scopeSpans", []):
            for span in ss.get("spans", []):
                span_id = span.get("spanId", "")
                if span_id in existing.get("span_ids", set()):
                    continue  # already stored

                span_attrs = _parse_attrs(span.get("attributes", []))

                normalized = {
                    "trace_id": span.get("traceId", ""),
                    "span_id": span_id,
                    "parent_span_id": span.get("parentSpanId", ""),
                    "service_name": service_name,
                    "operation": span.get("name", ""),
                    "kind": span.get("kind", 0),  # 1=internal, 2=server, 3=client, 4=producer, 5=consumer
                    "start_time": span.get("startTimeUnixNano", ""),
                    "duration_ns": int(span.get("endTimeUnixNano", 0)) - int(span.get("startTimeUnixNano", 0)),
                    "status_code": span.get("status", {}).get("code", 0),  # 0=unset,1=ok,2=error
                    "cloud_provider": cloud_provider,
                    "cloud_region": cloud_region,
                    "deployment_env": deployment_env,
                    # Extracted peer info
                    "peer_service": span_attrs.get("peer.service", ""),
                    "http_url": span_attrs.get(ATTR_HTTP_URL, ""),
                    "net_peer_name": span_attrs.get(ATTR_NET_PEER_NAME, ""),
                    "db_system": span_attrs.get(ATTR_DB_SYSTEM, ""),
                    "db_name": span_attrs.get(ATTR_DB_NAME, ""),
                    "messaging_system": span_attrs.get(ATTR_MESSAGING_SYSTEM, ""),
                    "messaging_dest": span_attrs.get(ATTR_MESSAGING_DEST, ""),
                    "rpc_service": span_attrs.get(ATTR_RPC_SERVICE, ""),
                    "aws_service": span_attrs.get(ATTR_AWS_SERVICE, ""),
                    "raw_attrs": span_attrs,
                    "ingested_at": datetime.now(timezone.utc).isoformat(),
                }

                existing.setdefault("spans", []).append(normalized)
                existing.setdefault("span_ids", set()).add(span_id)
                spans_added += 1

    # Keep only last 50,000 spans
    if len(existing.get("spans", [])) > 50_000:
        existing["spans"] = existing["spans"][-50_000:]

    _save_spans(existing)
    logger.info(f"[OTel] Ingested {spans_added} new spans. Total: {len(existing.get('spans', []))}")
    return spans_added


def _parse_attrs(attr_list: list[dict]) -> dict[str, Any]:
    """Parse OTLP attribute list [{"key": "k", "value": {"stringValue": "v"}}] → dict."""
    result: dict[str, Any] = {}
    for item in attr_list:
        key = item.get("key", "")
        val = item.get("value", {})
        # OTel value types: stringValue, intValue, doubleValue, boolValue, arrayValue
        if "stringValue" in val:
            result[key] = val["stringValue"]
        elif "intValue" in val:
            result[key] = val["intValue"]
        elif "doubleValue" in val:
            result[key] = val["doubleValue"]
        elif "boolValue" in val:
            result[key] = val["boolValue"]
        elif "arrayValue" in val:
            result[key] = [_parse_attrs([{"key": "", "value": v}]).get("", "") for v in val["arrayValue"].get("values", [])]
    return result


def _load_spans() -> dict:
    if not _OTEL_SPANS_FILE.exists():
        return {"spans": [], "span_ids": set()}
    try:
        with open(_OTEL_SPANS_FILE) as f:
            data = json.load(f)
        data["span_ids"] = set(data.get("span_ids", []))
        return data
    except Exception:
        return {"spans": [], "span_ids": set()}


def _save_spans(data: dict) -> None:
    _OTEL_SPANS_FILE.parent.mkdir(parents=True, exist_ok=True)
    save_data = {**data, "span_ids": list(data.get("span_ids", set()))}
    with open(_OTEL_SPANS_FILE, "w") as f:
        json.dump(save_data, f)


# ---------------------------------------------------------------------------
# Topology derivation from stored spans
# ---------------------------------------------------------------------------

def build_otel_topology() -> list[dict]:
    """
    Derive service dependency graph from stored OTel spans.

    Strategy:
    1. Parent-Child trace graph:
       span.parentSpanId → find parent span → parent.serviceName CALLS child.serviceName

    2. Semantic attribute extraction:
       CLIENT span with db.system → this service READS that database
       CLIENT span with messaging.system → this service PUBLISHES to that queue
       CLIENT span with http.url → this service CALLS that HTTP endpoint
       CLIENT span with rpc.service → this service CALLS that gRPC service

    Returns list of edge dicts compatible with topology_builder.py format.
    """
    stored = _load_spans()
    spans = stored.get("spans", [])

    if not spans:
        logger.info("[OTel] No spans stored yet. Send traces via /api/otel/v1/traces")
        return []

    edges: list[dict] = []
    edge_set: set[tuple] = set()

    def add_edge(src: str, tgt: str, rel: str, src_type: str, tgt_type: str, via: str = "") -> None:
        if src and tgt and src != tgt:
            key = (src, tgt, rel)
            if key not in edge_set:
                edge_set.add(key)
                edges.append({
                    "source": src,
                    "source_type": src_type,
                    "target": tgt,
                    "target_type": tgt_type,
                    "relationship": rel,
                    "tier": 1,
                    "confidence": "high",
                    "source_standard": "opentelemetry",
                    "via": via,
                })

    # Build span lookup: span_id → span
    span_by_id: dict[str, dict] = {s["span_id"]: s for s in spans}

    for span in spans:
        svc = span.get("service_name", "")
        kind = span.get("kind", 0)  # 3=CLIENT means this span is making a call

        # --- Strategy 1: Parent-child trace relationship ---
        parent_id = span.get("parent_span_id", "")
        if parent_id and parent_id in span_by_id:
            parent_svc = span_by_id[parent_id].get("service_name", "")
            if parent_svc and parent_svc != svc:
                add_edge(parent_svc, svc, "CALLS", "service", "service", "trace_parent_child")

        # --- Strategy 2: Semantic convention extraction ---
        if kind == 3:  # CLIENT span — this service is calling something

            # HTTP calls → extract target service from URL or peer.service
            peer_service = span.get("peer_service", "")
            http_url = span.get("http_url", "")
            net_peer = span.get("net_peer_name", "")

            if peer_service:
                add_edge(svc, peer_service, "CALLS", "service", "service", "peer.service")
            elif http_url:
                # Extract hostname from URL
                try:
                    from urllib.parse import urlparse
                    parsed = urlparse(http_url)
                    host = parsed.netloc.split(":")[0]
                    if host and not host.startswith("127.") and host != "localhost":
                        add_edge(svc, host, "CALLS", "service", "service", "http.url")
                except Exception:
                    pass
            elif net_peer:
                add_edge(svc, net_peer, "CALLS", "service", "service", "net.peer.name")

            # Database calls
            db_system = span.get("db_system", "")
            db_name = span.get("db_name", "")
            if db_system and db_name:
                db_node = f"{db_name}.{db_system}"
                add_edge(svc, db_node, "READS_WRITES", "service", f"database_{db_system}", "db.name")
            elif db_system:
                add_edge(svc, db_system, "READS_WRITES", "service", "database", "db.system")

            # Messaging (Kafka, SQS, RabbitMQ)
            msg_system = span.get("messaging_system", "")
            msg_dest = span.get("messaging_dest", "")
            if msg_system and msg_dest:
                add_edge(svc, msg_dest, "PUBLISHES_TO", "service", f"queue_{msg_system}", "messaging.destination.name")

            # gRPC
            rpc_service = span.get("rpc_service", "")
            if rpc_service:
                add_edge(svc, rpc_service, "CALLS_RPC", "service", "grpc_service", "rpc.service")

            # AWS SDK calls (SQS, DynamoDB, S3, Kinesis etc.)
            aws_service = span.get("aws_service", "")
            raw = span.get("raw_attrs", {})
            if aws_service == "SQS":
                queue_url = raw.get(ATTR_AWS_QUEUE_URL, "")
                queue_name = queue_url.split("/")[-1] if queue_url else "sqs-queue"
                add_edge(svc, queue_name, "SENDS_TO", "service", "sqs_queue", "aws.sqs.queue.url")
            elif aws_service == "Kinesis":
                stream_name = raw.get(ATTR_AWS_STREAM_NAME, "kinesis-stream")
                add_edge(svc, stream_name, "PUBLISHES_TO", "service", "kinesis_stream", "aws.kinesis.stream.name")
            elif aws_service == "DynamoDB":
                tables = raw.get(ATTR_AWS_TABLE_NAME, [])
                if isinstance(tables, list):
                    for table in tables:
                        add_edge(svc, table, "READS_WRITES", "service", "dynamodb_table", "aws.dynamodb.table_names")

    logger.info(f"[OTel] Derived {len(edges)} topology edges from {len(spans)} spans")
    return edges


def save_otel_topology(edges: list[dict]) -> None:
    """Persist the derived OTel topology for the scheduler to pick up."""
    _OTEL_TOPOLOGY_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Compute service map (nodes)
    services: set[str] = set()
    for e in edges:
        services.add(e["source"])
        services.add(e["target"])

    with open(_OTEL_TOPOLOGY_FILE, "w") as f:
        json.dump({
            "edges": edges,
            "services": list(services),
            "total_edges": len(edges),
            "total_services": len(services),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, f, indent=2)

    logger.info(f"[OTel] Topology saved: {len(edges)} edges, {len(services)} services")
    
    # Merge into global graphs for Dependency Map and RCA analysis
    merge_otel_to_global_graphs(edges)


def merge_otel_to_global_graphs(edges: list[dict]) -> None:
    """Merge OTel derived topology into global dependency_graph.json and knowledge_graph.json."""
    from app.integrations.normalization.topology import TopologyEdge
    from app.integrations.graph_builder import update_dependency_graph, update_knowledge_graph

    otel_topo_edges = []
    services: set[tuple[str, str]] = set()

    for e in edges:
        source = e["source"]
        target = e["target"]
        source_type = e.get("source_type", "service")
        target_type = e.get("target_type", "service")
        rel = e.get("relationship", "DEPENDS_ON")

        otel_topo_edges.append(TopologyEdge(
            source=source,
            target=target,
            relationship=rel,
            provider="opentelemetry",
            source_type=source_type,
            target_type=target_type
        ))
        services.add((source, source_type))
        services.add((target, target_type))

    # Update global dependency graph
    try:
        update_dependency_graph(otel_topo_edges)
    except Exception as exc:
        logger.error(f"[OTel] Failed to merge into global dependency graph: {exc}")

    # Update global knowledge graph
    try:
        virtual_resources = []
        for name, ntype in services:
            virtual_resources.append({
                "id": name,
                "name": name,
                "provider": "opentelemetry",
                "resource_type": ntype,
                "health": "healthy",
                "metrics": {},
            })
        update_knowledge_graph(virtual_resources, otel_topo_edges, [])
    except Exception as exc:
        logger.error(f"[OTel] Failed to merge into global knowledge graph: {exc}")


def get_otel_topology() -> dict:
    """Load the latest OTel topology (for API endpoints)."""
    if not _OTEL_TOPOLOGY_FILE.exists():
        return {"edges": [], "services": [], "total_edges": 0, "total_services": 0, "updated_at": ""}
    try:
        with open(_OTEL_TOPOLOGY_FILE) as f:
            return json.load(f)
    except Exception:
        return {"edges": [], "services": [], "total_edges": 0, "total_services": 0, "updated_at": ""}
