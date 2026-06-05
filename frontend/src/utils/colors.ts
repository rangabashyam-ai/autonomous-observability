import type { HeatmapMetric } from '../types/api';

export function heatmapColor(value: number, metric: HeatmapMetric): string {
  let normalized = value;
  if (metric === 'incident_count') normalized = Math.min(value * 10, 100);
  if (metric === 'error_rate') normalized = Math.min(value * 20, 100);

  if (normalized >= 80) return '#ef4444';
  if (normalized >= 60) return '#eab308';
  return '#22c55e';
}

export function healthBadgeClass(health: string): string {
  switch (health) {
    case 'critical':
      return 'bg-red-500/20 text-red-400 border-red-500/40';
    case 'warning':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40';
    default:
      return 'bg-green-500/20 text-green-400 border-green-500/40';
  }
}

export function formatNumber(n: number, decimals = 1): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(decimals);
}

export function layerLabel(layer: string): string {
  return layer.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
