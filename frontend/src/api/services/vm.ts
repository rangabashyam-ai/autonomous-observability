import { fetchJson, VM_BASE } from './base';

export interface VmIncident {
  incidentId: string;
  title: string;
  severity: string;
  status: string;
  description?: string;
  entities?: string[];
  alerts?: { count?: number; items?: unknown[] };
  [key: string]: unknown;
}

export interface VmIncidentsResponse {
  status: string;
  source: string;
  count: number;
  incidents: VmIncident[];
  dataset_available: boolean;
}

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

export interface VmAlertsResponse {
  status: string;
  source: string;
  count: number;
  alerts: unknown[];
  dataset_available: boolean;
}

export interface VmTraceSpansResponse {
  trace_id: string;
  spans: TraceSpan[];
  span_count: number;
  source: string;
}

export interface VmStatusResponse {
  parquet_available: boolean;
  vm_data_available: boolean;
  keys: Record<string, boolean>;
  ingest_endpoints: string[];
}

/** Bank-format incidents — served from MinIO, VM push, or empty when disconnected. */
export async function getVmIncidents(params?: {
  cmdb_id?: string;
  status?: string;
  limit?: number;
}): Promise<VmIncidentsResponse> {
  const q = new URLSearchParams();
  if (params?.cmdb_id) q.set('cmdb_id', params.cmdb_id);
  if (params?.status) q.set('status', params.status);
  if (params?.limit) q.set('limit', String(params.limit));
  const suffix = q.toString() ? `?${q}` : '';
  return fetchJson(`${VM_BASE}/incidents${suffix}`);
}

/** VM-pushed or MinIO alerts. */
export async function getVmAlerts(params?: { limit?: number }): Promise<VmAlertsResponse> {
  const q = new URLSearchParams();
  if (params?.limit) q.set('limit', String(params.limit));
  const suffix = q.toString() ? `?${q}` : '';
  return fetchJson(`${VM_BASE}/alerts${suffix}`);
}

/** Flat span list — backend parses OTLP; frontend only displays. */
export async function getVmTraceSpans(traceId: string): Promise<TraceSpan[]> {
  const params = new URLSearchParams({ trace_id: traceId });
  const res = await fetchJson<VmTraceSpansResponse>(`${VM_BASE}/traces/spans?${params}`);
  return res.spans;
}

/** VM / parquet connectivity status. */
export async function getVmStatus(): Promise<VmStatusResponse> {
  return fetchJson(`${VM_BASE}/status`);
}
