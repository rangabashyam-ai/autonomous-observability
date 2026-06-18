import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { useTheme } from '../context/ThemeContext';
import { getBlastImpactStyle } from '../utils/graphTheme';
import { IMPACT_ROLE_LABELS, type BlastImpactRole } from '../utils/blastGraphLayout';
import { healthBadgeClass, layerLabel } from '../utils/colors';

export interface BlastRadiusNodeData {
  label: string;
  layer: string;
  type: string;
  health: string;
  impactRole: BlastImpactRole;
  isSelected: boolean;
  riskScore: number;
  isRegionHighlighted?: boolean;
  isHovered?: boolean;
  isNeighbor?: boolean;
  isFocusMode?: boolean;
  isGlowing?: boolean;
  isPulsing?: boolean;
}

const BADGE_COLORS: Record<BlastImpactRole, string> = {
  root: 'bg-red-600 text-white',
  impacted: 'bg-orange-500 text-white',
  downstream: 'bg-amber-500 text-amber-950',
  upstream: 'bg-indigo-600 text-white',
  infrastructure: 'bg-violet-600 text-white',
  at_risk: 'bg-yellow-600 text-yellow-950',
  context: 'bg-slate-400/80 text-slate-800 dark:bg-slate-600 dark:text-slate-200',
};

function BlastRadiusNode({ data }: NodeProps<BlastRadiusNodeData>) {
  const { theme } = useTheme();
  const baseStyle = getBlastImpactStyle(data.impactRole, theme);
  const dimmed = data.impactRole === 'context' || data.isRegionHighlighted === false;
  const badge = IMPACT_ROLE_LABELS[data.impactRole];

  let nodeStyle = baseStyle;
  let badgeColor = BADGE_COLORS[data.impactRole];

  if (data.impactRole === 'root') {
    nodeStyle = theme === 'light'
      ? { background: '#fef2f2', border: '#dc2626', color: '#7f1d1d' }
      : { background: '#450a0a', border: '#ef4444', color: '#fecaca' };
    badgeColor = 'bg-red-600 text-white';
  } else if (data.health === 'healthy') {
    nodeStyle = theme === 'light'
      ? { background: '#ecfdf5', border: '#10b981', color: '#065f46' }
      : { background: '#0b2e24', border: '#10b981', color: '#d1fae5' };
    badgeColor = 'bg-green-600 text-white';
  } else if (data.health === 'warning') {
    nodeStyle = theme === 'light'
      ? { background: '#fffbeb', border: '#d97706', color: '#78350f' }
      : { background: '#422006', border: '#f59e0b', color: '#fde68a' };
    badgeColor = 'bg-amber-500 text-amber-950';
  } else if (data.health === 'critical') {
    nodeStyle = theme === 'light'
      ? { background: '#fff7ed', border: '#ea580c', color: '#7c2d12' }
      : { background: '#431407', border: '#f97316', color: '#fed7aa' };
    badgeColor = 'bg-orange-500 text-white';
  }

  const borderStyle = data.isSelected 
    ? '#3b82f6' 
    : nodeStyle.border;

  const { 
    isFocusMode = false, 
    isGlowing = false, 
    isPulsing = false 
  } = data;

  let boxShadowStyle: string | undefined = undefined;
  if (isGlowing) {
    boxShadowStyle = `0 0 12px 3px ${borderStyle}bf, 0 4px 12px rgba(0,0,0,0.25)`;
  } else if (isPulsing) {
    boxShadowStyle = `0 0 12px 3px #dc2626b0, 0 4px 12px rgba(0,0,0,0.2)`;
  } else if (data.isSelected) {
    boxShadowStyle = '0 0 0 2px #3b82f640, 0 4px 12px rgba(0,0,0,0.15)';
  } else if (data.health === 'healthy' && !dimmed) {
    boxShadowStyle = '0 0 8px rgba(16, 185, 129, 0.25)';
  }

  const shouldPulse = isPulsing || (data.impactRole === 'root' && !isFocusMode);

  return (
    <div
      className={`rounded-lg min-w-[150px] max-w-[190px] transition-all duration-200 ease-in-out ${shouldPulse ? 'animate-pulse-root' : ''}`}
      style={{
        border: `2px solid ${borderStyle}`,
        background: nodeStyle.background,
        boxShadow: boxShadowStyle,
        transition: 'opacity 200ms ease, border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease',
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400 !w-1.5 !h-1.5 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400 !w-1.5 !h-1.5 !border-0" />

      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-1 mb-1">
          <span
            className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${badgeColor}`}
          >
            {badge}
          </span>
          <span className={`text-[8px] px-1 py-0.5 rounded border ${healthBadgeClass(data.health)}`}>
            {data.health}
          </span>
        </div>

        <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
          {layerLabel(data.layer)}
        </div>
        <div
          className="text-xs font-semibold truncate mt-0.5"
          style={{ color: nodeStyle.color }}
          title={data.label}
        >
          {data.label}
        </div>

        <div className="flex items-center justify-between mt-1.5 gap-1">
          <span className="text-[9px] text-slate-500 dark:text-slate-400 truncate">{data.type}</span>
          {!dimmed && (
            <span
              className="text-[9px] font-mono font-semibold shrink-0 cursor-help"
              style={{ color: nodeStyle.border }}
              title="Failure Propagation Risk: Probability of this component degrading or propagating failure in the current incident topology"
            >
              Risk: {data.riskScore.toFixed(0)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(BlastRadiusNode);
