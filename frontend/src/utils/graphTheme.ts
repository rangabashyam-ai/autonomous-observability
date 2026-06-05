export type GraphNodeRole = 'default' | 'highlighted' | 'source';

export interface GraphNodeThemeStyle {
  background: string;
  border: string;
  color: string;
}

export function getHealthNodeStyle(
  health: 'healthy' | 'warning' | 'critical' | string,
  theme: 'light' | 'dark'
): GraphNodeThemeStyle {
  const h = health.toLowerCase();
  if (theme === 'light') {
    if (h === 'critical') return { background: '#FEE2E2', border: '#EF4444', color: '#991B1B' };
    if (h === 'warning') return { background: '#FEF3C7', border: '#F59E0B', color: '#92400E' };
    return { background: '#ECFDF5', border: '#10B981', color: '#065F46' };
  }
  if (h === 'critical') return { background: '#450A0A', border: '#EF4444', color: '#FECACA' };
  if (h === 'warning') return { background: '#422006', border: '#F59E0B', color: '#FDE68A' };
  return { background: '#111827', border: '#10B981', color: '#D1FAE5' };
}

export function getGraphNodeStyle(
  role: GraphNodeRole,
  theme: 'light' | 'dark'
): GraphNodeThemeStyle {
  if (theme === 'light') {
    switch (role) {
      case 'source':
        return { background: '#fee2e2', border: '#dc2626', color: '#991b1b' };
      case 'highlighted':
        return { background: '#fef9c3', border: '#ca8a04', color: '#713f12' };
      default:
        return { background: '#ffffff', border: '#94a3b8', color: '#0f172a' };
    }
  }
  switch (role) {
    case 'source':
      return { background: '#450a0a', border: '#ef4444', color: '#fecaca' };
    case 'highlighted':
      return { background: '#422006', border: '#eab308', color: '#fef08a' };
    default:
      return { background: '#1e293b', border: '#475569', color: '#e2e8f0' };
  }
}

export function getGraphBackgroundColor(theme: 'light' | 'dark'): string {
  return theme === 'light' ? '#cbd5e1' : '#334155';
}

export function getGraphEdgeColor(theme: 'light' | 'dark', impact = false): string {
  if (impact) return theme === 'light' ? '#dc2626' : '#ef4444';
  return theme === 'light' ? '#64748b' : '#64748b';
}

export function getHeatmapGradientEnd(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? '#1e293b' : '#f8fafc';
}
