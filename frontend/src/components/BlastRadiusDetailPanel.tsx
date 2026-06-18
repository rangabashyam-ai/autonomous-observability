import { useState, useEffect } from 'react';
import type { BlastRadiusResult } from '../types/intelligence';
import type { DependencyGraph } from '../types/api';
import type { BlastEdgeDetail, BlastNodeDetail } from '../utils/blastGraphDetails';
import type { BlastImpactRole } from '../utils/blastGraphLayout';
import { resolveEdgeKind } from '../utils/blastGraphLayout';
import { healthBadgeClass, layerLabel } from '../utils/colors';
import { mutedText } from './ui';

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [
    h.toString().padStart(2, '0'),
    m.toString().padStart(2, '0'),
    s.toString().padStart(2, '0')
  ].join(':');
}

type Selection =
  | { type: 'node'; detail: BlastNodeDetail }
  | { type: 'edge'; detail: BlastEdgeDetail }
  | null;

interface Props {
  rootId: string;
  rootLabel: string;
  selection: Selection;
  onSelectNode: (nodeId: string) => void;
  onSetRootCause: (nodeId: string) => void;
  result?: BlastRadiusResult | null;
  graph?: DependencyGraph | null;
  isExpanded?: boolean;
  onToggle?: () => void;
}

const ROLE_BADGE: Record<BlastImpactRole, string> = {
  root: 'bg-red-600 text-white',
  impacted: 'bg-orange-500 text-white',
  downstream: 'bg-amber-500 text-amber-950',
  upstream: 'bg-indigo-600 text-white',
  infrastructure: 'bg-violet-600 text-white',
  at_risk: 'bg-yellow-600 text-yellow-950',
  context: 'bg-slate-500 text-white',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
      <p className={`text-xs uppercase tracking-wider font-semibold ${mutedText} mb-1`}>{label}</p>
      <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{children}</div>
    </div>
  );
}


export function SelectedComponentPreview({
  selection,
}: {
  selection: Selection;
}) {
  if (!selection) return null;

  if (selection.type === 'node') {
    const d = selection.detail;
    return (
      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
        <p className={`text-xs uppercase font-semibold ${mutedText} mb-1`}>Selected in graph</p>
        <p className="text-base font-semibold text-slate-900 dark:text-white truncate">{d.label}</p>
        <div className="flex flex-wrap gap-1 mt-1.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${ROLE_BADGE[d.impactRole]}`}>
            {d.impactRoleLabel}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${healthBadgeClass(d.health)}`}>
            {d.health}
          </span>
        </div>
      </div>
    );
  }

  const e = selection.detail;
  return (
    <div className="p-3 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl">
      <p className={`text-xs uppercase font-semibold ${mutedText} mb-1`}>Selected connection</p>
      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
        {e.sourceLabel} → {e.targetLabel}
      </p>
      <p className={`text-xs ${mutedText} mt-1`}>{e.kindLabel}</p>
    </div>
  );
}
export function IncidentPropagationSummary({
  result,
  rootLabel,
  selection,
  alerts: _alerts = ['CPU Saturation', 'API Error Spike'],
  symptoms: _symptoms = ['Latency Increase', 'Retry Storm'],
  isExpanded: controlledExpanded,
  onToggle,
}: {
  result: BlastRadiusResult;
  rootLabel: string;
  selection: Selection;
  alerts?: string[];
  symptoms?: string[];
  isExpanded?: boolean;
  onToggle?: () => void;
}) {
  const [elapsed, setElapsed] = useState(14 * 60 + 32);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const toggleExpanded = onToggle || (() => setInternalExpanded((prev) => !prev));

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  const selectedNode = selection?.type === 'node' ? selection.detail : null;
  const selectedEdge = selection?.type === 'edge' ? selection.detail : null;

  const downstreamCount = result.likely_downstream_services.length;
  let propagationText = "";
  let propagationTextClass = "";
  let propagationFillWidth = "";
  let newServicesCount = 0;

  if (downstreamCount >= 3) {
    propagationText = "Spreading Fast";
    propagationTextClass = "text-red-500 dark:text-red-400 font-bold";
    propagationFillWidth = "85%";
    newServicesCount = downstreamCount;
  } else if (downstreamCount > 0) {
    propagationText = "Slowing Down";
    propagationTextClass = "text-amber-500 dark:text-amber-450 font-semibold";
    propagationFillWidth = "45%";
    newServicesCount = downstreamCount;
  } else {
    propagationText = "Contained";
    propagationTextClass = "text-green-500 dark:text-green-400 font-semibold";
    propagationFillWidth = "15%";
    newServicesCount = 0;
  }
  return (
    <div className="bg-white dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-sm overflow-hidden transition-all duration-300 ease-in-out">
      {/* COLLAPSED STATE DESIGN / SUMMARY BAR */}
      <div 
        onClick={toggleExpanded}
        className="flex items-center justify-between px-4 cursor-pointer select-none hover:bg-[#f9fafb] dark:hover:bg-slate-750/30 h-[48px] gap-2"
      >
        {/* Left Side: Warning Icon + "{rootLabel} failed" */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-red-500 shrink-0 text-base" role="img" aria-label="warning">⚠</span>
          <span className="font-bold text-red-655 dark:text-red-455 truncate text-xs sm:text-sm">
            {rootLabel} failed
          </span>
        </div>

        {/* Middle: Badges */}
        <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto whitespace-nowrap px-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-955/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50">
            {result.severity_recommendation}
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-350 border border-slate-205 dark:border-slate-700">
            {result.issue_scope.charAt(0).toUpperCase() + result.issue_scope.slice(1)}
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-955/20 text-red-550 border border-red-500/20">
            {result.business_impact_score}/100
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-955/20 text-blue-650 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30">
            ~{result.impacted_customers_estimate.toLocaleString()} customers
          </span>
        </div>

        {/* Right Side: Propagation Status + Expand Button */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs ${propagationTextClass}`}>
            {propagationText}
          </span>
          <button
            type="button"
            className="text-slate-400 dark:text-slate-500 hover:text-slate-655 dark:hover:text-slate-300 p-1 rounded transition-transform duration-300"
            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            ▼
          </button>
        </div>
      </div>

      {/* EXPANDED STATE */}
      <div 
        className={`transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[50vh] border-t border-slate-150 dark:border-slate-700/60 overflow-y-auto' : 'max-h-0 overflow-hidden'
        }`}
      >
        <div className="p-4 space-y-2 text-slate-655 dark:text-slate-300 rounded-b-lg">
          <div className="flex items-center gap-1.5 pb-1.5 border-b border-slate-100 dark:border-slate-700/60">
            <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span className="font-bold text-slate-900 dark:text-white">Dynamic Impact Analysis Details</span>
          </div>

          <div className="grid grid-cols-3 gap-x-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50">
            <span className="font-medium text-slate-400">What failed?:</span>
            <span className="col-span-2 text-red-655 dark:text-red-400 font-semibold">{rootLabel}</span>
          </div>

          <div className="grid grid-cols-3 gap-x-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50 items-center">
            <span className="font-medium text-slate-400">Why failed?:</span>
            <div 
              className="col-span-2 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-[9px] font-semibold py-0.5"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              <span className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-955/20 text-red-655 dark:text-red-400 border border-red-100 dark:border-red-900/30">
                CPU Saturation
              </span>
              <span className="text-slate-400 shrink-0">→</span>
              <span className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-955/20 text-red-655 dark:text-red-400 border border-red-100 dark:border-red-900/30">
                API Error Spike
              </span>
              <span className="text-slate-400 shrink-0">→</span>
              <span className="px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-955/20 text-orange-600 dark:text-orange-400 border border-orange-100 dark:border-orange-900/30">
                Latency Increase
              </span>
              <span className="text-slate-400 shrink-0">→</span>
              <span className="px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-955/20 text-orange-600 dark:text-orange-400 border border-orange-100 dark:border-orange-900/30">
                Retry Storm
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-x-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50">
            <span className="font-medium text-slate-400">Root Cause:</span>
            <span className="col-span-2 font-mono text-slate-850 dark:text-slate-200 bg-slate-100 dark:bg-slate-900 px-1 py-0.2 rounded w-fit">{rootLabel}</span>
          </div>

          <div className="grid grid-cols-3 gap-x-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50">
            <span className="font-medium text-slate-400">Directly Impacted:</span>
            <span className="col-span-2 text-orange-600 dark:text-orange-400">
              {result.currently_impacted_services.length} services ({result.currently_impacted_services.join(', ')})
            </span>
          </div>

          <div className="grid grid-cols-3 gap-x-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50">
            <span className="font-medium text-slate-400">Downstream:</span>
            <span className="col-span-2 text-amber-600 dark:text-amber-400">
              {result.likely_downstream_services.length > 0 ? result.likely_downstream_services.join(', ') : 'none affected'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-x-2 py-1 border-b border-slate-50 dark:border-slate-800/50 items-center">
            <span className="font-medium text-slate-400">Propagation Speed:</span>
            <div className="col-span-2 space-y-1">
              <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-slate-450 dark:text-slate-500">
                <span>Spreading</span>
                <span className={propagationTextClass}>{propagationText}</span>
                <span>Contained</span>
              </div>
              
              <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden relative">
                <div 
                  className={`h-full transition-all duration-500 ${
                    propagationText === 'Contained'
                      ? 'bg-emerald-500'
                      : propagationText === 'Slowing Down'
                        ? 'bg-amber-500'
                        : 'bg-red-500 animate-pulse'
                  }`}
                  style={{ width: propagationFillWidth }}
                />
              </div>
              
              <p className="text-[9px] text-slate-455 dark:text-slate-500 font-medium leading-none">
                {newServicesCount} new service{newServicesCount !== 1 ? 's' : ''} affected in last 5 min
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-x-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50">
            <span className="font-medium text-slate-400">Biz Impact:</span>
            <span className="col-span-2 font-medium text-slate-800 dark:text-slate-200">
              Score: <span className="font-bold text-red-500">{result.business_impact_score}/100</span> (~{result.impacted_customers_estimate.toLocaleString()} customers affected)
            </span>
          </div>

          {/* Live Impact Metrics Section */}
          <div className="pt-3 mt-2 border-t border-slate-150 dark:border-slate-700/60">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Live Impact Metrics</span>
              
              {/* Live incident timer with a blinking dot */}
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                </span>
                <span className="text-[11px] font-mono font-bold text-red-655 dark:text-red-400 animate-pulse" title="Time since first alert">
                  {formatTime(elapsed)}
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              {/* 1. Sparkline chart */}
              <div className="p-2 bg-slate-50 dark:bg-slate-900/35 border border-slate-100 dark:border-slate-800/60 rounded-xl">
                <div className="flex items-center justify-between mb-1.5 text-[9px]">
                  <span className="text-slate-455 dark:text-slate-500 font-semibold uppercase tracking-wider truncate max-w-[130px]" title={rootLabel}>
                    {rootLabel} Error Rate
                  </span>
                  <span className="text-slate-400 dark:text-slate-500 font-medium font-mono">
                    Last 15m
                  </span>
                </div>
                
                <div className="flex items-end justify-between gap-3 h-8">
                  <div className="flex-1 h-full min-w-0">
                    <svg className="w-full h-full overflow-visible" viewBox="0 0 160 40" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M 0 39.6 L 10.7 39.4 L 21.3 39.2 L 32.0 39.3 L 42.7 38.8 L 53.3 35.2 L 64.0 28.8 L 74.7 18.0 L 85.3 8.8 L 96.0 3.6 L 106.7 2.4 L 117.3 2.8 L 128.0 2.4 L 138.7 2.0 L 149.3 2.4 L 160.0 2.4 L 160.0 40 L 0 40 Z"
                        fill="url(#sparkline-grad)"
                      />
                      <path
                        d="M 0 39.6 L 10.7 39.4 L 21.3 39.2 L 32.0 39.3 L 42.7 38.8 L 53.3 35.2 L 64.0 28.8 L 74.7 18.0 L 85.3 8.8 L 96.0 3.6 L 106.7 2.4 L 117.3 2.8 L 128.0 2.4 L 138.7 2.0 L 149.3 2.4 L 160.0 2.4"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx="160" cy="2.4" r="2.5" fill="#ef4444" className="animate-pulse" />
                    </svg>
                  </div>
                  <div className="flex flex-col justify-end text-right shrink-0">
                    <span className="text-[8px] uppercase tracking-wider text-slate-400 dark:text-slate-500 leading-none">Max</span>
                    <span className="text-xs font-bold text-red-500 dark:text-red-400 font-mono">94%</span>
                  </div>
                </div>
              </div>

              {/* 2. Inline metric pills */}
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col p-1 rounded-lg bg-red-50/50 dark:bg-red-955/20 border border-red-100 dark:border-red-900/30 text-center">
                  <span className="text-[9px] uppercase tracking-wider text-red-500/80 font-bold">Error Rate</span>
                  <span className="text-xs font-mono font-bold text-red-655 dark:text-red-400 mt-0.5">94%</span>
                </div>
                <div className="flex flex-col p-1 rounded-lg bg-orange-50/50 dark:bg-orange-955/20 border border-orange-100 dark:border-orange-900/30 text-center">
                  <span className="text-[9px] uppercase tracking-wider text-orange-550 dark:text-orange-455 font-bold">Latency P99</span>
                  <span className="text-xs font-mono font-bold text-orange-600 dark:text-orange-400 mt-0.5">2340ms</span>
                </div>
                <div className="flex flex-col p-1 rounded-lg bg-yellow-50/50 dark:bg-yellow-955/20 border border-yellow-150 dark:border-yellow-900/30 text-center">
                  <span className="text-[9px] uppercase tracking-wider text-yellow-600/85 dark:text-yellow-500/80 font-bold">CPU Usage</span>
                  <span className="text-xs font-mono font-bold text-yellow-655 dark:text-yellow-400 mt-0.5">98%</span>
                </div>
              </div>

              {/* 4. Severity progression timeline bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[9px] uppercase tracking-wider font-semibold text-slate-455 dark:text-slate-500">
                  <span>Timeline Progression</span>
                  <span className="font-bold text-red-550 dark:text-red-455">Critical Status</span>
                </div>
                <div className="relative h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-900 flex overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: '35%' }} title="Normal" />
                  <div className="h-full bg-amber-500" style={{ width: '35%' }} title="Degraded" />
                  <div className="h-full bg-red-500 relative flex items-center justify-end" style={{ width: '30%' }} title="Critical">
                    <span className="absolute right-0 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  </div>
                </div>
                <div className="flex justify-between text-[8px] text-slate-455 dark:text-slate-500 uppercase tracking-wider font-medium">
                  <span>T-15m (Normal)</span>
                  <span>T-10m (Degraded)</span>
                  <span>Now (Critical)</span>
                </div>
              </div>
            </div>
          </div>

          {selectedNode && (
            <div className="mt-2 p-2 bg-blue-50/50 dark:bg-blue-955/20 border border-blue-100 dark:border-blue-900/40 rounded-lg text-xs">
              <p className="font-semibold text-blue-800 dark:text-blue-300">Selected Node: {selectedNode.label}</p>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                Role: <span className="font-medium text-slate-700 dark:text-slate-200">{selectedNode.impactRoleLabel}</span> | 
                Health: <span className="font-medium text-slate-700 dark:text-slate-200">{selectedNode.health}</span>
              </p>
              <p className="mt-1 text-slate-655 dark:text-slate-300 leading-normal">{selectedNode.currentImpact} {selectedNode.statusExplanation}</p>
            </div>
          )}

          {selectedEdge && (
            <div className="mt-2 p-2 bg-violet-50/50 dark:bg-violet-955/25 border border-violet-100 dark:border-violet-900/40 rounded-lg text-xs">
              <p className="font-semibold text-violet-800 dark:text-violet-300">Selected Connection: {selectedEdge.sourceLabel} → {selectedEdge.targetLabel}</p>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">Type: {selectedEdge.kindLabel} ({selectedEdge.relationship})</p>
              <p className="mt-1 text-slate-655 dark:text-slate-300 leading-normal">{selectedEdge.propagationDirection} {selectedEdge.whyItMatters}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BlastRadiusDetailPanel({
  rootId,
  rootLabel,
  selection,
  onSelectNode,
  onSetRootCause,
  result,
  graph,
  isExpanded: controlledExpanded,
  onToggle,
}: Props) {
  const [internalExpanded, setInternalExpanded] = useState(true);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const toggleExpanded = onToggle || (() => setInternalExpanded((prev) => !prev));

  const selectedNode = selection?.type === 'node' ? selection.detail : null;
  const selectedEdge = selection?.type === 'edge' ? selection.detail : null;

  // Colors for collapsed node pill
  let pillBg = "bg-green-50 dark:bg-green-955/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900/50";
  let dotColor = "text-green-500";
  if (selectedNode) {
    if (selectedNode.id === rootId || selectedNode.impactRole === 'root') {
      pillBg = "bg-red-50 dark:bg-red-955/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50";
      dotColor = "text-red-500";
    } else if (selectedNode.impactRole === 'impacted' || selectedNode.health === 'critical' || selectedNode.health === 'warning') {
      pillBg = "bg-orange-50 dark:bg-orange-955/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-900/50";
      dotColor = "text-orange-500";
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-sm overflow-hidden transition-all duration-300 ease-in-out">
      {/* COLLAPSED STATE DESIGN / SUMMARY BAR */}
      <div 
        onClick={toggleExpanded}
        className="flex items-center justify-between px-4 cursor-pointer select-none hover:bg-[#f9fafb] dark:hover:bg-slate-750/30 h-[48px] gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-base">🔧</span>
          <span className="font-bold text-slate-850 dark:text-slate-250 truncate text-xs sm:text-sm">
            Component Inspector
          </span>
        </div>

        {selectedNode ? (
          <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto whitespace-nowrap px-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pillBg}`}>
              <span className={`${dotColor} mr-1`}>●</span>{selectedNode.label}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              selectedNode.health === 'healthy' 
                ? 'bg-green-50 dark:bg-green-955/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900/50' 
                : selectedNode.health === 'warning' 
                  ? 'bg-yellow-50 dark:bg-yellow-955/20 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-900/50' 
                  : 'bg-red-50 dark:bg-red-955/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50'
            }`}>
              {selectedNode.health}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-350 border border-slate-205 dark:border-slate-700">
              {selectedNode.riskScore.toFixed(0)}% risk
            </span>
          </div>
        ) : selectedEdge ? (
          <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto whitespace-nowrap px-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-955/20 text-violet-750 dark:text-violet-400 border border-violet-250 dark:border-violet-900/50">
              <span className="text-violet-500 mr-1">●</span>{selectedEdge.sourceLabel} → {selectedEdge.targetLabel}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-350 border border-slate-205 dark:border-slate-700">
              {selectedEdge.kindLabel}
            </span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto whitespace-nowrap px-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
              No component selected
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="text-slate-400 dark:text-slate-500 hover:text-slate-655 dark:hover:text-slate-300 p-1 rounded transition-transform duration-300"
            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            ▼
          </button>
        </div>
      </div>

      {/* EXPANDED CONTENT WRAPPER */}
      <div 
        className={`transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[50vh] border-t border-slate-150 dark:border-slate-700/60 overflow-y-auto' : 'max-h-0 overflow-hidden'
        }`}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 shrink-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Component Inspector</h3>
          <p className={`text-xs ${mutedText} mt-0.5`}>
            Root: <span className="text-red-600 dark:text-red-400 font-semibold">{rootLabel}</span>
          </p>
        </div>

        <div className="p-4">
          {!selection ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-2 py-8">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Nothing selected</p>
              <p className={`text-xs ${mutedText} mt-1 max-w-[200px]`}>
                Click a node or dependency arrow to inspect its role in the incident.
              </p>
            </div>
          ) : selection.type === 'node' ? (
            <NodeDetail
              detail={selection.detail}
              rootId={rootId}
              rootLabel={rootLabel}
              onSelectNode={onSelectNode}
              onSetRootCause={onSetRootCause}
              result={result}
              graph={graph}
            />
          ) : (
            <EdgeDetail detail={selection.detail} rootLabel={rootLabel} onSelectNode={onSelectNode} />
          )}
        </div>
      </div>
    </div>
  );
}


function getRiskGaugeColor(score: number) {
  if (score > 50) return { stroke: '#ef4444', text: 'text-red-600 dark:text-red-400' };
  if (score >= 20) return { stroke: '#f97316', text: 'text-orange-500 dark:text-orange-400' };
  return { stroke: '#22c55e', text: 'text-green-600 dark:text-green-400' };
}

function getMetricValues(id: string, health: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  if (health === 'critical') {
    const errorRate = 85 + (hash % 14);
    const latency = 1800 + (hash % 1100);
    const cpu = 90 + (hash % 10);
    return {
      errorRate: `${errorRate}%`,
      latency: `${latency}ms`,
      cpu: `${cpu}%`,
      severity: 'critical' as const
    };
  } else if (health === 'warning') {
    const errorRate = 4 + (hash % 12);
    const latency = 400 + (hash % 450);
    const cpu = 65 + (hash % 20);
    return {
      errorRate: `${errorRate}%`,
      latency: `${latency}ms`,
      cpu: `${cpu}%`,
      severity: 'warning' as const
    };
  } else {
    const errorRate = (hash % 2) === 0 ? '0.0%' : '0.1%';
    const latency = 25 + (hash % 50);
    const cpu = 15 + (hash % 30);
    return {
      errorRate,
      latency: `${latency}ms`,
      cpu: `${cpu}%`,
      severity: 'healthy' as const
    };
  }
}

function getSparklinePath(id: string, metric: string, health: string): string {
  let hash = 0;
  const seedStr = id + metric;
  for (let i = 0; i < seedStr.length; i++) {
    hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  const points: number[] = [];
  const count = 12;
  if (health === 'critical') {
    for (let i = 0; i < count; i++) {
      if (i < 4) {
        points.push(17 - (hash % 3));
      } else if (i < 8) {
        points.push(10 - ((hash + i) % 5));
      } else {
        points.push(2 + ((hash + i) % 4));
      }
    }
  } else if (health === 'warning') {
    for (let i = 0; i < count; i++) {
      points.push(8 + ((hash + i * 3) % 8));
    }
  } else {
    for (let i = 0; i < count; i++) {
      points.push(16 + ((hash + i) % 3));
    }
  }

  const width = 100;
  const step = width / (count - 1);
  return points.map((y, idx) => `${idx === 0 ? 'M' : 'L'} ${(idx * step).toFixed(1)} ${y.toFixed(1)}`).join(' ');
}

function computePropagationPath(
  selectedId: string,
  rootId: string,
  graph: DependencyGraph | null | undefined,
  blast: BlastRadiusResult | null | undefined
) {
  if (!graph || !blast) {
    return { path: [selectedId], edgeSeqMap: new Map<string, number>() };
  }

  const parentMap = new Map<string, string>();
  const edgeSeqMap = new Map<string, number>();

  const bfsQueue = [rootId];
  const bfsVisited = new Set<string>([rootId]);
  let seqCount = 1;


  while (bfsQueue.length > 0) {
    const current = bfsQueue.shift()!;
    const outgoing = graph.edges
      .filter(e => e.source === current)
      .map(e => {
        const kind = resolveEdgeKind(e, blast, rootId, graph.edges);
        return { edge: e, kind };
      })
      .filter(x => x.kind === 'impact' && !bfsVisited.has(x.edge.target));
    
    outgoing.sort((a, b) => a.edge.target.localeCompare(b.edge.target));

    for (const x of outgoing) {
      bfsVisited.add(x.edge.target);
      parentMap.set(x.edge.target, current);
      edgeSeqMap.set(`${current}->${x.edge.target}`, seqCount++);
      bfsQueue.push(x.edge.target);
    }
  }

  if (!bfsVisited.has(selectedId)) {
    return { path: [], edgeSeqMap };
  }

  const path: string[] = [];
  let curr: string | undefined = selectedId;
  while (curr) {
    path.unshift(curr);
    curr = parentMap.get(curr);
  }

  return { path, edgeSeqMap };
}

function NodeDetail({
  detail: d,
  rootId,
  rootLabel,
  onSelectNode,
  onSetRootCause,
  result,
  graph,
}: {
  detail: BlastNodeDetail;
  rootId: string;
  rootLabel: string;
  onSelectNode: (id: string) => void;
  onSetRootCause: (id: string) => void;
  result?: BlastRadiusResult | null;
  graph?: DependencyGraph | null;
}) {
  const isRoot = d.id === rootId;
  const metrics = getMetricValues(d.id, d.health);
  const { path, edgeSeqMap } = computePropagationPath(d.id, rootId, graph, result);

  const getDepHealth = (depId: string): string => {
    const node = graph?.nodes.find(n => n.id === depId);
    return node?.health ?? 'healthy';
  };

  const renderHealthBadge = (health: string) => {
    if (health === 'healthy') {
      return (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-50 dark:bg-green-955/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900/30">
          healthy
        </span>
      );
    } else {
      return (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-955/20 text-red-650 dark:text-red-400 border border-red-200 dark:border-red-900/30 animate-pulse">
          impacted
        </span>
      );
    }
  };

  const radius = 9;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (Math.min(100, Math.max(0, d.riskScore)) / 100) * circ;
  const riskColor = getRiskGaugeColor(d.riskScore);

  const getMarkerPosition = (health: string) => {
    if (health === 'critical') return '85%';
    if (health === 'warning') return '50%';
    return '15%';
  };

  const handleActionClick = (actionName: string) => {
    alert(`Action executed: ${actionName} for component ${d.label}`);
  };

  return (
    <div className="space-y-4">
      {/* SECTION 1 - HEADER */}
      <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-lg font-bold text-slate-900 dark:text-white leading-tight truncate" title={d.label}>
              {d.label}
            </h4>
            <p className={`text-xs font-mono ${mutedText} truncate mt-0.5`}>
              {d.id}
            </p>
          </div>
          
          {/* Risk Gauge */}
          <div className="flex items-center gap-1.5 shrink-0" title={`Failure Risk Score: ${d.riskScore.toFixed(0)}%`}>
            <div className="relative flex items-center justify-center">
              <svg className="w-8 h-8 transform -rotate-90" viewBox="0 0 24 24">
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  className="stroke-slate-100 dark:stroke-slate-800"
                  strokeWidth="2.5"
                  fill="transparent"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  stroke={riskColor.stroke}
                  strokeWidth="2.5"
                  fill="transparent"
                  strokeDasharray={circ}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                />
              </svg>
              <span className={`absolute text-[9px] font-mono font-bold ${riskColor.text}`}>
                {Math.round(d.riskScore)}
              </span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[9px] font-bold text-slate-400 uppercase">Risk</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {/* Health Pill */}
          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
            d.health === 'critical' 
              ? 'bg-red-500/10 text-red-500 border-red-500/20' 
              : d.health === 'warning'
                ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                : 'bg-green-500/10 text-green-500 border-green-500/20'
          }`}>
            {d.health}
          </span>

          {/* Root Cause badge */}
          {isRoot ? (
            <span className="text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-red-650 text-white shadow-sm">
              ROOT CAUSE
            </span>
          ) : (
            <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full ${ROLE_BADGE[d.impactRole]}`}>
              {d.impactRoleLabel}
            </span>
          )}

          {/* Business Service in gray / layer label */}
          <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-205 dark:border-slate-700/50">
            {layerLabel(d.layer)}
          </span>
        </div>
      </div>

      {/* SECTION 2 - HEALTH METRICS */}
      <div className="py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider mb-2">
          Health Metrics
        </div>
        <div className="grid grid-cols-3 gap-2">
          {/* Error Rate */}
          <div className="flex flex-col justify-between p-2 rounded-xl bg-red-50/70 dark:bg-red-950/20 border border-red-100/50 dark:border-red-900/30 text-center min-h-[64px]">
            <span className="text-[9px] uppercase tracking-wider text-red-500 dark:text-red-400 font-bold leading-none">Error Rate</span>
            <span className="text-sm font-mono font-bold text-red-600 dark:text-red-400 my-1">{metrics.errorRate}</span>
            <div className="h-4 w-full">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 100 20" preserveAspectRatio="none">
                <path
                  d={getSparklinePath(d.id, 'error', d.health)}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          {/* Latency */}
          <div className="flex flex-col justify-between p-2 rounded-xl bg-orange-50/70 dark:bg-orange-950/20 border border-orange-100/50 dark:border-orange-900/30 text-center min-h-[64px]">
            <span className="text-[9px] uppercase tracking-wider text-orange-550 dark:text-orange-400 font-bold leading-none">Latency P99</span>
            <span className="text-sm font-mono font-bold text-orange-600 dark:text-orange-400 my-1">{metrics.latency}</span>
            <div className="h-4 w-full">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 100 20" preserveAspectRatio="none">
                <path
                  d={getSparklinePath(d.id, 'latency', d.health)}
                  fill="none"
                  stroke="#f97316"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          {/* CPU Usage */}
          <div className="flex flex-col justify-between p-2 rounded-xl bg-yellow-50/60 dark:bg-yellow-950/20 border border-yellow-150/50 dark:border-yellow-900/30 text-center min-h-[64px]">
            <span className="text-[9px] uppercase tracking-wider text-yellow-600/85 dark:text-yellow-400 font-bold leading-none">CPU Usage</span>
            <span className="text-sm font-mono font-bold text-yellow-650 dark:text-yellow-450 my-1">{metrics.cpu}</span>
            <div className="h-4 w-full">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 100 20" preserveAspectRatio="none">
                <path
                  d={getSparklinePath(d.id, 'cpu', d.health)}
                  fill="none"
                  stroke="#eab308"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3 - DEPENDENCY FLOW */}
      <div className="py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider mb-2">
          Dependency Flow
        </div>
        
        {path && path.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1 text-[11px] leading-relaxed">
              {path.map((nodeId, index) => {
                const isNodeRoot = nodeId === rootId;
                const nodeLabel = nodeId === rootId ? rootLabel : (graph?.nodes.find(n => n.id === nodeId)?.label ?? nodeId);
                const badgeColor = isNodeRoot 
                  ? 'bg-red-500 text-white dark:bg-red-650 dark:text-red-50' 
                  : 'bg-orange-500 text-white dark:bg-orange-600 dark:text-orange-50';
                
                return (
                  <div key={nodeId} className="flex items-center gap-1.5 flex-wrap">
                    {index > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-slate-350 dark:text-slate-600 font-bold">--</span>
                        {/* Propagation sequence order badge */}
                        <span className="w-4 h-4 rounded-full bg-white dark:bg-slate-900 border border-red-500 text-red-500 flex items-center justify-center font-bold text-[9px] shadow-sm shrink-0" title="Propagation Step">
                          {edgeSeqMap.get(`${path[index - 1]}->${nodeId}`) ?? index}
                        </span>
                        <span className="text-slate-350 dark:text-slate-600 font-bold">--&gt;</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectNode(nodeId)}
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold shadow-sm transition-all hover:scale-105 active:scale-95 ${badgeColor}`}
                    >
                      {nodeLabel}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Branching Downstream Dependencies if multiple */}
            {d.downstream.length > 0 && (
              <div className="pl-3 border-l-2 border-slate-105 dark:border-slate-800 space-y-1.5 mt-2">
                <div className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Branching Downstream
                </div>
                <div className="flex flex-col gap-1.5">
                  {d.downstream.map((dep) => {
                    const seqNum = edgeSeqMap.get(`${d.id}->${dep.id}`);
                    return (
                      <div key={dep.id} className="flex items-center gap-1.5">
                        <div className="flex items-center gap-1 text-slate-350 dark:text-slate-600 text-xs shrink-0 font-medium">
                          <span>└─</span>
                          {seqNum !== undefined ? (
                            <span className="w-3.5 h-3.5 rounded-full bg-white dark:bg-slate-900 border border-red-500 text-red-500 flex items-center justify-center font-bold text-[8px] shadow-xs">
                              {seqNum}
                            </span>
                          ) : (
                            <span>─</span>
                          )}
                          <span>─&gt;</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectNode(dep.id)}
                          className="px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-955/40 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-900/40 hover:bg-orange-200 dark:hover:bg-orange-950/60 transition-colors text-[10px] font-semibold"
                        >
                          {dep.label}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-2.5 py-0.5 rounded-full bg-slate-500 text-white font-semibold text-[11px] shadow-sm"
              >
                {d.label}
              </button>
              <span className="text-xs text-slate-400 italic">
                Outside active propagation path
              </span>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 4 - STATUS TIMELINE */}
      <div className="py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider mb-2">
          Status Timeline
        </div>
        <div className="space-y-1.5">
          <div className="relative h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-900 flex overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: '33.33%' }} title="Normal" />
            <div className="h-full bg-amber-500" style={{ width: '33.33%' }} title="Degraded" />
            <div className="h-full bg-red-500" style={{ width: '33.34%' }} title="Critical" />
            
            {/* Marker Dot */}
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-slate-900 dark:border-white shadow-md transition-all duration-300"
              style={{ left: getMarkerPosition(d.health) }}
            />
          </div>
          
          <div className="flex justify-between text-[8px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
            <span>Normal</span>
            <span>Degraded</span>
            <span>Critical</span>
          </div>
          
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            Incident started 20 min ago
          </p>
        </div>
      </div>

      {/* SECTION 5 - UPSTREAM & DOWNSTREAM DEPENDENCIES */}
      <div className="py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider mb-2">
          Dependencies
        </div>
        <div className="space-y-3">
          {/* Upstream */}
          <div>
            <div className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
              Upstream (Incoming)
            </div>
            {d.upstream.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 italic">None identified</p>
            ) : (
              <ul className="space-y-1">
                {d.upstream.map((up) => {
                  const health = getDepHealth(up.id);
                  return (
                    <li key={up.id} className="flex items-center justify-between gap-2 p-1 rounded-lg border border-slate-100/70 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/25">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-slate-400 shrink-0 font-bold" title="Upstream connection">←</span>
                        <button
                          type="button"
                          onClick={() => onSelectNode(up.id)}
                          className="font-semibold text-slate-700 dark:text-slate-300 hover:text-blue-500 truncate text-[11px]"
                        >
                          {up.label}
                        </button>
                        <span className="text-[8px] font-mono px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200/40 dark:border-slate-700/50">
                          {up.relationship.toLowerCase().replace(/_/g, ' ')}
                        </span>
                      </div>
                      {renderHealthBadge(health)}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Downstream */}
          <div>
            <div className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
              Downstream (Outbound)
            </div>
            {d.downstream.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 italic">None identified</p>
            ) : (
              <ul className="space-y-1">
                {d.downstream.map((down) => {
                  const health = getDepHealth(down.id);
                  return (
                    <li key={down.id} className="flex items-center justify-between gap-2 p-1 rounded-lg border border-slate-100/70 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/25">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-orange-500 shrink-0 font-bold" title="Downstream connection">→</span>
                        <button
                          type="button"
                          onClick={() => onSelectNode(down.id)}
                          className="font-semibold text-slate-700 dark:text-slate-300 hover:text-blue-500 truncate text-[11px]"
                        >
                          {down.label}
                        </button>
                        <span className="text-[8px] font-mono px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200/40 dark:border-slate-700/50">
                          {down.relationship.toLowerCase().replace(/_/g, ' ')}
                        </span>
                      </div>
                      {renderHealthBadge(health)}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 6 - QUICK ACTION BUTTONS */}
      <div className="py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider mb-2">
          Quick Actions
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleActionClick('Investigate')}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-500 text-blue-600 dark:text-blue-450 hover:bg-blue-500 hover:text-white dark:hover:bg-blue-600/80 transition-colors text-xs font-semibold"
          >
            <span>🔍</span> Investigate
          </button>
          <button
            type="button"
            onClick={() => handleActionClick('Alert Team')}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500 text-red-650 dark:text-red-400 hover:bg-red-500 hover:text-white dark:hover:bg-red-600/80 transition-colors text-xs font-semibold"
          >
            <span>📢</span> Alert Team
          </button>
          <button
            type="button"
            onClick={() => handleActionClick('View Logs')}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500 text-indigo-650 dark:text-indigo-400 hover:bg-indigo-500 hover:text-white dark:hover:bg-indigo-600/80 transition-colors text-xs font-semibold"
          >
            <span>📋</span> View Logs
          </button>
          <button
            type="button"
            onClick={() => handleActionClick('Run Runbook')}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500 text-amber-650 dark:text-amber-450 hover:bg-amber-500 hover:text-white dark:hover:bg-amber-600/80 transition-colors text-xs font-semibold"
          >
            <span>⚡</span> Run Runbook
          </button>
        </div>
        
        {/* Re-analyze cause button if not root cause */}
        {!isRoot && (
          <div className="mt-2.5">
            <button
              type="button"
              onClick={() => onSetRootCause(d.id)}
              className="w-full py-1.5 rounded-lg border border-slate-350 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-xs font-semibold"
            >
              Re-analyze with this as root cause
            </button>
          </div>
        )}
      </div>

      {/* SECTION 7 - WHY AFFECTED & RELATIONSHIP */}
      <div className="py-2">
        <div className="text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider mb-2">
          Analysis Details
        </div>
        <div className="flex gap-2.5 p-3 rounded-xl bg-blue-50/70 dark:bg-blue-955/20 border border-blue-150/60 dark:border-blue-900/40">
          <div className="text-blue-550 dark:text-blue-400 shrink-0 mt-0.5">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="space-y-2 text-[13px] text-slate-600 dark:text-slate-350 leading-relaxed">
            <div>
              <span className="font-bold text-slate-850 dark:text-slate-200 block mb-0.5">{d.statusLabel}</span>
              {d.statusExplanation}
            </div>
            <div className="border-t border-blue-100/50 dark:border-blue-900/30 pt-1.5">
              <span className="font-bold text-slate-850 dark:text-slate-200 block mb-0.5">Relationship to Root Cause</span>
              {d.rootCauseRelation}
            </div>
            <div className="border-t border-blue-100/50 dark:border-blue-900/30 pt-1.5">
              <span className="font-bold text-slate-850 dark:text-slate-200 block mb-0.5">Propagation Path</span>
              {d.propagationDirection}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EdgeDetail({
  detail: e,
  rootLabel,
  onSelectNode,
}: {
  detail: BlastEdgeDetail;
  rootLabel: string;
  onSelectNode: (id: string) => void;
}) {
  const kindColors: Record<string, string> = {
    impact: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
    upstream: 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300',
    dependency: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
    context: 'bg-slate-100 dark:bg-slate-800 text-slate-500',
  };

  return (
    <div className="rounded-xl border-2 border-violet-300 dark:border-violet-700 overflow-hidden">
      <div className="px-3 py-3 bg-violet-50 dark:bg-violet-955/30">
        <h4 className="text-base font-bold text-slate-900 dark:text-white">Dependency Connection</h4>
        <span className={`inline-block mt-1.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded ${kindColors[e.kind] ?? ''}`}>
          {e.kindLabel}
        </span>
      </div>

      <div className="px-3 py-2 bg-white dark:bg-slate-800/30">
        <div className="flex items-center gap-1 text-sm font-medium p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/50 mb-1">
          <button type="button" onClick={() => onSelectNode(e.sourceId)} className="text-blue-600 dark:text-blue-400 hover:underline truncate">
            {e.sourceLabel}
          </button>
          <span className="text-slate-400 shrink-0">→</span>
          <button type="button" onClick={() => onSelectNode(e.targetId)} className="text-blue-600 dark:text-blue-400 hover:underline truncate">
            {e.targetLabel}
          </button>
        </div>

        <DetailRow label="What this represents">{e.represents}</DetailRow>
        <DetailRow label="Relationship">
          <span className="font-mono">{e.relationship.replace(/_/g, ' ')}</span>
          <span className={`ml-1.5 ${mutedText}`}>({e.edgeType})</span>
        </DetailRow>
        <DetailRow label="Propagation direction">{e.propagationDirection}</DetailRow>
        <DetailRow label="Why it matters">{e.whyItMatters}</DetailRow>
        <DetailRow label="Relationship to root cause">{e.rootCauseRelation}</DetailRow>
        <p className={`text-[10px] ${mutedText} pt-2`}>
          Incident origin: <span className="font-medium text-red-600 dark:text-red-400">{rootLabel}</span>
        </p>
      </div>
    </div>
  );
}
