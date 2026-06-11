import type {
  BlastRadiusResult,
  EarlyDetection,
  Incident,
  IncidentClickAnalysis,
  Investigation,
  KnowledgeGraph,
  Overview,
  RCAResult,
} from '../types/intelligence';
import type {
  DependencyGraph,
  DependencyPath,
  HeatmapMetric,
  MonitoringDashboard,
  ViewType,
} from '../types/api';

import type { CopilotContextPayload, CopilotResponse } from '../ai/types';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `API error: ${res.status}`);
  }
  return res.json();
}

// --- Dependencies ---
export async function getDependencyGraph(
  view: ViewType,
  heatmap: HeatmapMetric,
  focusNode?: string | null
): Promise<DependencyGraph> {
  const params = new URLSearchParams({ view, heatmap });
  if (focusNode) params.set('focus_node', focusNode);
  return fetchJson(`${BASE}/dependencies/graph?${params}`);
}

export async function getDependencyPaths(nodeId: string): Promise<DependencyPath> {
  return fetchJson(`${BASE}/dependencies/nodes/${nodeId}/paths`);
}

export async function addDependency(source: string, target: string, relationship: string) {
  await fetchJson(`${BASE}/dependencies/edges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, target, relationship }),
  });
}

export async function deleteDependency(source: string, target: string) {
  const params = new URLSearchParams({ source, target });
  await fetchJson(`${BASE}/dependencies/edges?${params}`, { method: 'DELETE' });
}

export async function uploadCsvDependencies(file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/dependencies/upload/csv`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('CSV upload failed');
  return res.json();
}

export async function uploadJsonDependency(source: string, target: string, relationship: string) {
  await fetchJson(`${BASE}/dependencies/upload/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, target, relationship }),
  });
}

// --- Monitoring ---
export async function getMonitoringDashboard(): Promise<MonitoringDashboard> {
  return fetchJson(`${BASE}/monitoring/dashboard`);
}

export async function getAlerts(limit = 20) {
  return fetchJson<{ alerts: unknown[] }>(`${BASE}/monitoring/alerts?limit=${limit}`);
}

// --- Intelligence ---
export async function getOverview(): Promise<Overview> {
  return fetchJson(`${BASE}/overview`, { method: 'POST' });
}

export async function getKnowledgeGraph(): Promise<KnowledgeGraph> {
  return fetchJson(`${BASE}/knowledge-graph`);
}

export async function getIncidents(params?: {
  limit?: number;
  offset?: number;
  severity?: string;
  service?: string;
  search?: string;
  state?: string;
  active?: boolean;
}): Promise<{ incidents: Incident[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  if (params?.severity) q.set('severity', params.severity);
  if (params?.service) q.set('service', params.service);
  if (params?.search) q.set('search', params.search);
  if (params?.state) q.set('state', params.state);
  if (params?.active !== undefined) q.set('active', String(params.active));
  return fetchJson(`${BASE}/incidents/?${q}`);
}

export async function getIncident(id: string): Promise<Incident> {
  return fetchJson(`${BASE}/incidents/${id}`);
}

export async function getIncidentClickAnalysis(id: string): Promise<IncidentClickAnalysis> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    return await fetchJson(`${BASE}/incidents/${id}/analysis`, { signal: controller.signal });
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('Analysis timed out — please try again');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeRCA(body: {
  alerts: string[];
  symptoms: string[];
  service?: string;
  time_window_hours?: number;
  environment?: string;
}): Promise<RCAResult> {
  return fetchJson(`${BASE}/rca/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function analyzeRCAWithAgent(body: {
  alerts: string[];
  symptoms: string[];
  service?: string;
  time_window_hours?: number;
}): Promise<IncidentClickAnalysis> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    return await fetchJson(`${BASE}/rca/agent-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('Agent analysis timed out — please try again');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function askReportChat(body: {
  question: string;
  report_context: string;
  report_type: string;
  history: { role: string; content: string }[];
}): Promise<{ answer: string | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 32000);
  try {
    return await fetchJson(`${BASE}/agents/report-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('Response timed out — please try again');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeBlastRadius(body: {
  alerts: string[];
  symptoms: string[];
  source_component?: string;
  service?: string;
}): Promise<BlastRadiusResult> {
  return fetchJson(`${BASE}/blast-radius/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function analyzeEarlyDetection(alerts?: string[]): Promise<{
  current_conditions: string[];
  detections: EarlyDetection[];
}> {
  if (alerts) {
    return fetchJson(`${BASE}/early-detection/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_alerts: alerts }),
    });
  }
  return fetchJson(`${BASE}/early-detection/analyze`);
}

export async function startInvestigation(body: {
  alerts: string[];
  symptoms: string[];
  service?: string;
}): Promise<Investigation> {
  return fetchJson(`${BASE}/investigations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getInvestigation(id: string): Promise<Investigation> {
  return fetchJson(`${BASE}/investigations/${id}`);
}

export async function advanceInvestigation(id: string): Promise<Investigation> {
  return fetchJson(`${BASE}/investigations/${id}/advance`, { method: 'POST' });
}

export async function approveInvestigation(id: string): Promise<Investigation> {
  return fetchJson(`${BASE}/investigations/${id}/approve`, { method: 'POST' });
}

export async function executeInvestigation(id: string): Promise<Investigation> {
  return fetchJson(`${BASE}/investigations/${id}/execute`, { method: 'POST' });
}

export async function askCopilot(question: string) {
  return fetchJson<{ question: string; answer: string; sources: string[]; suggested_actions: string[] }>(
    `${BASE}/copilot/ask`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) }
  );
}

export async function getDataStatus() {
  return fetchJson<{ files: { file: string; exists: boolean; size_bytes: number; records: number }[] }>(
    `${BASE}/admin/data-status`
  );
}

export async function regenerateData() {
  return fetchJson(`${BASE}/admin/regenerate`, { method: 'POST' });
}

export async function uploadDataFile(category: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/admin/upload/${category}`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

export async function askScopedCopilot(
  contextType: string,
  contextPayload: any,
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
) {
  return fetchJson<{ answer: string; sources: string[]; timestamp: string }>(
    `${BASE}/copilot/scoped`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context_type: contextType,
        context_payload: contextPayload,
        question,
        history,
      }),
    }
  );
}

export async function copilotChat(
  context: CopilotContextPayload,
  messages: { role: string; content: string }[] = []
): Promise<CopilotResponse> {
  return fetchJson<CopilotResponse>(`${BASE}/copilot/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, messages }),
  });
}

export async function chatBlastRadius(
  service: string,
  question: string,
  history: { role: string; content: string }[] = []
) {
  return fetchJson<{ service: string; currently_impacted: string[]; likely_downstream: string[]; answer: string }>(
    `${BASE}/blast-radius/chat-investigate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, question, history }),
    }
  );
}

