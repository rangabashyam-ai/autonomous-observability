import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import ReactFlow, { Background, Controls, MarkerType, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { analyzeBlastRadius, getDependencyGraph } from '../api/client';
import type { BlastRadiusResult } from '../types/intelligence';
import type { DependencyGraph } from '../types/api';
import { PageHeader, StatCard, ConfidenceBar, btnPrimary, mutedText } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { getGraphBackgroundColor } from '../utils/graphTheme';
import {
  buildBlastFlowEdges,
  buildBlastFlowNodes,
  resolveEdgeKind,
  filterGraphForBlast,
  mergeDependencyGraphs,
} from '../utils/blastGraphLayout';
import { buildEdgeDetail, buildNodeDetail } from '../utils/blastGraphDetails';
import BlastRadiusNode from '../components/BlastRadiusNode';
import BlastRadiusDetailPanel, {
  IncidentPropagationSummary,
} from '../components/BlastRadiusDetailPanel';
import BlastRadiusClickableTags from '../components/BlastRadiusClickableTags';
import BlastRadiusPathChat from '../components/BlastRadiusPathChat';

const nodeTypes = { blastRadius: BlastRadiusNode };

type GraphSelection =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | null;

export default function BlastRadiusDashboard() {
  const { theme } = useTheme();
  const [alerts] = useState(['CPU Saturation', 'API Error Spike']);
  const [symptoms] = useState(['Latency Increase', 'Retry Storm']);
  const [service, setService] = useState('payment-authorization');
  const [result, setResult] = useState<BlastRadiusResult | null>(null);
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [activeModal, setActiveModal] = useState<'business_impact' | 'severity' | 'scope' | 'customers' | null>(null);

  const baseServiceImpact = useMemo(() => {
    const serviceImpactMap: Record<string, number> = {
      'payment-authorization': 95,
      'settlement-processing': 90,
      'api-gateway-services': 85,
      'fraud-detection': 75,
      'merchant-services': 70,
      'partner-integrations': 60,
    };
    return serviceImpactMap[service] ?? 50;
  }, [service]);

  const scopeModifier = useMemo(() => {
    if (!result) return 0;
    const isSystemic = result.issue_scope === 'systemic';
    return isSystemic ? 20 : 0;
  }, [result]);

  const applyGraphVisuals = useCallback(
    (
      graphData: DependencyGraph,
      blast: BlastRadiusResult,
      rootId: string,
      currentTheme: 'light' | 'dark',
      currentSelection: GraphSelection,
    ) => {
      const focusedNodeId = currentSelection?.type === 'node' ? currentSelection.id : null;
      const selectedEdgeId = currentSelection?.type === 'edge' ? currentSelection.id : null;
      setNodes(buildBlastFlowNodes(graphData, blast, rootId, focusedNodeId));
      setEdges(buildBlastFlowEdges(graphData.edges, blast, rootId, currentTheme, selectedEdgeId));
    },
    [],
  );

  const buildGraph = useCallback(
    async (blast: BlastRadiusResult, currentTheme: 'light' | 'dark', currentSelection: GraphSelection) => {
      const [serviceGraph, infraGraph] = await Promise.all([
        getDependencyGraph('microservice', 'risk_score', service),
        getDependencyGraph('infrastructure', 'risk_score'),
      ]);

      const infraRelevant = infraGraph.nodes.filter(
        (n) =>
          blast.blast_radius_nodes.includes(n.id) ||
          blast.impacted_infrastructure.includes(n.id),
      );
      const infraIds = new Set(infraRelevant.map((n) => n.id));
      const infraEdges = infraGraph.edges.filter(
        (e) => infraIds.has(e.source) || infraIds.has(e.target),
      );

      const merged = mergeDependencyGraphs(serviceGraph, {
        ...infraGraph,
        nodes: infraRelevant,
        edges: infraEdges,
      });
      const graphData = filterGraphForBlast(merged, blast);
      setGraph(graphData);
      applyGraphVisuals(graphData, blast, service, currentTheme, currentSelection);
    },
    [service, applyGraphVisuals],
  );

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    try {
      const r = await analyzeBlastRadius({ alerts, symptoms, service });
      setResult(r);
      const initialSelection: GraphSelection = { type: 'node', id: service };
      setSelection(initialSelection);
      await buildGraph(r, theme, initialSelection);
    } finally {
      setLoading(false);
    }
  }, [alerts, symptoms, service, theme, buildGraph]);

  useEffect(() => {
    runAnalysis();
  }, [service]);

  useEffect(() => {
    if (result && graph) {
      applyGraphVisuals(graph, result, service, theme, selection);
    }
  }, [theme, result, graph, service, selection, applyGraphVisuals]);

  const selectNode = useCallback((nodeId: string) => {
    setSelection({ type: 'node', id: nodeId });
  }, []);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    selectNode(node.id);
  }, [selectNode]);

  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelection({ type: 'edge', id: edge.id });
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelection(null);
  }, []);

  const handleSetRootCause = useCallback((nodeId: string) => {
    setService(nodeId);
  }, []);

  const rootLabel = graph?.nodes.find((n) => n.id === service)?.label ?? service;

  const labelForId = useCallback(
    (id: string) => graph?.nodes.find((n) => n.id === id)?.label ?? id.replace(/-/g, ' '),
    [graph],
  );

  const selectionDetail = useMemo(() => {
    if (!selection || !graph || !result) return null;

    if (selection.type === 'node') {
      const node = graph.nodes.find((n) => n.id === selection.id);
      if (!node) return null;
      return { type: 'node' as const, detail: buildNodeDetail(node, graph, result, service) };
    }

    const flowEdge = edges.find((e) => e.id === selection.id);
    if (!flowEdge) return null;
    const graphEdge = graph.edges.find(
      (e) => e.source === flowEdge.source && e.target === flowEdge.target,
    );
    if (!graphEdge) return null;

    const kind = resolveEdgeKind(graphEdge, result, service, graph.edges);
    return {
      type: 'edge' as const,
      detail: buildEdgeDetail(graphEdge, kind, graph, result, service, selection.id),
    };
  }, [selection, graph, result, service, edges]);

  const selectedNodeId = selection?.type === 'node' ? selection.id : null;

  const copilotContext = useMemo(() => {
    if (!result) return null;

    const selectedPayload = selectionDetail
      ? selectionDetail.type === 'node'
        ? {
            type: 'node',
            id: selectionDetail.detail.id,
            label: selectionDetail.detail.label,
            impact_role: selectionDetail.detail.impactRoleLabel,
            health: selectionDetail.detail.health,
            status: selectionDetail.detail.currentImpact,
          }
        : {
            type: 'edge',
            source: selectionDetail.detail.sourceLabel,
            target: selectionDetail.detail.targetLabel,
            relationship: selectionDetail.detail.relationship,
            kind: selectionDetail.detail.kindLabel,
          }
      : null;

    const entitySuffix = selection
      ? selection.type === 'node'
        ? `:node-${selection.id}`
        : `:edge-${selection.id}`
      : '';

    return {
      pageType: 'blast' as const,
      selectedEntity: `blast-${service}${entitySuffix}`,
      entityData: {
        failure_source: service,
        failure_source_label: rootLabel,
        affected_nodes: result.blast_radius_nodes,
        revenue_impact: result.business_impact_score,
        affected_users: result.impacted_customers_estimate,
        issue_scope: result.issue_scope,
        critical_paths: result.currently_impacted_services,
        selected_component: selectedPayload,
      },
      dependencyData: {
        currently_impacted: result.currently_impacted_services,
        likely_downstream: result.likely_downstream_services,
        impacted_infrastructure: result.impacted_infrastructure,
        impacted_regions: result.impacted_regions,
      },
      analysisResults: { ...result } as Record<string, unknown>,
    };
  }, [result, service, rootLabel, selection, selectionDetail]);

  useRegisterCopilotContext(copilotContext);

  const renderMetricModal = () => {
    if (!activeModal || !result) return null;

    let title = '';
    let explanation = null;

    const isSystemic = result.issue_scope === 'systemic';

    if (activeModal === 'business_impact') {
      title = 'Business Impact Score';
      explanation = (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            A dynamic score out of 100 reflecting the severity of the incident based on the target service's criticality and overall failure scope.
          </p>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-555 dark:text-slate-400 font-medium">Base Service Priority ({rootLabel}):</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{baseServiceImpact} pts</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-555 dark:text-slate-400 font-medium">Systemic Scope Modifier:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">+{scopeModifier} pts</span>
            </div>
            <hr className="border-slate-200 dark:border-slate-800" />
            <div className="flex justify-between items-center text-sm font-bold">
              <span className="text-slate-900 dark:text-white">Calculated Score:</span>
              <span className="text-red-600 dark:text-red-400">{result.business_impact_score} / 100</span>
            </div>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 italic leading-relaxed">
            * Note: Base service impact scores are pre-assigned by SLA significance (e.g. Payment Authorization = 95, Gateway = 85). Systemic modifier (+20) is added when the propagation depth triggers systemic classification. Total score is capped at 100.
          </div>
        </div>
      );
    } else if (activeModal === 'severity') {
      title = 'Severity Recommendation';
      explanation = (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Automatically maps the Business Impact Score into operational priority recommendations to trigger SRE response.
          </p>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="space-y-2">
              <div className={`flex justify-between items-center p-2 rounded-lg text-xs border ${result.severity_recommendation === 'P1' ? 'bg-red-50/70 border-red-300 dark:bg-red-950/30 dark:border-red-800 text-red-700 dark:text-red-400 font-bold' : 'border-transparent text-slate-600 dark:text-slate-400'}`}>
                <span>P1 (Critical)</span>
                <span>Impact Score ≥ 85</span>
              </div>
              <div className={`flex justify-between items-center p-2 rounded-lg text-xs border ${result.severity_recommendation === 'P2' ? 'bg-orange-50/70 border-orange-300 dark:bg-orange-950/30 dark:border-orange-800 text-orange-700 dark:text-orange-400 font-bold' : 'border-transparent text-slate-600 dark:text-slate-400'}`}>
                <span>P2 (Major)</span>
                <span>Impact Score 70 - 84</span>
              </div>
              <div className={`flex justify-between items-center p-2 rounded-lg text-xs border ${result.severity_recommendation === 'P3' ? 'bg-yellow-50/70 border-yellow-300 dark:bg-yellow-950/30 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400 font-bold' : 'border-transparent text-slate-600 dark:text-slate-400'}`}>
                <span>P3 (Moderate)</span>
                <span>Impact Score &lt; 70</span>
              </div>
            </div>
            <hr className="border-slate-200 dark:border-slate-800" />
            <div className="text-xs">
              Current Business Impact: <span className="font-bold text-slate-850 dark:text-slate-200">{result.business_impact_score}</span> → Severity matches <span className="font-bold text-slate-850 dark:text-slate-200">{result.severity_recommendation}</span> criteria.
            </div>
          </div>
        </div>
      );
    } else if (activeModal === 'scope') {
      title = 'Incident Scope';
      explanation = (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Differentiates between a localized failure zone and a wide-scale systemic outage using dependency path traversal.
          </p>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-555 dark:text-slate-400 font-medium">Suspected Origin node:</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">{result.input?.source_component ?? service}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-555 dark:text-slate-400 font-medium">Downstream microservices impacted:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{result.currently_impacted_services.length} services</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-555 dark:text-slate-400 font-medium">Includes Gateway layer:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{isSystemic ? 'Yes (Systemic Trigger)' : 'No'}</span>
            </div>
            <hr className="border-slate-200 dark:border-slate-800" />
            <div className="flex justify-between items-center text-sm font-bold">
              <span className="text-slate-900 dark:text-white">Classification:</span>
              <span className={`uppercase ${isSystemic ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>{result.issue_scope}</span>
            </div>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed space-y-1">
            <p><strong>Systemic Outage Conditions:</strong></p>
            <ul className="list-disc list-inside">
              <li>Outage propagates to more than 4 downstream microservices.</li>
              <li>Or failure compromises high-level gateway router layers (e.g. `api-gateway`).</li>
            </ul>
          </div>
        </div>
      );
    } else if (activeModal === 'customers') {
      title = 'Customers Estimated';
      explanation = (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Computes a baseline estimation of the number of active customer accounts experiencing degraded request patterns.
          </p>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-555 dark:text-slate-400 font-medium">Business Impact score:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono">{result.business_impact_score}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-555 dark:text-slate-400 font-medium">Scope Multiplier:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono">{isSystemic ? '50x (Systemic Multiplier)' : '10x (Localized Multiplier)'}</span>
            </div>
            <hr className="border-slate-200 dark:border-slate-800" />
            <div className="flex justify-between items-center text-sm font-bold">
              <span className="text-slate-900 dark:text-white">Estimated Affected Users:</span>
              <span className="text-blue-600 dark:text-blue-400">{result.impacted_customers_estimate.toLocaleString()} accounts</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
            * Multiplier coefficients are calibrated to represent average transaction volumes per impact tier (Systemic outages impact multiple parallel service zones, thus utilizing a 50x multiplier).
          </p>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        {/* Backdrop overlay */}
        <div
          className="absolute inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm transition-opacity"
          onClick={() => setActiveModal(null)}
        />

        {/* Modal container */}
        <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border border-slate-250 dark:border-slate-700 rounded-2xl w-full max-w-md shadow-2xl relative z-10 overflow-hidden transform transition-all">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-150 dark:border-slate-750 bg-slate-50/50 dark:bg-slate-900/40">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {title} Analysis
            </h3>
            <button
              onClick={() => setActiveModal(null)}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-655 dark:hover:text-slate-350 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-705 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-5">
            {explanation}
          </div>

          {/* Footer */}
          <div className="flex justify-end px-6 py-3.5 bg-slate-50 dark:bg-slate-900/30 border-t border-slate-150 dark:border-slate-755">
            <button
              onClick={() => setActiveModal(null)}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-105 dark:bg-slate-700 text-slate-750 dark:text-slate-250 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Impact & Blast Radius"
        description="Predict impacted services, downstream failures, and visualize blast radius on dependency graph"
      />

      <div className="flex gap-3 mb-4">
        <button onClick={runAnalysis} disabled={loading} className={btnPrimary}>
          {loading ? 'Analyzing...' : 'Refresh Analysis'}
        </button>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Business Impact"
              value={result.business_impact_score}
              sub="/ 100"
              alert={result.business_impact_score >= 80}
              onClick={() => setActiveModal('business_impact')}
            />
            <StatCard
              label="Severity"
              value={result.severity_recommendation}
              onClick={() => setActiveModal('severity')}
            />
            <StatCard
              label="Scope"
              value={result.issue_scope}
              alert={result.issue_scope === 'systemic'}
              onClick={() => setActiveModal('scope')}
            />
            <StatCard
              label="Customers Est."
              value={result.impacted_customers_estimate.toLocaleString()}
              onClick={() => setActiveModal('customers')}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 xl:gap-5">
            {/* Left sidebar: Context & Impact */}
            <div className="xl:col-span-3 space-y-4 max-h-[600px] overflow-y-auto pr-1">
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Currently Impacted</h3>
                <BlastRadiusClickableTags
                  items={result.currently_impacted_services}
                  color="red"
                  selectedId={selectedNodeId}
                  labelFor={labelForId}
                  onSelect={selectNode}
                />
              </div>
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Likely Downstream</h3>
                <BlastRadiusClickableTags
                  items={result.likely_downstream_services}
                  color="yellow"
                  selectedId={selectedNodeId}
                  labelFor={labelForId}
                  onSelect={selectNode}
                />
              </div>
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Infrastructure</h3>
                <BlastRadiusClickableTags
                  items={result.impacted_infrastructure}
                  color="blue"
                  selectedId={selectedNodeId}
                  labelFor={labelForId}
                  onSelect={selectNode}
                />
              </div>
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Regions</h3>
                <div className="flex flex-wrap gap-1.5">
                  {result.impacted_regions.map((r) => (
                    <span key={r} className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
              <ConfidenceBar value={result.business_impact_score} label="Business Impact Score" />
            </div>

            {/* Graph */}
            <div className="xl:col-span-5 h-[600px] bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden flex flex-col shadow-inner">
              <div className="flex-1 min-h-0 w-full relative">
                <ReactFlow
                  className="w-full h-full"
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.15 }}
                  minZoom={0.25}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable
                  edgesFocusable
                  onNodeClick={handleNodeClick}
                  onEdgeClick={handleEdgeClick}
                  onPaneClick={handlePaneClick}
                >
                  <Background color={getGraphBackgroundColor(theme)} gap={16} />
                  <Controls />
                </ReactFlow>
              </div>
              <div className={`text-[10px] ${mutedText} px-4 py-2 border-t border-slate-200 dark:border-slate-700 shrink-0 flex flex-wrap gap-x-3 gap-y-1`}>
                <span><span className="inline-block w-2 h-2 rounded-sm bg-red-200 border border-red-600 mr-1 align-middle" />Root cause</span>
                <span><span className="inline-block w-2 h-2 rounded-sm bg-orange-200 border border-orange-600 mr-1 align-middle" />Impacted</span>
                <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-200 border border-amber-600 mr-1 align-middle" />Downstream</span>
                <span><span className="inline-block w-2 h-2 rounded-sm bg-indigo-200 border border-indigo-600 mr-1 align-middle" />Upstream dep</span>
                <span><span className="inline-block w-2 h-2 rounded-sm bg-violet-200 border border-violet-600 mr-1 align-middle" />Infrastructure</span>
                <span className="text-slate-400">· Click nodes, arrows, or tags →</span>
              </div>
            </div>

            {/* Right side Investigation Workflow Panel */}
            <div className="xl:col-span-4 h-[600px] flex flex-col gap-3 overflow-y-auto pr-1">
              <div className="shrink-0">
                <IncidentPropagationSummary
                  result={result}
                  rootLabel={rootLabel}
                  selection={selectionDetail}
                />
              </div>
              
              <div className="h-[320px] shrink-0">
                <BlastRadiusDetailPanel
                  rootId={service}
                  rootLabel={rootLabel}
                  selection={selectionDetail}
                  onSelectNode={selectNode}
                  onSetRootCause={handleSetRootCause}
                />
              </div>

              <div className="shrink-0">
                <BlastRadiusPathChat service={service} />
              </div>
            </div>
          </div>
        </>
      )}
      {renderMetricModal()}
    </div>
  );
}
