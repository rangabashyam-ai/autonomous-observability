import { cn } from '../../lib/cn';

interface HeatmapCell {
  id: string;
  value: number;
  label?: string;
}

function heatColor(value: number): string {
  if (value >= 85) return 'bg-critical';
  if (value >= 70) return 'bg-warning';
  if (value >= 50) return 'bg-warning/60';
  if (value >= 30) return 'bg-success/60';
  return 'bg-success/30';
}

export function ResourceHeatmap({
  cells,
  columns = 8,
  className,
  showLabels = false,
}: {
  cells: HeatmapCell[];
  columns?: number;
  className?: string;
  showLabels?: boolean;
}) {
  return (
    <div
      className={cn('grid gap-1', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {cells.map((cell) => (
        <div
          key={cell.id}
          title={`${cell.label ?? cell.id}: ${cell.value.toFixed(1)}%`}
          className={cn(
            'aspect-square rounded-sm transition-transform duration-150 hover:scale-110 hover:z-10 cursor-default',
            heatColor(cell.value)
          )}
        />
      ))}
      {showLabels && cells.length === 0 && (
        <p className="col-span-full text-xs text-text-secondary">No data</p>
      )}
    </div>
  );
}

export function UtilizationBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 85 ? 'bg-critical' : pct >= 70 ? 'bg-warning' : 'bg-success';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-text-secondary truncate">{label}</span>
        <span className="text-text-primary font-mono tabular-nums">{value.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-300', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Simplified regional health map */
const REGIONS = [
  { id: 'us-east', label: 'US East', x: 22, y: 38, health: 'healthy' as const },
  { id: 'us-west', label: 'US West', x: 12, y: 40, health: 'healthy' as const },
  { id: 'eu-west', label: 'EU West', x: 48, y: 32, health: 'warning' as const },
  { id: 'eu-central', label: 'EU Central', x: 52, y: 30, health: 'healthy' as const },
  { id: 'ap-south', label: 'AP South', x: 68, y: 52, health: 'healthy' as const },
  { id: 'ap-northeast', label: 'AP Northeast', x: 82, y: 38, health: 'critical' as const },
  { id: 'sa-east', label: 'SA East', x: 32, y: 68, health: 'healthy' as const },
];

const healthDot: Record<string, string> = {
  healthy: 'fill-success',
  warning: 'fill-warning',
  critical: 'fill-critical',
};

export function RegionalHealthMap({ className }: { className?: string }) {
  return (
    <div className={cn('relative w-full', className)}>
      <svg viewBox="0 0 100 80" className="w-full h-full opacity-30">
        <ellipse cx="50" cy="40" rx="45" ry="30" fill="none" stroke="var(--color-border)" strokeWidth="0.5" />
        <ellipse cx="30" cy="35" rx="12" ry="18" fill="none" stroke="var(--color-border)" strokeWidth="0.3" />
        <ellipse cx="52" cy="32" rx="10" ry="14" fill="none" stroke="var(--color-border)" strokeWidth="0.3" />
        <ellipse cx="75" cy="42" rx="14" ry="12" fill="none" stroke="var(--color-border)" strokeWidth="0.3" />
      </svg>
      {REGIONS.map((r) => (
        <div
          key={r.id}
          className="absolute group"
          style={{ left: `${r.x}%`, top: `${r.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className={cn('h-3 w-3 rounded-full ring-2 ring-card', healthDot[r.health])} />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
            <div className="whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-[10px] text-text-primary shadow-sm">
              {r.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
