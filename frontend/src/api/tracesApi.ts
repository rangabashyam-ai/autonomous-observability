// Client for the external distributed-tracing service. It returns traces in OTLP/JSON
// wire format ({ trace: { batches: [{ resource, scopeSpans: [{ spans: [...] }] }] } }),
// which this module flattens into a simple span list for the UI to render.
const TRACES_BASE = import.meta.env.VITE_TRACES_API_BASE_URL ?? '/api/vm';

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  service: string;
  kind: string;
  status: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  attributes: Record<string, string>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // response wasn't JSON — fall through and surface the raw text below
  }
  if (!res.ok) {
    const detail = parsed?.detail;
    throw new Error(typeof detail === 'string' ? detail : text || `Traces API error: ${res.status}`);
  }
  return parsed as T;
}

function base64ToHex(b64: string): string {
  const binary = atob(b64);
  let hex = '';
  for (let i = 0; i < binary.length; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

function attrValue(value: any): string {
  if (value == null) return '';
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return String(value.intValue);
  if ('boolValue' in value) return String(value.boolValue);
  if ('doubleValue' in value) return String(value.doubleValue);
  return JSON.stringify(value);
}

function attributesToMap(attrs: Array<{ key: string; value: any }> = []): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of attrs) map[a.key] = attrValue(a.value);
  return map;
}

function nanoToMs(nano: string | number): number {
  return Number(BigInt(nano) / 1_000_000n);
}

function parseOtlpTrace(payload: any): TraceSpan[] {
  const batches = (payload?.trace ?? payload)?.batches ?? [];
  const spans: TraceSpan[] = [];
  for (const batch of batches) {
    const resourceAttrs = attributesToMap(batch?.resource?.attributes);
    for (const scopeSpan of batch?.scopeSpans ?? []) {
      for (const sp of scopeSpan?.spans ?? []) {
        const attrs = attributesToMap(sp.attributes);
        const startTimeMs = nanoToMs(sp.startTimeUnixNano);
        const endTimeMs = nanoToMs(sp.endTimeUnixNano);
        spans.push({
          traceId: base64ToHex(sp.traceId),
          spanId: base64ToHex(sp.spanId),
          parentSpanId: sp.parentSpanId ? base64ToHex(sp.parentSpanId) : null,
          name: sp.name,
          service: attrs.cmdb_id || resourceAttrs['service.name'] || sp.name,
          kind: (sp.kind ?? 'SPAN_KIND_UNSPECIFIED').replace('SPAN_KIND_', ''),
          status: sp.status?.message || sp.status?.code || 'UNSET',
          startTimeMs,
          endTimeMs,
          durationMs: Math.max(0, endTimeMs - startTimeMs),
          attributes: attrs,
        });
      }
    }
  }
  return spans;
}

export async function getTraceById(traceId: string): Promise<TraceSpan[]> {
  const params = new URLSearchParams({ trace_id: traceId });
  const payload = await fetchJson<any>(`${TRACES_BASE}/traces/get_trace_by_id?${params}`);
  return parseOtlpTrace(payload);
}
