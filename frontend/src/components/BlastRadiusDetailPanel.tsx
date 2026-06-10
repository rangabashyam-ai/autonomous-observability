import type { BlastRadiusResult } from '../types/intelligence';
import type { BlastEdgeDetail, BlastNodeDetail } from '../utils/blastGraphDetails';
import type { BlastImpactRole } from '../utils/blastGraphLayout';
import { healthBadgeClass, layerLabel } from '../utils/colors';
import { btnSecondary, mutedText } from './ui';

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

const ROLE_BORDER: Record<BlastImpactRole, string> = {
  root: 'border-red-300 dark:border-red-700',
  impacted: 'border-orange-300 dark:border-orange-700',
  downstream: 'border-amber-300 dark:border-amber-700',
  upstream: 'border-indigo-300 dark:border-indigo-700',
  infrastructure: 'border-violet-300 dark:border-violet-700',
  at_risk: 'border-yellow-300 dark:border-yellow-700',
  context: 'border-slate-300 dark:border-slate-600',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
      <p className={`text-xs uppercase tracking-wider font-semibold ${mutedText} mb-1`}>{label}</p>
      <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{children}</div>
    </div>
  );
}

function DepList({
  items,
  direction,
  onSelect,
}: {
  items: { id: string; label: string; relationship: string }[];
  direction: 'upstream' | 'downstream';
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className={`text-sm ${mutedText}`}>None identified</p>;
  }
  return (
    <ul className="space-y-1.5 mt-1">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className={`w-full text-left text-sm px-2.5 py-1.5 rounded-lg border transition-colors ${
              direction === 'upstream'
                ? 'border-indigo-200 dark:border-indigo-800/80 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200'
                : 'border-amber-200 dark:border-amber-800/80 hover:bg-amber-50 dark:hover:bg-amber-950/50 text-amber-900 dark:text-amber-200'
            }`}
          >
            <span className="font-medium">{item.label}</span>
            <span className={`ml-1.5 ${mutedText}`}>({item.relationship.replace(/_/g, ' ')})</span>
          </button>
        </li>
      ))}
    </ul>
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
  alerts = ['CPU Saturation', 'API Error Spike'],
  symptoms = ['Latency Increase', 'Retry Storm'],
}: {
  result: BlastRadiusResult;
  rootLabel: string;
  selection: Selection;
  alerts?: string[];
  symptoms?: string[];
}) {
  
  const selectedNode = selection?.type === 'node' ? selection.detail : null;
  const selectedEdge = selection?.type === 'edge' ? selection.detail : null;

  return (
    <div className="p-3 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm text-sm">
      <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-slate-100 dark:border-slate-700/60">
        <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <span className="font-bold text-slate-900 dark:text-white">Dynamic Impact Analysis</span>
      </div>

      <div className="space-y-2 text-slate-600 dark:text-slate-300">
        <div className="grid grid-cols-3 gap-x-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50">
          <span className="font-medium text-slate-400">What failed?:</span>
          <span className="col-span-2 text-red-600 dark:text-red-400 font-semibold">{rootLabel}</span>
        </div>

        <div className="grid grid-cols-3 gap-x-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50">
          <span className="font-medium text-slate-400">Why failed?:</span>
          <span className="col-span-2">Triggered by {alerts.join(', ')} ({symptoms.join(', ')})</span>
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

        <div className="grid grid-cols-3 gap-x-2 py-0.5">
          <span className="font-medium text-slate-400">Biz Impact:</span>
          <span className="col-span-2 font-medium text-slate-800 dark:text-slate-200">
            Score: <span className="font-bold text-red-500">{result.business_impact_score}/100</span> (~{result.impacted_customers_estimate.toLocaleString()} customers affected)
          </span>
        </div>

        {selectedNode && (
          <div className="mt-2 p-2 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-lg text-xs">
            <p className="font-semibold text-blue-800 dark:text-blue-300">Selected Node: {selectedNode.label}</p>
            <p className="text-slate-500 dark:text-slate-400 mt-0.5">
              Role: <span className="font-medium text-slate-700 dark:text-slate-200">{selectedNode.impactRoleLabel}</span> | 
              Health: <span className="font-medium text-slate-700 dark:text-slate-200">{selectedNode.health}</span>
            </p>
            <p className="mt-1 text-slate-600 dark:text-slate-300 leading-normal">{selectedNode.currentImpact} {selectedNode.statusExplanation}</p>
          </div>
        )}

        {selectedEdge && (
          <div className="mt-2 p-2 bg-violet-50/50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40 rounded-lg text-xs">
            <p className="font-semibold text-violet-800 dark:text-violet-300">Selected Connection: {selectedEdge.sourceLabel} → {selectedEdge.targetLabel}</p>
            <p className="text-slate-500 dark:text-slate-400 mt-0.5">Type: {selectedEdge.kindLabel} ({selectedEdge.relationship})</p>
            <p className="mt-1 text-slate-600 dark:text-slate-300 leading-normal">{selectedEdge.propagationDirection} {selectedEdge.whyItMatters}</p>
          </div>
        )}
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
}: Props) {
  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 shrink-0">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Component Inspector</h3>
        <p className={`text-xs ${mutedText} mt-0.5`}>
          Root: <span className="text-red-600 dark:text-red-400 font-semibold">{rootLabel}</span>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
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
          />
        ) : (
          <EdgeDetail detail={selection.detail} rootLabel={rootLabel} onSelectNode={onSelectNode} />
        )}
      </div>
    </div>
  );
}

function MiniPipeline({
  d,
  rootId,
  rootLabel,
  onSelectNode,
}: {
  d: BlastNodeDetail;
  rootId: string;
  rootLabel: string;
  onSelectNode: (id: string) => void;
}) {
  const isRoot = d.id === rootId;
  const hasUpstream = d.upstream.length > 0;
  const hasDownstream = d.downstream.length > 0;

  return (
    <div className="py-2.5 border-b border-slate-100 dark:border-slate-800/80">
      <p className={`text-xs uppercase tracking-wider font-semibold ${mutedText} mb-2`}>
        Dependency Flow (Impact Path)
      </p>
      
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {/* Root Cause Component */}
        <button
          type="button"
          onClick={() => onSelectNode(rootId)}
          className={`px-2 py-0.5 rounded border transition-all ${
            isRoot
              ? 'bg-red-500/20 text-red-500 border-red-500 font-bold shadow-[0_0_8px_rgba(239,68,68,0.2)]'
              : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-400 hover:border-slate-400'
          }`}
          title="Root Cause of failure propagation"
        >
          {rootLabel} (Root)
        </button>

        <span className="text-slate-400 animate-pulse font-bold">➔</span>

        {/* Upstream component (if selected is not root, and has upstream) */}
        {!isRoot && hasUpstream && (
          <>
            <button
              type="button"
              onClick={() => onSelectNode(d.upstream[0].id)}
              className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 hover:border-indigo-400"
              title="Immediate upstream dependency propagating impact"
            >
              {d.upstream[0].label} (Upstream)
            </button>
            <span className="text-slate-400 animate-pulse font-bold">➔</span>
          </>
        )}

        {/* Selected Component */}
        {!isRoot && (
          <>
            <div className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-500 border border-blue-500 font-bold shadow-[0_0_8px_rgba(59,130,246,0.2)]">
              {d.label} (Selected)
            </div>
            {hasDownstream && <span className="text-slate-400 animate-pulse font-bold">➔</span>}
          </>
        )}

        {/* Downstream component */}
        {hasDownstream && (
          <button
            type="button"
            onClick={() => onSelectNode(d.downstream[0].id)}
            className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:border-amber-400"
            title="Downstream dependency affected by cascade"
          >
            {d.downstream[0].label} (Downstream)
            {d.downstream.length > 1 && ` (+${d.downstream.length - 1})`}
          </button>
        )}
      </div>
    </div>
  );
}

function NodeDetail({
  detail: d,
  rootId,
  rootLabel,
  onSelectNode,
  onSetRootCause,
}: {
  detail: BlastNodeDetail;
  rootId: string;
  rootLabel: string;
  onSelectNode: (id: string) => void;
  onSetRootCause: (id: string) => void;
}) {
  return (
    <div className={`rounded-xl border-2 ${ROLE_BORDER[d.impactRole]} overflow-hidden`}>
      <div className="px-3 py-3 bg-slate-50 dark:bg-slate-900/40">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-base font-bold text-slate-900 dark:text-white truncate">{d.label}</h4>
            <p className={`text-xs font-mono ${mutedText} truncate`}>{d.id}</p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${healthBadgeClass(d.health)}`}>
            {d.health}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${ROLE_BADGE[d.impactRole]}`}>
            {d.impactRoleLabel}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
            {layerLabel(d.layer)}
          </span>
          <span
            className="text-[10px] px-2 py-0.5 rounded font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 cursor-help"
            title="Failure Propagation Risk: Probability of this component degrading or propagating failure in the current incident topology"
          >
            Risk: {d.riskScore.toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="px-3 py-1 bg-white dark:bg-slate-800/30">
        <MiniPipeline d={d} rootId={rootId} rootLabel={rootLabel} onSelectNode={onSelectNode} />
        <DetailRow label="Current status">{d.currentImpact}</DetailRow>
        <DetailRow label="Failure Risk Score">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 dark:text-white font-mono">{d.riskScore.toFixed(0)}%</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Probability of operational degradation or cascading failure propagation within the current topology
            </span>
          </div>
        </DetailRow>
        <DetailRow label={d.statusLabel}>
          <span className={d.statusLabel === 'Why healthy' ? 'text-green-700 dark:text-green-300' : ''}>
            {d.statusExplanation}
          </span>
        </DetailRow>
        <DetailRow label="Relationship to root cause">{d.rootCauseRelation}</DetailRow>
        <DetailRow label="Propagation direction">{d.propagationDirection}</DetailRow>
        <DetailRow label="Upstream dependencies">
          <DepList items={d.upstream} direction="upstream" onSelect={onSelectNode} />
        </DetailRow>
        <DetailRow label="Downstream dependencies">
          <DepList items={d.downstream} direction="downstream" onSelect={onSelectNode} />
        </DetailRow>
      </div>

      {d.id !== rootId && (
        <div className="px-3 pb-3">
          <button type="button" onClick={() => onSetRootCause(d.id)} className={`${btnSecondary} w-full text-xs`}>
            Re-analyze with this as root cause
          </button>
        </div>
      )}
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
