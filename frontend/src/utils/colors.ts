import type { HeatmapMetric } from '../types/api';

/**
 * Map a golden-signal score to a green→red colour.
 *
 * Each signal has its own scale so "healthy" always maps to green:
 *
 *  latency    0-100  (0=fast=green, 100=very slow=red)         — P90 ms / 10
 *  traffic    0-100  INVERTED: high traffic = system serving = green,
 *                    low traffic = potential outage = red       — avg rr (0-100 unit)
 *  errors     0-100  amplified ×10 so 1 % error ≈ lime-green,
 *                    10 % error = red                          — (100-sr) %
 *  saturation 0-100  direct CPU %                              — cpu %
 */
export function heatmapColor(value: number, metric: HeatmapMetric): string {
  let score = value;

  if (metric === 'traffic') {
    // Invert: traffic near 100 = healthy green; dropping traffic = red
    score = 100 - value;
  } else if (metric === 'errors') {
    // Amplify: 1 % → 10, 5 % → 50, 10 % → 100
    score = Math.min(value * 10, 100);
  }
  // latency and saturation: use raw 0-100 value directly

  if (score >= 80) return '#ef4444'; // red
  if (score >= 60) return '#f97316'; // orange
  if (score >= 40) return '#eab308'; // yellow
  if (score >= 20) return '#84cc16'; // lime
  return '#22c55e';                  // green
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
