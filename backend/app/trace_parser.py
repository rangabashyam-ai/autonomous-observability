"""Parse OTLP/JSON trace payloads into flat span records for the frontend."""

from __future__ import annotations

import base64
from typing import Any


def _attr_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        if "stringValue" in value:
            return str(value["stringValue"])
        if "intValue" in value:
            return str(value["intValue"])
        if "boolValue" in value:
            return str(value["boolValue"])
        if "doubleValue" in value:
            return str(value["doubleValue"])
    return str(value)


def _attrs_to_map(attrs: list[dict] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for a in attrs or []:
        key = a.get("key")
        if key:
            out[key] = _attr_value(a.get("value"))
    return out


def _b64_to_hex(b64: str) -> str:
    try:
        return base64.b64decode(b64).hex()
    except Exception:
        return b64


def _nano_to_ms(nano: str | int) -> float:
    try:
        return int(nano) / 1_000_000
    except (TypeError, ValueError):
        return 0.0


def parse_otlp_trace(payload: Any) -> list[dict[str, Any]]:
    root = payload.get("trace") if isinstance(payload, dict) else payload
    batches = (root or {}).get("batches") or []
    spans: list[dict[str, Any]] = []
    for batch in batches:
        resource_attrs = _attrs_to_map(batch.get("resource", {}).get("attributes"))
        for scope_span in batch.get("scopeSpans") or []:
            for sp in scope_span.get("spans") or []:
                attrs = _attrs_to_map(sp.get("attributes"))
                start_ms = _nano_to_ms(sp.get("startTimeUnixNano", 0))
                end_ms = _nano_to_ms(sp.get("endTimeUnixNano", 0))
                status = sp.get("status") or {}
                spans.append({
                    "traceId": _b64_to_hex(sp.get("traceId", "")),
                    "spanId": _b64_to_hex(sp.get("spanId", "")),
                    "parentSpanId": _b64_to_hex(sp["parentSpanId"]) if sp.get("parentSpanId") else None,
                    "name": sp.get("name", ""),
                    "service": attrs.get("cmdb_id") or resource_attrs.get("service.name") or sp.get("name", ""),
                    "kind": str(sp.get("kind", "SPAN_KIND_UNSPECIFIED")).replace("SPAN_KIND_", ""),
                    "status": status.get("message") or status.get("code") or "UNSET",
                    "startTimeMs": start_ms,
                    "endTimeMs": end_ms,
                    "durationMs": max(0.0, end_ms - start_ms),
                    "attributes": attrs,
                })
    return spans
