import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import ReactFlow, { Background, Controls, type Node, type Edge } from 'reactflow';
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
            <StatCard label="Business Impact" value={result.business_impact_score} sub="/ 100" alert={result.business_impact_score >= 80} />
            <StatCard label="Severity" value={result.severity_recommendation} />
            <StatCard label="Scope" value={result.issue_scope} alert={result.issue_scope === 'systemic'} />
            <StatCard label="Customers Est." value={result.impacted_customers_estimate} />
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
    </div>
  );
}
