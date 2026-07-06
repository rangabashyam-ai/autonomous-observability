import type { MonitoringDashboard } from '../../types/api';
import { cachedFetch } from '../fetchCache';
import { BASE, fetchJson } from './base';

export async function getMonitoringDashboard(): Promise<MonitoringDashboard> {
  try {
    return await cachedFetch('monitoring:dashboard', () =>
      fetchJson<MonitoringDashboard>(`${BASE}/monitoring/dashboard`),
    );
  } catch {
    return {
      dataset_available: false,
      executive: {
        service_availability: 0,
        transaction_success_rate: 0,
        sla_compliance: 0,
        revenue_impact_usd: 0,
        customer_impact_count: 0,
        services_at_risk: 0,
        active_incidents: 0,
      },
      service: { services: [] },
      technical: { containers: [], apis: [], databases: [], queues: [], jvm: [] },
      infrastructure: {
        summary: { avg_cpu: 0, avg_memory: 0, avg_storage: 0, avg_network: 0, avg_io: 0 },
        servers: [],
      },
    };
  }
}

export async function getMonitoringAlerts(limit = 20) {
  return fetchJson<{ alerts: unknown[]; total: number }>(`${BASE}/monitoring/alerts?limit=${limit}`);
}

export async function getMonitoringMetrics(entityId?: string, metric?: string) {
  const q = new URLSearchParams();
  if (entityId) q.set('entity_id', entityId);
  if (metric) q.set('metric', metric);
  const suffix = q.toString() ? `?${q}` : '';
  return fetchJson<{ metrics: unknown[] }>(`${BASE}/monitoring/metrics${suffix}`);
}

export async function getMonitoringEvents(limit = 50) {
  return fetchJson<{ events: unknown[]; total: number }>(`${BASE}/monitoring/events?limit=${limit}`);
}

export async function getNodeMetrics(nodeId: string, window = 30) {
  return fetchJson(`${BASE}/monitoring/node-metrics/${encodeURIComponent(nodeId)}?window=${window}`);
}

export async function getTimeseries(metric: string, entityId?: string) {
  const q = new URLSearchParams({ metric });
  if (entityId) q.set('entity_id', entityId);
  return fetchJson<{ metric: string; points: { t: number; v: number }[]; source: string }>(
    `${BASE}/monitoring/timeseries?${q}`,
  );
}
