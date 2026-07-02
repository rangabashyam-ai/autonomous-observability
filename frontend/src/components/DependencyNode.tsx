import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { heatmapColor } from '../utils/colors';
import { useLongPress } from '../utils/hooks';
import type { HeatmapMetric } from '../types/api';

export interface DependencyNodeData {
  label: string;
  type: string;
  layer: string;
  health: string;
  heatmapValue: number;
  heatmapMetric: string;
  isSelected: boolean;
  isHighlighted: boolean;
  isSearchMatch?: boolean;
  dimmed?: boolean;
  onLongPress?: (id: string, isGroup: boolean) => void;
  onClick?: (id: string, isGroup: boolean) => void;
  onDoubleClick?: (id: string, label: string) => void;
}

const SIGNAL_FORMAT: Record<string, (v: number) => string> = {
  latency: (v) => `${(v * 10).toFixed(0)}ms`,
  traffic: (v) => `${v.toFixed(0)}%`,
  errors: (v) => `${v.toFixed(1)}%`,
  saturation: (v) => `${v.toFixed(0)}%`,
};

function DependencyNode({ id, data }: NodeProps<DependencyNodeData>) {
  const color = heatmapColor(data.heatmapValue, data.heatmapMetric as HeatmapMetric);
  const borderColor = data.isSelected ? '#3b82f6' : data.isSearchMatch ? '#f59e0b' : color;

  const isRed = color === '#ef4444';
  const isOrange = color === '#f97316';
  const isAlert = isRed || isOrange;

  const getIcon = () => {
    if (data.type === 'database') return '🛢️';
    if (data.type === 'cache') return '⚡';
    if (data.type === 'web_server') return '🌐';
    if (data.type === 'server' || data.type === 'kubernetes_cluster') return '🖥️';
    if (data.type === 'load_balancer') return '⚖️';
    if (data.type === 'gateway') return '🔀';
    if (data.type === 'container') return '🐳';
    if (data.layer === 'microservice') return '⚙️';
    if (data.layer === 'business_service') return '💼';
    return '📦';
  };

  // onClick is handled by ReactFlow's onNodeClick at the canvas level.
  // useLongPress here covers only the long-press-to-popup path.
  const longPressProps = useLongPress(
    (e) => { e.stopPropagation(); data.onLongPress?.(id, false); },
    (_e) => { /* no-op: short click delegated to ReactFlow onNodeClick */ },
    { delay: 400 }
  );

  const signalLabel = SIGNAL_FORMAT[data.heatmapMetric]?.(data.heatmapValue);

  const glow = isRed
    ? `0 0 10px ${color}, 0 0 22px ${color}55`
    : isOrange
      ? `0 0 8px ${color}99`
      : undefined;

  return (
    <div
      {...longPressProps}
      onMouseDown={(e) => { e.stopPropagation(); longPressProps.onMouseDown(e); }}
      onMouseUp={(e) => { e.stopPropagation(); longPressProps.onMouseUp(e); }}
      className="relative flex flex-col items-center justify-center cursor-pointer"
      style={{
        opacity: data.dimmed ? 0.1 : 1,
        filter: data.dimmed ? 'blur(1.5px) grayscale(0.7)' : 'none',
        transition: 'opacity 0.35s ease, filter 0.35s ease',
      }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0 !pointer-events-none" />

      {/* Signal value badge */}
      {!data.dimmed && signalLabel && (
        <div
          className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-mono font-bold px-1 rounded whitespace-nowrap z-20"
          style={{
            color,
            textShadow: isAlert ? `0 0 6px ${color}` : undefined,
          }}
        >
          {signalLabel}
        </div>
      )}

      {/* Ping ring for alert nodes */}
      <div className="relative w-7 h-7">
        {isAlert && !data.dimmed && (
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{
              border: `2px solid ${color}`,
              opacity: 0.45,
              animationDuration: isRed ? '0.9s' : '1.4s',
            }}
          />
        )}

        {/* Node circle */}
        <div
          className="relative z-10 w-7 h-7 rounded-full flex items-center justify-center bg-white dark:bg-slate-800"
          style={{
            border: `2.5px solid ${borderColor}`,
            boxShadow: data.isSelected
              ? `0 0 0 3px #3b82f680, ${glow ?? '0 1px 4px rgba(0,0,0,0.25)'}`
              : glow ?? '0 1px 4px rgba(0,0,0,0.15)',
            transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
          }}
        >
          <span className="text-xs leading-none">{getIcon()}</span>
        </div>
      </div>

      <div className="absolute top-8 left-1/2 -translate-x-1/2 w-28 text-center pointer-events-none">
        <div className="text-[10px] font-bold text-slate-800 dark:text-slate-200 leading-tight drop-shadow-md">
          {data.label}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!opacity-0 !pointer-events-none" />
    </div>
  );
}

export default memo(DependencyNode);
