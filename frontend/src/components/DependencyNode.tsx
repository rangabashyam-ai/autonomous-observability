import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { heatmapColor } from '../utils/colors';
import { useLongPress } from '../utils/hooks';

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
}

function DependencyNode({ id, data }: NodeProps<DependencyNodeData>) {
  const color = heatmapColor(data.heatmapValue, data.heatmapMetric as never);
  const borderColor = data.isSelected ? '#3b82f6' : data.isSearchMatch ? '#f59e0b' : color;
  
  const getIcon = () => {
    if (data.type === 'database') return '🛢️';
    if (data.type === 'server' || data.type === 'kubernetes_cluster') return '🖥️';
    if (data.type === 'load_balancer') return '⚖️';
    if (data.layer === 'microservice') return '⚙️';
    if (data.layer === 'business_service') return '💼';
    return '📦';
  };

  const longPressProps = useLongPress(
    (e) => {
      e.stopPropagation();
      data.onLongPress?.(id, false);
    },
    (e) => {
      e.stopPropagation();
      data.onClick?.(id, false);
    },
    { delay: 400 }
  );

  return (
    <div 
      {...longPressProps}
      className="relative flex flex-col items-center justify-center cursor-pointer"
      style={{ opacity: data.dimmed ? 0.25 : 1, transition: 'opacity 0.2s' }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0 !pointer-events-none" />
      
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shadow-md bg-white dark:bg-slate-800 z-10"
        style={{
          border: `2px solid ${borderColor}`,
          boxShadow: data.isSelected ? `0 0 8px ${borderColor}` : undefined,
        }}
      >
        <span className="text-xs leading-none">{getIcon()}</span>
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
