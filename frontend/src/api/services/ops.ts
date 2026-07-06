import type { OpsCatalog, OpsDashboardDefinition, OpsDashboardId, OpsEntitiesResponse } from '../../types/ops';
import { cachedFetch } from '../fetchCache';
import { BASE, fetchJson } from './base';

export async function getOpsCatalog(): Promise<OpsCatalog> {
  return cachedFetch('ops:catalog', () => fetchJson<OpsCatalog>(`${BASE}/ops/catalog`));
}

export async function getOpsDashboard(dashboardId: OpsDashboardId): Promise<OpsDashboardDefinition> {
  return cachedFetch(`ops:dashboard:${dashboardId}`, () =>
    fetchJson<OpsDashboardDefinition>(`${BASE}/ops/dashboards/${dashboardId}`),
  );
}

export async function getOpsEntities(params?: {
  entity_type?: string;
  perspective?: 'service' | 'platform';
  health?: string;
}): Promise<OpsEntitiesResponse> {
  const q = new URLSearchParams();
  if (params?.entity_type) q.set('entity_type', params.entity_type);
  if (params?.perspective) q.set('perspective', params.perspective);
  if (params?.health) q.set('health', params.health);
  const suffix = q.toString() ? `?${q}` : '';
  return cachedFetch(`ops:entities${suffix}`, () =>
    fetchJson<OpsEntitiesResponse>(`${BASE}/ops/entities${suffix}`),
  );
}

/** Pre-shaped table rows from VM push or backend — no client-side derive*. */
export async function getOpsSectionData(
  dashboardId: string,
  deriveKey: string,
  perspective?: 'service' | 'platform',
): Promise<{ rows: Record<string, unknown>[]; source: string; dataset_available?: boolean }> {
  const q = new URLSearchParams();
  if (perspective) q.set('perspective', perspective);
  const suffix = q.toString() ? `?${q}` : '';
  return fetchJson(`${BASE}/ops/sections/${dashboardId}/${deriveKey}${suffix}`);
}
