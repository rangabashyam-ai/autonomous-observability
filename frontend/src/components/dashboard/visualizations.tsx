import { cn } from '../../lib/cn';
import { WorldMapBackground } from './WorldMapBackground';

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

/** Regional health map using precise SVG viewBox coordinates */
const REGIONS = [
  { id: 'us-east', label: 'US East', x: 200.00, y: 365.00, health: 'healthy' as const },
  { id: 'us-west', label: 'US West', x: 85.00, y: 355.00, health: 'healthy' as const },
  { id: 'eu-west', label: 'EU West', x: 400.02, y: 382.07, health: 'warning' as const },
  { id: 'eu-central', label: 'EU Central', x: 428.73, y: 392.28, health: 'healthy' as const },
  { id: 'ap-south', label: 'AP South', x: 600.18, y: 464.96, health: 'healthy' as const },
  { id: 'ap-northeast', label: 'AP Northeast', x: 722.24, y: 403.69, health: 'critical' as const },
  { id: 'sa-east', label: 'SA East', x: 268.20, y: 558.12, health: 'healthy' as const },
];

const healthColor: Record<string, string> = {
  healthy: '#10b981', // Emerald / success
  warning: '#f59e0b', // Amber / warning
  critical: '#ef4444', // Red / critical
};

export function RegionalHealthMap({
  className,
  onRegionClick,
}: {
  className?: string;
  onRegionClick?: (region: typeof REGIONS[0]) => void;
}) {
  return (
    <div className={cn('relative w-full overflow-hidden', className)}>
      <WorldMapBackground className="w-full h-full">
        {REGIONS.map((r) => {
          const tooltipWidth = r.label.length * 15 + 24;
          return (
            <g
              key={r.id}
              id={`region-group-${r.id}`}
              className="group cursor-pointer"
              onClick={() => onRegionClick?.(r)}
            >
              {/* Pulsing glow ring */}
              <circle
                id={`region-pulse-${r.id}`}
                cx={r.x}
                cy={r.y}
                r="22"
                fill={healthColor[r.health]}
                className="opacity-25 animate-pulse"
              />
              {/* Transparent click target area */}
              <circle
                id={`region-click-target-${r.id}`}
                cx={r.x}
                cy={r.y}
                r="32"
                fill="transparent"
                className="cursor-pointer"
              />
              {/* Hover ring */}
              <circle
                id={`region-hover-ring-${r.id}`}
                cx={r.x}
                cy={r.y}
                r="23"
                fill="none"
                stroke={healthColor[r.health]}
                strokeWidth="3"
                className="opacity-0 group-hover:opacity-60 transition-all duration-200 scale-90 group-hover:scale-100 origin-center"
                style={{ transformOrigin: `${r.x}px ${r.y}px` }}
              />
              {/* Main visible dot */}
              <circle
                id={`region-dot-${r.id}`}
                cx={r.x}
                cy={r.y}
                r="14"
                fill={healthColor[r.health]}
                stroke="var(--color-card)"
                strokeWidth="3"
                className="transition-transform duration-200 group-hover:scale-110 origin-center"
                style={{ transformOrigin: `${r.x}px ${r.y}px` }}
              />
              
              {/* Tooltip */}
              <g id={`region-tooltip-${r.id}`} className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                <rect
                  id={`region-tooltip-bg-${r.id}`}
                  x={r.x - tooltipWidth / 2}
                  y={r.y - 64}
                  width={tooltipWidth}
                  height={36}
                  rx="8"
                  fill="var(--color-card)"
                  stroke="var(--color-border)"
                  strokeWidth="2"
                  className="shadow-sm"
                />
                <text
                  id={`region-tooltip-text-${r.id}`}
                  x={r.x}
                  y={r.y - 39}
                  textAnchor="middle"
                  fill="var(--color-text-primary)"
                  fontSize="24"
                  fontWeight="600"
                  className="select-none font-sans"
                >
                  {r.label}
                </text>
              </g>
            </g>
          );
        })}
      </WorldMapBackground>
    </div>
  );
}
