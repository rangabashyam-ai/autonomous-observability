/** Shared empty-state helpers when no data source is connected. */

import type { Overview } from '../types/intelligence';

export const NO_DATA_MESSAGE = 'Please Connect your Data Source';

export const EMPTY_OVERVIEW: Overview = {
  summary: {
    total_incidents: 0,
    active_incidents: 0,
    open_alerts: 0,
    knowledge_graph_nodes: 0,
    knowledge_graph_edges: 0,
    early_warnings: 0,
    active_investigations: 0,
  },
  recent_incidents: [],
  top_root_causes: [],
  early_detections: [],
  open_alerts_preview: [],
};

export function isDataAvailable(datasetAvailable?: boolean): boolean {
  return datasetAvailable === true;
}

/** Check VM incidents endpoint for live data (independent of parquet metrics). */
export async function isVmIntelAvailable(): Promise<boolean> {
  try {
    const { getVmIncidents } = await import('../api/client');
    const res = await getVmIncidents({ limit: 1 });
    return res.dataset_available === true;
  } catch {
    return false;
  }
}

/** Format a numeric metric; returns N/A when value is missing. */
export function formatMetric(
  value: number | null | undefined,
  options: { suffix?: string; decimals?: number; unit?: string } = {}
): string {
  const { suffix = '', decimals = 0, unit = '' } = options;
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A';
  }
  const formatted =
    decimals > 0 ? value.toFixed(decimals) : Number.isInteger(value) ? String(value) : value.toFixed(decimals);
  return `${formatted}${unit}${suffix}`;
}

/** Return a count for display; defaults to 0 when missing. */
export function displayCount(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return value;
}

/** Return a percentage string or N/A. */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A';
  }
  return `${value.toFixed(decimals)}%`;
}
