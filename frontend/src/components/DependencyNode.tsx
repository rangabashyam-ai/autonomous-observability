import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { heatmapColor } from '../utils/colors';
import { useTheme } from '../context/ThemeContext';

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
}

function DependencyNode({ data }: NodeProps<DependencyNodeData>) {
  const { theme } = useTheme();
  const color = heatmapColor(data.heatmapValue, data.heatmapMetric as never);
  const borderColor = data.isSelected
    ? '#3b82f6'
    : data.isSearchMatch
    ? '#f59e0b'
    : data.isHighlighted
    ? '#a855f7'
    : color;
  const bgEnd = theme === 'dark' ? '#1e293b' : '#f8fafc';

  return (
    <div
      className="rounded-lg shadow-lg min-w-[140px] max-w-[180px]"
      style={{
        border: `2px solid ${borderColor}`,
        background: `linear-gradient(135deg, ${color}22 0%, ${bgEnd} 100%)`,
        boxShadow: data.isSelected
          ? `0 0 14px ${borderColor}88`
          : data.isSearchMatch
          ? `0 0 10px ${borderColor}99`
          : undefined,
        opacity: data.dimmed ? 0.25 : 1,
        transition: 'opacity 0.2s ease, box-shadow 0.2s ease',
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />
      <div className="px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
          {data.layer.replace(/_/g, ' ')}
        </div>
        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate mt-0.5" title={data.label}>
          {data.label}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-slate-500 dark:text-slate-400">{data.type}</span>
          <span
            className="text-[10px] font-mono font-bold"
            style={{ color }}
          >
            {data.heatmapValue.toFixed(data.heatmapMetric === 'incident_count' ? 0 : 1)}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  );
}

export default memo(DependencyNode);
