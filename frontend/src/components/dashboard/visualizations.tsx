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

export function UtilizationBar({
  label,
  value,
  max = 100,
  variant = 'utilization',
}: {
  label: string;
  value: number;
  max?: number;
  /** utilization: higher = worse (CPU, latency). availability: higher = better (uptime, success rate). */
  variant?: 'utilization' | 'availability';
}) {
  const pct = Math.min(100, (value / max) * 100);
  const color =
    variant === 'availability'
      ? pct >= 95
        ? 'bg-success'
        : pct >= 80
          ? 'bg-warning'
          : 'bg-critical'
      : pct >= 85
        ? 'bg-critical'
        : pct >= 70
          ? 'bg-warning'
          : 'bg-success';

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

/** Static geography positions for known region IDs (no health data). */
const REGION_POSITIONS: Record<string, { label: string; x: number; y: number }> = {
  'us-east': { label: 'US East', x: 200.0, y: 365.0 },
  'us-west': { label: 'US West', x: 85.0, y: 355.0 },
  'eu-west': { label: 'EU West', x: 400.02, y: 382.07 },
  'eu-central': { label: 'EU Central', x: 428.73, y: 392.28 },
  'ap-south': { label: 'AP South', x: 600.18, y: 464.96 },
  'ap-northeast': { label: 'AP Northeast', x: 722.24, y: 403.69 },
  'sa-east': { label: 'SA East', x: 268.2, y: 558.12 },
};

export type RegionalHealthStatus = 'healthy' | 'warning' | 'critical';

export interface RegionalHealthPoint {
  id: string;
  label: string;
  health: RegionalHealthStatus;
  x?: number;
  y?: number;
}

function resolveRegionPosition(regionId: string): { label: string; x: number; y: number } | null {
  const direct = REGION_POSITIONS[regionId];
  if (direct) return direct;
  const normalized = regionId.toLowerCase().replace(/[_\s]/g, '-');
  if (REGION_POSITIONS[normalized]) return REGION_POSITIONS[normalized];
  const prefix = Object.keys(REGION_POSITIONS).find((key) => normalized.startsWith(key));
  return prefix ? REGION_POSITIONS[prefix] : null;
}

function normalizeHealth(health: string): RegionalHealthStatus {
  const h = health.toLowerCase();
  if (h === 'critical' || h === 'down' || h === 'error') return 'critical';
  if (h === 'warning' || h === 'degraded' || h === 'warn') return 'warning';
  return 'healthy';
}

const healthColor: Record<RegionalHealthStatus, string> = {
  healthy: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
};

export function RegionalHealthMap({
  className,
  onRegionClick,
  noData = false,
  regions = [],
}: {
  className?: string;
  onRegionClick?: (region: RegionalHealthPoint & { x: number; y: number }) => void;
  /** When true, show map without regional health indicators */
  noData?: boolean;
  /** Live regional health from connected data sources */
  regions?: RegionalHealthPoint[];
}) {
  const plottedRegions = noData
    ? []
    : regions
        .map((r) => {
          const pos = r.x != null && r.y != null
            ? { label: r.label, x: r.x, y: r.y }
            : resolveRegionPosition(r.id);
          if (!pos) return null;
          return { ...r, label: r.label || pos.label, x: pos.x, y: pos.y, health: normalizeHealth(r.health) };
        })
        .filter((r): r is RegionalHealthPoint & { x: number; y: number } => r !== null);

  return (
    <div className={cn('relative w-full overflow-hidden', className)}>
      <WorldMapBackground className="w-full h-full">
        {plottedRegions.map((r) => {
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
