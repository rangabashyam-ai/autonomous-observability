"""
OpenTelemetry OTLP Receiver Router

Implements the OTLP/HTTP JSON endpoint so any OTel-instrumented app
can push traces directly to this platform without any extra collector.

OTLP/HTTP endpoint: POST /api/otel/v1/traces

Compatible with:
  - OpenTelemetry SDK (all languages: Python, Java, Node.js, Go, .NET)
  - AWS Distro for OpenTelemetry (ADOT)
  - Grafana Alloy / Grafana Agent
  - Any OTEL Collector exporter configured with http/json

Quick setup for an existing OTel-instrumented app:
  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:8000/api/otel
  OTEL_EXPORTER_OTLP_PROTOCOL=http/json
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/otel", tags=["OpenTelemetry"])

_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data"


def _read_json(path: Path) -> dict:
    import json
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# OTLP/HTTP JSON Trace Receiver
# ---------------------------------------------------------------------------

@router.post("/v1/traces")
async def receive_traces(request: Request):
    """
    OTLP/HTTP JSON trace receiver.

    Configure your app's OTel SDK:
      OTEL_EXPORTER_OTLP_ENDPOINT = http://localhost:8000/api/otel
      OTEL_EXPORTER_OTLP_PROTOCOL = http/json

    Or in code (Python example):
      from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
      exporter = OTLPSpanExporter(endpoint="http://localhost:8000/api/otel/v1/traces")
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    try:
        from app.integrations.otel_topology import ingest_otlp_json, build_otel_topology, save_otel_topology
        spans_added = ingest_otlp_json(body)

        # Rebuild topology after every batch
        edges = build_otel_topology()
        save_otel_topology(edges)

        return JSONResponse(
            status_code=200,
            content={
                "partialSuccess": {},
                "spans_accepted": spans_added,
                "topology_edges": len(edges),
            }
        )
    except Exception as exc:
        logger.error(f"[OTel] Trace ingestion failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/v1/metrics")
async def receive_metrics(request: Request):
    """
    OTLP/HTTP JSON metrics receiver (stub — stores raw, future use).
    Accepts OTel SDK metrics pushes without error so SDK doesn't fail.
    """
    try:
        body = await request.json()
        metrics_count = sum(
            len(sm.get("metrics", []))
            for rs in body.get("resourceMetrics", [])
            for sm in rs.get("scopeMetrics", [])
        )
        return JSONResponse(status_code=200, content={"partialSuccess": {}, "metrics_accepted": metrics_count})
    except Exception:
        return JSONResponse(status_code=200, content={"partialSuccess": {}})


@router.post("/v1/logs")
async def receive_logs(request: Request):
    """
    OTLP/HTTP JSON log receiver (stub — accepts without error).
    """
    return JSONResponse(status_code=200, content={"partialSuccess": {}})


# ---------------------------------------------------------------------------
# Topology query endpoints
# ---------------------------------------------------------------------------

@router.get("/topology")
def get_otel_topology():
    """
    Return the service dependency graph derived from received OTel traces.

    This is the APPLICATION-LAYER topology:
      service A → CALLS → service B
      service B → READS_WRITES → postgres-db
      service C → PUBLISHES_TO → order-events (Kafka)

    Complement this with /api/integrations/topology for INFRA-LAYER topology.
    """
    from app.integrations.otel_topology import get_otel_topology as _get
    return _get()


@router.get("/topology/combined")
def get_combined_topology():
    """
    Return OTel app topology + AWS structural infra topology combined.
    This is the FULL picture: internet → ALB → ECS → service → database.
    """
    from app.integrations.otel_topology import get_otel_topology as _get_otel

    otel_data = _get_otel()
    infra_data = _read_json(_DATA_DIR / "integrations" / "topology_edges.json")

    otel_edges = otel_data.get("edges", [])
    infra_edges = infra_data.get("edges", [])

    # Tag each edge with its layer
    for e in otel_edges:
        e["layer"] = "application"
    for e in infra_edges:
        e["layer"] = "infrastructure"

    all_edges = otel_edges + infra_edges

    # Deduplicate by (source, target, relationship)
    seen: set[tuple] = set()
    deduped: list[dict] = []
    for e in all_edges:
        key = (e.get("source", ""), e.get("target", ""), e.get("relationship", ""))
        if key not in seen:
            seen.add(key)
            deduped.append(e)

    # Collect all unique nodes
    nodes: dict[str, dict] = {}
    for e in deduped:
        for side in ("source", "target"):
            name = e.get(side, "")
            ntype = e.get(f"{side}_type", "service")
            layer = e.get("layer", "application")
            if name and name not in nodes:
                nodes[name] = {"id": name, "name": name, "type": ntype, "layer": layer}

    return {
        "nodes": list(nodes.values()),
        "edges": deduped,
        "summary": {
            "total_nodes": len(nodes),
            "total_edges": len(deduped),
            "otel_app_edges": len(otel_edges),
            "infra_structural_edges": len(infra_edges),
            "otel_services": otel_data.get("total_services", 0),
        },
        "coverage": {
            "has_otel_traces": len(otel_edges) > 0,
            "has_xray_traces": infra_data.get("summary", {}).get("tier1_xray", 0) > 0,
            "has_structural": infra_data.get("summary", {}).get("tier2_structural", 0) > 0,
            "has_inferred": infra_data.get("summary", {}).get("tier3_inferred", 0) > 0,
        }
    }


@router.get("/status")
def get_otel_status():
    """
    Show OTel receiver status — how many spans received, topology quality, setup instructions.
    """
    from app.integrations.otel_topology import _load_spans, get_otel_topology as _get_otel
    spans_data = _load_spans()
    otel_topo = _get_otel()
    infra_topo = _read_json(_DATA_DIR / "integrations" / "topology_edges.json")

    span_count = len(spans_data.get("spans", []))

    # Span breakdown by service
    from collections import Counter
    service_counts = Counter(s.get("service_name", "unknown") for s in spans_data.get("spans", []))

    return {
        "receiver_ready": True,
        "otlp_endpoint": "POST /api/otel/v1/traces",
        "spans_stored": span_count,
        "services_seen": dict(service_counts.most_common(20)),
        "topology": {
            "otel_app_edges": otel_topo.get("total_edges", 0),
            "otel_services": otel_topo.get("total_services", 0),
            "infra_tier1_xray": infra_topo.get("summary", {}).get("tier1_xray", 0),
            "infra_tier2_structural": infra_topo.get("summary", {}).get("tier2_structural", 0),
            "infra_tier3_inferred": infra_topo.get("summary", {}).get("tier3_inferred", 0),
        },
        "sdk_setup": {
            "env_vars": {
                "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:8000/api/otel",
                "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
                "OTEL_SERVICE_NAME": "<your-service-name>",
            },
            "python_example": (
                "pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http\n"
                "from opentelemetry.sdk.trace import TracerProvider\n"
                "from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter\n"
                "from opentelemetry.sdk.trace.export import BatchSpanProcessor\n"
                "exporter = OTLPSpanExporter(endpoint='http://localhost:8000/api/otel/v1/traces')\n"
                "provider = TracerProvider()\n"
                "provider.add_span_processor(BatchSpanProcessor(exporter))\n"
            ),
            "node_example": (
                "npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http\n"
                "const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');\n"
                "const exporter = new OTLPTraceExporter({ url: 'http://localhost:8000/api/otel/v1/traces' });\n"
            ),
        }
    }
