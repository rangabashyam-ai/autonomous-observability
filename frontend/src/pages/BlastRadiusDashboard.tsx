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
import BlastRadiusPathChat from '../components/BlastRadiusPathChat';
import DatasetUploadBanner from '../components/DatasetUploadBanner';
import InlineCopilot from '../components/copilot/InlineCopilot';

import BlastRadiusEdge from '../components/BlastRadiusEdge';

const nodeTypes = { blastRadius: BlastRadiusNode };
const edgeTypes = { blastRadiusEdge: BlastRadiusEdge };

const FALLBACK_SERVICES = [
  'ServiceTest1', 'ServiceTest2', 'ServiceTest3', 'ServiceTest4', 'ServiceTest5',
  'ServiceTest6', 'ServiceTest7', 'ServiceTest8', 'ServiceTest9', 'ServiceTest10', 'ServiceTest11',
  'payment-authorization', 'settlement-processing', 'api-gateway-services',
  'fraud-detection', 'merchant-services', 'partner-integrations'
];

type GraphSelection =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | null;

const REGIONS_DATA = [
  {
    id: 'us-east',
    name: 'us-east',
    status: 'Critical' as const,
    incidents: 1,
    resolved: 0,
    totalServices: 8,
    impacted: 4,
    failedPods: 3,
    affectedCustomers: 2847,
    avgLatency: '2340ms',
  },
  {
    id: 'ap-east',
    name: 'ap-east',
    status: 'Critical' as const,
    incidents: 2,
    resolved: 1,
    totalServices: 6,
    impacted: 3,
    failedPods: 2,
    affectedCustomers: 671,
    avgLatency: '1850ms',
  },
  {
    id: 'eu-central',
    name: 'eu-central',
    status: 'Warning' as const,
    incidents: 2,
    resolved: 1,
    totalServices: 6,
    impacted: 2,
    failedPods: 1,
    affectedCustomers: 739,
    avgLatency: '840ms',
  },
  {
    id: 'ap-southeast',
    name: 'ap-southeast',
    status: 'Warning' as const,
    incidents: 2,
    resolved: 2,
    totalServices: 5,
    impacted: 2,
    failedPods: 1,
    affectedCustomers: 312,
    avgLatency: '310ms',
  },
  {
    id: 'me-south',
    name: 'me-south',
    status: 'Warning' as const,
    incidents: 1,
    resolved: 0,
    totalServices: 4,
    impacted: 1,
    failedPods: 1,
    affectedCustomers: 89,
    avgLatency: '420ms',
  },
  {
    id: 'us-west',
    name: 'us-west',
    status: 'Healthy' as const,
    incidents: 0,
    resolved: 0,
    totalServices: 6,
    impacted: 0,
    failedPods: 0,
    affectedCustomers: 0,
    avgLatency: '45ms',
  },
  {
    id: 'eu-west',
    name: 'eu-west',
    status: 'Healthy' as const,
    incidents: 0,
    resolved: 0,
    totalServices: 4,
    impacted: 0,
    failedPods: 0,
    affectedCustomers: 0,
    avgLatency: '38ms',
  },
  {
    id: 'sa-east',
    name: 'sa-east',
    status: 'Healthy' as const,
    incidents: 0,
    resolved: 0,
    totalServices: 5,
    impacted: 0,
    failedPods: 0,
    affectedCustomers: 0,
    avgLatency: '60ms',
  },
  {
    id: 'ap-south',
    name: 'ap-south',
    status: 'Healthy' as const,
    incidents: 0,
    resolved: 0,
    totalServices: 4,
    impacted: 0,
    failedPods: 0,
    affectedCustomers: 0,
    avgLatency: '55ms',
  },
  {
    id: 'au-southeast',
    name: 'au-southeast',
    status: 'Healthy' as const,
    incidents: 0,
    resolved: 0,
    totalServices: 4,
    impacted: 0,
    failedPods: 0,
    affectedCustomers: 0,
    avgLatency: '75ms',
  },
];

const regionCoords: Record<string, { top: string; left: string }> = {
  'us-west': { top: '34%', left: '19%' },
  'us-east': { top: '34%', left: '29%' },
  'eu-west': { top: '27%', left: '48%' },
  'eu-central': { top: '29%', left: '53%' },
  'sa-east': { top: '62%', left: '36%' },
  'me-south': { top: '41%', left: '59%' },
  'ap-south': { top: '46%', left: '69%' },
  'ap-southeast': { top: '57%', left: '76%' },
  'ap-east': { top: '36%', left: '83%' },
  'au-southeast': { top: '73%', left: '86%' },
};


export default function BlastRadiusDashboard() {
  const { theme } = useTheme();
  const [alerts] = useState(['CPU Saturation', 'API Error Spike']);
  const [symptoms] = useState(['Latency Increase', 'Retry Storm']);
  const [service, setService] = useState('ServiceTest1');
  const [availableServices, setAvailableServices] = useState<string[]>(FALLBACK_SERVICES);

  useEffect(() => {
    async function loadServices() {
      try {
        const data = await getDependencyGraph(['microservice'], 'risk_score');
        if (data?.nodes) {
          const fetchedIds = data.nodes.map((n: any) => n.id);
          const combined = Array.from(new Set([...fetchedIds, ...FALLBACK_SERVICES]));
          setAvailableServices(combined);
        }
      } catch (err) {
        console.error('Failed to load services:', err);
      }
    }
    loadServices();
  }, []);
  const [result, setResult] = useState<BlastRadiusResult | null>(null);
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [activeModal, setActiveModal] = useState<'business_impact' | 'severity' | 'scope' | 'customers' | null>(null);
  const [selectedRegionHighlight, setSelectedRegionHighlight] = useState<string | null>(null);
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string | null>(null);
  const [activeRegionModal, setActiveRegionModal] = useState<string | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [expandedPanel, setExpandedPanel] = useState<'dynamic' | 'component' | 'chat' | null>(null);




  const applyGraphVisuals = useCallback(
    (
      graphData: DependencyGraph,
      blast: BlastRadiusResult,
      rootId: string,
      currentTheme: 'light' | 'dark',
      currentSelection: GraphSelection,
      highlightRegion: string | null,
      filterRegion: string | null,
    ) => {
      const focusedNodeId = currentSelection?.type === 'node' ? currentSelection.id : null;
      const selectedEdgeId = currentSelection?.type === 'edge' ? currentSelection.id : null;

      const regionServiceMap: Record<string, string[]> = {
        'us-east': ['payment-authorization', 'auth-service', 'api-gateway-services', 'k8s-cluster-a Pod 01', 'External LB'],
        'eu-central': ['settlement-processing', 'postgres-cluster', 'storage-cluster-1', 'internal-lb', 'merchant-services'],
        'ap-southeast': ['fraud-detection', 'redis-cluster', 'partner-integrations', 'identity-service'],
        'us-west': [],
        'eu-west': [],
      };

      // Filter graph data if filterRegion is active!
      let nodesToRender = graphData.nodes;
      let edgesToRender = graphData.edges;

      if (filterRegion) {
        const localServices = regionServiceMap[filterRegion] || [];
        nodesToRender = graphData.nodes.filter(node =>
          localServices.some(ls =>
            node.id.toLowerCase() === ls.toLowerCase() ||
            node.label.toLowerCase() === ls.toLowerCase() ||
            node.id.toLowerCase().includes(ls.toLowerCase()) ||
            node.label.toLowerCase().includes(ls.toLowerCase())
          ) || node.id.toLowerCase().includes(filterRegion.toLowerCase())
        );
        const nodeIds = new Set(nodesToRender.map(n => n.id));
        edgesToRender = graphData.edges.filter(edge =>
          nodeIds.has(edge.source) && nodeIds.has(edge.target)
        );
      }

      const localServices = highlightRegion ? (regionServiceMap[highlightRegion] || []) : [];

      const rawNodes = buildBlastFlowNodes({ ...graphData, nodes: nodesToRender }, blast, rootId, focusedNodeId);
      const mappedNodes = rawNodes.map((node) => {
        if (!highlightRegion) return node;

        const inRegion = localServices.some(ls =>
          node.id.toLowerCase() === ls.toLowerCase() ||
          node.data.label.toLowerCase() === ls.toLowerCase() ||
          node.id.toLowerCase().includes(ls.toLowerCase()) ||
          node.data.label.toLowerCase().includes(ls.toLowerCase())
        ) || node.id.toLowerCase().includes(highlightRegion.toLowerCase());

        return {
          ...node,
          data: {
            ...node.data,
            isRegionHighlighted: inRegion,
          }
        };
      });

      setNodes(mappedNodes);
      setEdges(buildBlastFlowEdges(edgesToRender, blast, rootId, currentTheme, selectedEdgeId));
    },
    [],
  );

  const buildGraph = useCallback(
    async (blast: BlastRadiusResult, currentTheme: 'light' | 'dark', currentSelection: GraphSelection) => {
      const [serviceGraph, infraGraph] = await Promise.all([
        getDependencyGraph(['microservice'], 'risk_score', service),
        getDependencyGraph(['infrastructure'], 'risk_score'),
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
      applyGraphVisuals(graphData, blast, service, currentTheme, currentSelection, selectedRegionHighlight, selectedRegionFilter);
    },
    [service, applyGraphVisuals, selectedRegionHighlight, selectedRegionFilter],
  );

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    try {
      const r = await analyzeBlastRadius({ alerts, symptoms, service });
      setResult(r);
      const initialSelection: GraphSelection = { type: 'node', id: service };
      setSelection(initialSelection);
      setSelectedRegionHighlight(null);
      setSelectedRegionFilter(null);
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
      applyGraphVisuals(graph, result, service, theme, selection, selectedRegionHighlight, selectedRegionFilter);
    }
  }, [theme, result, graph, service, selection, selectedRegionHighlight, selectedRegionFilter, applyGraphVisuals]);

  const selectNode = useCallback((nodeId: string) => {
    setSelection({ type: 'node', id: nodeId });
    setExpandedPanel('component');
  }, [setExpandedPanel]);

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

  const renderBusinessImpactModal = () => {
    if (!result) return null;

    const factors = [
      {
        name: 'Service Criticality',
        desc: 'Payment Authorization is P1 revenue-critical service',
        score: 35,
        max: 35,
      },
      {
        name: 'Customer Impact',
        desc: '5,000 of 5,000 total customers affected = 100%',
        score: 30,
        max: 30,
      },
      {
        name: 'Propagation Depth',
        desc: '11 services in chain, systemic scope',
        score: 20,
        max: 20,
      },
      {
        name: 'Infrastructure Risk',
        desc: '6 infra components affected including DB + LB',
        score: 10,
        max: 10,
      },
      {
        name: 'Recovery Complexity',
        desc: 'multiple root causes, cross-region impact',
        score: 5,
        max: 5,
      },
    ];

    const getProgressBarColor = (score: number, max: number) => {
      const pct = score / max;
      if (pct >= 0.9) return 'bg-red-500';
      if (pct >= 0.3) return 'bg-orange-500';
      return 'bg-green-500';
    };

    return (
      <>
        {/* Backdrop overlay */}
        <div
          className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm z-40"
          onClick={() => setActiveModal(null)}
        />

        {/* Drawer container */}
        <div className="fixed right-0 top-0 bottom-0 z-50 w-full md:w-2/3 lg:w-1/2 xl:w-2/5 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Business Impact Score
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                Real-time severity calculation
              </p>
            </div>
            <div className="flex items-center gap-3.5">
              <div className="flex items-center gap-1.5">
                <div className="w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                  100
                </div>
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">/100</span>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-655 dark:hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
            {/* Section 1: Score Breakdown */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Score Breakdown
              </h4>
              <div className="p-3 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-xs text-slate-600 dark:text-slate-355 min-w-[300px]">
                  <thead>
                    <tr className="border-b border-slate-150 dark:border-slate-800 pb-1.5 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider text-left">
                      <th className="py-1 font-bold">Factor Name</th>
                      <th className="py-1 font-bold text-center">Score</th>
                      <th className="py-1 font-bold text-right pr-2">Visual Bar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/35">
                    {factors.map((f) => {
                      const pct = (f.score / f.max) * 100;
                      return (
                        <tr key={f.name}>
                          <td className="py-2 pr-2">
                            <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">{f.name}</div>
                            <div className="text-[9px] text-slate-400 dark:text-slate-500 leading-normal">{f.desc}</div>
                          </td>
                          <td className="py-2 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                            {f.score}/{f.max}
                          </td>
                          <td className="py-2 align-middle text-right">
                            <div className="w-24 bg-slate-150 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden ml-auto">
                              <div
                                className={`h-full ${getProgressBarColor(f.score, f.max)} rounded-full`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 2: Customer Impact Breakdown */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Customer Impact Breakdown
              </h4>
              <div className="space-y-2 p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl">
                <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span>Total customer base: <span className="font-bold text-slate-800 dark:text-slate-200">5,000</span></span>
                  <span>Currently affected: <span className="text-red-500 font-bold">5,000 (100%)</span></span>
                </div>
                <div className="w-full bg-slate-150 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full" style={{ width: '100%' }} />
                </div>
                <div className="text-[9px] text-slate-400 dark:text-slate-500 flex justify-between font-mono">
                  <span>0</span>
                  <span className="font-sans font-semibold">5,000/5,000 (100% Blast Coverage)</span>
                  <span>5,000</span>
                </div>
              </div>
            </div>

            {/* Section 3: Severity Context */}
            <div className="p-3.5 bg-red-50/40 dark:bg-red-955/10 border border-red-200 dark:border-red-900/30 rounded-xl flex gap-2.5 items-start">
              <span className="text-red-500 text-sm mt-0.5" role="img" aria-label="critical">⚠️</span>
              <div>
                <div className="text-[9px] font-bold text-red-700 dark:text-red-400 uppercase tracking-wider">Severity Context</div>
                <p className="text-xs text-red-650 dark:text-red-350 leading-relaxed mt-0.5">
                  <strong>Score 90-100: CRITICAL</strong> — Immediate executive escalation required. Full incident response team activation. SLA breach imminent.
                </p>
              </div>
            </div>

            {/* Section 4: Trend */}
            <div className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Severity Trend</div>
                <div className="text-xs text-slate-600 dark:text-slate-350 flex flex-wrap gap-x-2 gap-y-0.5">
                  <span>Started at: <span className="font-semibold font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.2 rounded">45</span> (14 min ago)</span>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <span>Peak: <span className="font-bold text-red-500 font-mono bg-red-50 dark:bg-red-955/20 px-1 py-0.2 rounded">100</span> (now)</span>
                </div>
                <div className="text-[10px] text-red-500 font-bold flex items-center gap-0.5 pt-0.5">
                  <span>↑ Increasing</span>
                </div>
              </div>
              <div className="shrink-0 pl-2">
                <svg className="w-20 h-7 text-red-500" viewBox="0 0 100 30" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="M 5,25 L 25,22 L 45,15 L 65,18 L 85,6 L 95,3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M 5,25 L 25,22 L 45,15 L 65,18 L 85,6 L 95,3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-30 blur-[1px]"
                    strokeWidth="4"
                  />
                </svg>
              </div>
            </div>

            {/* Inline AI Copilot Integration */}
            <div className="border-t border-slate-150 dark:border-slate-800/80 pt-4">
              <InlineCopilot
                pageType="blast"
                selectedEntity="Business Impact Score"
                entityData={{
                  metric: 'business_impact',
                  value: 100,
                  failure_source: service,
                  failure_source_label: rootLabel,
                  affected_nodes: result.blast_radius_nodes,
                  currently_impacted: result.currently_impacted_services,
                  likely_downstream: result.likely_downstream_services,
                  impacted_infrastructure: result.impacted_infrastructure,
                  impacted_regions: result.impacted_regions,
                }}
                suggestedQuestions={[
                  `Why is the Business Impact Score at 100?`,
                  `How does the failure on ${rootLabel} affect this?`,
                  `What are the suggested remediations to lower the impact?`
                ]}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/30 border-t border-slate-150 dark:border-slate-755 flex items-center justify-between gap-4">
            <span className="text-[9px] text-slate-400 dark:text-slate-500 italic">Last updated: just now</span>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveModal(null)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer bg-transparent"
              >
                Close
              </button>
              <button
                onClick={() => alert("Report exported successfully!")}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer border-0"
              >
                Export Report
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderSeverityModal = () => {
    if (!result) return null;

    const factors = [
      { name: 'Revenue Impact', status: 'Critical', pct: 100, colorClass: 'bg-red-500' },
      { name: 'Customer Scope', status: 'Critical', pct: 100, colorClass: 'bg-red-500' },
      { name: 'Service Criticality', status: 'Critical', pct: 100, colorClass: 'bg-red-500' },
      { name: 'Resolution Urgency', status: 'Immediate', pct: 100, colorClass: 'bg-red-500' },
    ];

    const escalations = [
      { name: 'On-call engineer', status: 'Notified ✓', done: true },
      { name: 'Incident commander', status: 'Assigned ✓', done: true },
      { name: 'Executive escalation', status: 'Triggered ✓', done: true },
      { name: 'War room', status: 'Active ✓', done: true },
    ];

    return (
      <div className="fixed inset-0 z-[9999] flex justify-end">
        <style>{`
          @keyframes slideInFromRight {
            0% { transform: translateX(100%); }
            100% { transform: translateX(0); }
          }
          @keyframes fadeIn {
            0% { opacity: 0; }
            100% { opacity: 1; }
          }
          .animate-slide-in-right {
            animation: slideInFromRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .animate-fade-in {
            animation: fadeIn 0.2s ease-out forwards;
          }
        `}</style>
        {/* Backdrop overlay */}
        <div
          className="absolute inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm animate-fade-in"
          onClick={() => setActiveModal(null)}
        />

        {/* Drawer container */}
        <div className="bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 w-full max-w-md shadow-2xl relative z-10 flex flex-col h-full animate-slide-in-right">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Severity Analysis
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-505 font-semibold">
                Priority 1 — Critical Incident
              </p>
            </div>
            <div className="flex items-center gap-3.5">
              <div className="flex items-center gap-1.5">
                <div className="w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                  P1
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-655 dark:hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
            {/* Section 1: Severity Breakdown */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Severity Breakdown
              </h4>
              <div className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl space-y-3">
                <div className="space-y-2.5">
                  {factors.map((f) => (
                    <div key={f.name} className="flex items-center justify-between gap-4 text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-205 w-1/3 truncate">{f.name}</span>
                      <div className="w-24 bg-slate-150 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden flex-1 max-w-[120px]">
                        <div className={`h-full ${f.colorClass} rounded-full`} style={{ width: `${f.pct}%` }} />
                      </div>
                      <span className="text-red-500 font-bold text-right w-16">{f.status}</span>
                    </div>
                  ))}
                </div>

                <div className="p-3 bg-red-50/40 dark:bg-red-955/10 border border-red-200 dark:border-red-900/30 rounded-xl">
                  <p className="text-xs text-red-655 dark:text-red-350 leading-relaxed">
                    <strong>P1 Definition:</strong> P1 incidents require immediate response, executive notification within 15 minutes, and all-hands incident bridge activation.
                  </p>
                </div>
              </div>
            </div>

            {/* Section 2: Escalation Status */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Escalation Status
              </h4>
              <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl">
                {escalations.map((e) => (
                  <div key={e.name} className="p-2.5 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 rounded-lg flex items-center justify-between shadow-xs">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{e.name}</span>
                    <span className="text-xs font-bold text-green-500">{e.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 3: SLA Impact */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                SLA Impact
              </h4>
              <div className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl space-y-2.5 text-xs text-slate-655 dark:text-slate-300 font-medium">
                <div className="flex justify-between items-center py-0.5">
                  <span>Response SLA:</span>
                  <span className="flex items-center gap-1 font-semibold text-orange-500">
                    15 min (current: 16 min) <span role="img" aria-label="warning">⚠️</span>
                  </span>
                </div>
                <hr className="border-slate-150 dark:border-slate-805/60" />
                <div className="flex justify-between items-center py-0.5">
                  <span>Resolution SLA:</span>
                  <span className="font-semibold text-slate-808 dark:text-slate-202">1 hour (elapsed: 16 min)</span>
                </div>
                <hr className="border-slate-150 dark:border-slate-805/60" />
                <div className="flex justify-between items-center py-0.5">
                  <span>Customer SLA breach risk:</span>
                  <span className="font-bold text-red-500">HIGH</span>
                </div>
              </div>
            </div>

            {/* Inline AI Copilot Integration */}
            <div className="border-t border-slate-155 dark:border-slate-800/80 pt-4">
              <InlineCopilot
                pageType="blast"
                selectedEntity="Severity Analysis"
                entityData={{
                  metric: 'severity',
                  value: 'P1',
                  failure_source: service,
                  failure_source_label: rootLabel,
                  escalation_status: escalations,
                  sla_impact: { response: '16 min (SLA: 15 min)', resolution: '16 min (SLA: 1 hour)', breach_risk: 'HIGH' }
                }}
                suggestedQuestions={[
                  `What triggered the transition of this incident to P1?`,
                  `Who is the current on-call engineer assigned?`,
                  `How can we lower the breach risk for Customer SLA?`
                ]}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/30 border-t border-slate-150 dark:border-slate-755 flex items-center justify-between gap-4">
            <span className="text-[9px] text-slate-400 dark:text-slate-505 italic">Last updated: just now</span>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveModal(null)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer bg-transparent"
              >
                Close
              </button>
              <button
                onClick={() => alert("Runbook document opened in a new tab.")}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer border-0"
              >
                View Runbook
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderScopeModal = () => {
    if (!result) return null;

    const factors = [
      { name: 'Services Affected', valText: '11 of 18 total', pct: 61, label: '61%' },
      { name: 'Regions Affected', valText: '3 of 5 regions', pct: 60, label: '60%' },
      { name: 'Infra Components', valText: '6 of 8 total', pct: 75, label: '75%' },
      { name: 'Customer Impact', valText: '5,000 of 5,000', pct: 100, label: '100%' },
    ];

    const getBarColor = (pct: number) => {
      if (pct > 50) return 'bg-red-500';
      if (pct >= 25) return 'bg-orange-500';
      return 'bg-green-500';
    };

    const timeline = [
      { time: '14 min ago', state: 'Isolated', desc: '1 service' },
      { time: '10 min ago', state: 'Partial', desc: '3 services' },
      { time: '5 min ago', state: 'Widespread', desc: '7 services' },
      { time: 'Now', state: 'Systemic', desc: '11 services', active: true },
    ];

    return (
      <>
        {/* Backdrop overlay */}
        <div
          className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm z-40"
          onClick={() => setActiveModal(null)}
        />

        {/* Drawer container */}
        <div className="fixed right-0 top-0 bottom-0 z-50 w-full md:w-2/3 lg:w-1/2 xl:w-2/5 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Scope Analysis
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                Cross-service failure detected
              </p>
            </div>
            <div className="flex items-center gap-3.5">
              <div className="px-2 py-0.5 rounded bg-red-500 text-white font-bold text-[10px] shadow-sm uppercase tracking-wider">
                SYSTEMIC
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-655 dark:hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
            {/* Section 1: Scope Breakdown */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Scope Breakdown
              </h4>
              <div className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl space-y-3">
                <div className="space-y-2.5">
                  {factors.map((f) => (
                    <div key={f.name} className="flex items-center justify-between gap-4 text-xs">
                      <div className="w-1/3 truncate">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{f.name}</span>
                        <div className="text-[9px] text-slate-400 dark:text-slate-500">{f.valText}</div>
                      </div>
                      <div className="w-24 bg-slate-150 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden flex-1 max-w-[120px]">
                        <div className={`h-full ${getBarColor(f.pct)} rounded-full`} style={{ width: `${f.pct}%` }} />
                      </div>
                      <span className={`font-bold text-right w-12 ${getBarColor(f.pct).replace('bg-', 'text-')}`}>
                        {f.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Section 2: Blast Zones */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Blast Zones
              </h4>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 bg-red-50/30 dark:bg-red-955/10 border border-red-200 dark:border-red-900/30 rounded-xl flex flex-col justify-between min-h-[70px]">
                  <div className="text-[8px] font-bold text-red-700 dark:text-red-400 uppercase tracking-wider">ZONE 1 - EPICENTER</div>
                  <div className="text-[11px] font-bold text-slate-800 dark:text-white truncate" title={rootLabel}>
                    {rootLabel}
                  </div>
                </div>
                <div className="p-2.5 bg-orange-50/30 dark:bg-orange-955/10 border border-orange-200 dark:border-orange-900/30 rounded-xl flex flex-col justify-between min-h-[70px]">
                  <div className="text-[8px] font-bold text-orange-700 dark:text-orange-400 uppercase tracking-wider">ZONE 2 - IMPACTED</div>
                  <div className="text-[11px] font-bold text-slate-800 dark:text-white">6 services</div>
                </div>
                <div className="p-2.5 bg-yellow-50/30 dark:bg-yellow-955/10 border border-yellow-250 dark:border-yellow-900/30 rounded-xl flex flex-col justify-between min-h-[70px]">
                  <div className="text-[8px] font-bold text-yellow-800 dark:text-yellow-450 uppercase tracking-wider">ZONE 3 - AT RISK</div>
                  <div className="text-[11px] font-bold text-slate-800 dark:text-white">7 services</div>
                </div>
              </div>
            </div>

            {/* Section 3: Scope Progression */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Scope Progression
              </h4>
              <div className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl">
                <div className="relative pl-4 border-l border-slate-200 dark:border-slate-800 space-y-3.5">
                  {timeline.map((item, idx) => (
                    <div key={idx} className="relative flex items-center justify-between text-xs">
                      {/* Timeline dot */}
                      <span className={`absolute -left-[20px] top-1 w-2.5 h-2.5 rounded-full border-2 ${item.active
                        ? 'bg-red-500 border-red-500 scale-110 shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
                        }`} />
                      <div>
                        <span className={`font-semibold ${item.active ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
                          {item.state}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 text-[10px] ml-1.5">({item.desc})</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{item.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Inline AI Copilot Integration */}
            <div className="border-t border-slate-150 dark:border-slate-800/80 pt-4">
              <InlineCopilot
                pageType="blast"
                selectedEntity="Scope Analysis"
                entityData={{
                  metric: 'scope',
                  value: 'systemic',
                  failure_source: service,
                  failure_source_label: rootLabel,
                  impacted_services_count: 11,
                  total_services_count: 18,
                  regions_affected_count: 3,
                  total_regions_count: 5,
                  infra_components_count: 6,
                  total_infra_components_count: 8,
                }}
                suggestedQuestions={[
                  `Which critical pathways determine if a scope is systemic?`,
                  `Why is the epicenter localized in ${rootLabel}?`,
                  `What regions are currently healthy?`
                ]}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/30 border-t border-slate-150 dark:border-slate-755 flex items-center justify-between gap-4">
            <span className="text-[9px] text-slate-400 dark:text-slate-500 italic">Last updated: just now</span>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveModal(null)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer bg-transparent"
              >
                Close
              </button>
              <button
                onClick={() => alert("Impact map visualizer opened.")}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer border-0"
              >
                View Impact Map
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderCustomersModal = () => {
    if (!result) return null;

    const regions = [
      { name: 'us-east', count: 2800, pct: 56, status: 'Critical', color: 'bg-red-500', textClass: 'text-red-500', dot: '🔴' },
      { name: 'eu-central', count: 1400, pct: 28, status: 'Warning', color: 'bg-orange-500', textClass: 'text-orange-500', dot: '🟡' },
      { name: 'ap-southeast', count: 800, pct: 16, status: 'Warning', color: 'bg-orange-500', textClass: 'text-orange-500', dot: '🟡' },
      { name: 'us-west', count: 0, pct: 0, status: 'Healthy', color: 'bg-green-500', textClass: 'text-green-500', dot: '🟢' },
      { name: 'eu-west', count: 0, pct: 0, status: 'Healthy', color: 'bg-green-500', textClass: 'text-green-500', dot: '🟢' },
    ];

    const segments = [
      { name: 'Enterprise customers', count: 1200 },
      { name: 'Business customers', count: 2100 },
      { name: 'Individual users', count: 1700 },
    ];

    const risks = [
      { name: 'High risk (payment blocked)', count: 3200, colorClass: 'text-red-500' },
      { name: 'Medium risk (degraded service)', count: 1800, colorClass: 'text-orange-500' },
      { name: 'Low risk (minor latency)', count: 0, colorClass: 'text-green-500' },
    ];

    return (
      <>
        {/* Backdrop overlay */}
        <div
          className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm z-40"
          onClick={() => setActiveModal(null)}
        />

        {/* Drawer container */}
        <div className="fixed right-0 top-0 bottom-0 z-50 w-full md:w-2/3 lg:w-1/2 xl:w-2/5 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Customer Impact Analysis
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                Estimated affected accounts
              </p>
            </div>
            <div className="flex items-center gap-3.5">
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-9 rounded bg-red-500 text-white flex items-center justify-center font-bold text-sm shadow-sm font-mono">
                  5,000
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-655 dark:hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
            {/* Section 1: Impact Breakdown by Region */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Impact Breakdown by Region
              </h4>
              <div className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl space-y-3.5">
                <div className="space-y-3">
                  {regions.map((r) => (
                    <div key={r.name} className="text-xs space-y-1">
                      <div className="flex justify-between items-center font-medium">
                        <span className="font-semibold text-slate-850 dark:text-slate-200 uppercase">{r.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">{r.count.toLocaleString()} customers</span>
                          <span className={`text-[10px] font-bold flex items-center gap-0.5 ${r.textClass}`}>
                            {r.dot} {r.status}
                          </span>
                        </div>
                      </div>
                      {r.pct > 0 && (
                        <div className="space-y-1">
                          <div className="w-full bg-slate-150 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div className={`h-full ${r.color} rounded-full`} style={{ width: `${r.pct}%` }} />
                          </div>
                          <div className="text-[9px] text-right font-mono font-semibold text-slate-400 dark:text-slate-500">{r.pct}%</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <hr className="border-slate-200 dark:border-slate-800/80" />
                <div className="flex justify-between items-center text-xs font-bold text-slate-900 dark:text-white pt-0.5">
                  <span>Total Base Impact:</span>
                  <span>5,000 / 5,000 (100% of base)</span>
                </div>
              </div>
            </div>

            {/* Section 2: Impact by Segment */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Impact by Segment
              </h4>
              <div className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl space-y-2.5 text-xs font-medium text-slate-750 dark:text-slate-300">
                {segments.map((s, idx) => (
                  <div key={idx} className="flex justify-between items-center">
                    <span>{s.name}:</span>
                    <span className="font-bold text-slate-900 dark:text-white font-mono">{s.count.toLocaleString()} affected</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 3: Customer Risk Level */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Customer Risk Level
              </h4>
              <div className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl space-y-2.5 text-xs font-medium">
                {risks.map((rk, idx) => (
                  <div key={idx} className="flex justify-between items-center">
                    <span className="text-slate-750 dark:text-slate-300">{rk.name}:</span>
                    <span className={`font-bold font-mono ${rk.colorClass}`}>{rk.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 4: Trend */}
            <div className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-xl flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Affected Customers Trend</div>
                <div className="text-xs text-slate-655 dark:text-slate-350 flex flex-wrap gap-x-2 gap-y-0.5">
                  <span>Started at: <span className="font-semibold font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.2 rounded">450</span></span>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <span>Peak: <span className="font-bold text-red-500 font-mono bg-red-55 dark:bg-red-955/20 px-1 py-0.2 rounded">5,000</span> (now)</span>
                </div>
                <div className="text-[10px] text-red-500 font-bold flex items-center gap-0.5 pt-0.5">
                  <span>↑ Still increasing</span>
                </div>
              </div>
              <div className="shrink-0 pl-2">
                <svg className="w-20 h-7 text-red-500" viewBox="0 0 100 30" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="M 5,28 L 25,23 L 45,15 L 65,8 L 95,2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M 5,28 L 25,23 L 45,15 L 65,8 L 95,2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-30 blur-[1px]"
                    strokeWidth="4"
                  />
                </svg>
              </div>
            </div>

            {/* Inline AI Copilot Integration */}
            <div className="border-t border-slate-150 dark:border-slate-800/80 pt-4">
              <InlineCopilot
                pageType="blast"
                selectedEntity="Customer Impact Analysis"
                entityData={{
                  metric: 'customers',
                  value: 5000,
                  failure_source: service,
                  failure_source_label: rootLabel,
                  regional_breakdown: regions.map(r => ({ region: r.name, affected: r.count })),
                  segments_breakdown: segments,
                  risk_breakdown: risks,
                }}
                suggestedQuestions={[
                  `Which enterprise customers are impacted?`,
                  `How is the regional distribution skewed?`,
                  `What mitigations can reduce individual users' payment failures?`
                ]}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/30 border-t border-slate-150 dark:border-slate-755 flex items-center justify-between gap-4">
            <span className="text-[9px] text-slate-400 dark:text-slate-500 italic">Last updated: just now</span>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveModal(null)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer bg-transparent"
              >
                Close
              </button>
              <button
                onClick={() => alert("Redirecting to Customer Status Page...")}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer border-0"
              >
                Customer Status Page
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderMetricModal = () => {
    if (!activeModal || !result) return null;

    if (activeModal === 'business_impact') {
      return renderBusinessImpactModal();
    }
    if (activeModal === 'severity') {
      return renderSeverityModal();
    }
    if (activeModal === 'scope') {
      return renderScopeModal();
    }
    if (activeModal === 'customers') {
      return renderCustomersModal();
    }

    return null;
  };

  const renderRegionModal = () => {
    if (!activeRegionModal || !result) return null;
    const rName = activeRegionModal;
    const region = REGIONS_DATA.find(r => r.id === rName);
    if (!region) return null;

    const statusBadgeClass = {
      Healthy: 'bg-green-500 text-white font-bold',
      Warning: 'bg-orange-500 text-white font-bold',
      Critical: 'bg-red-500 text-white font-bold',
    }[region.status];

    const getLatencyColorClass = (latencyStr: string) => {
      const numericVal = parseInt(latencyStr, 10);
      if (numericVal > 1000) return 'text-red-500';
      if (numericVal >= 200) return 'text-orange-500';
      return 'text-green-500';
    };

    return (
      <div className="fixed inset-0 z-[9999] flex justify-end">
        <style>{`
          @keyframes slideInFromRight {
            0% { transform: translateX(100%); }
            100% { transform: translateX(0); }
          }
          @keyframes fadeIn {
            0% { opacity: 0; }
            100% { opacity: 1; }
          }
          .animate-slide-in-right {
            animation: slideInFromRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .animate-fade-in {
            animation: fadeIn 0.2s ease-out forwards;
          }
        `}</style>
        {/* Backdrop overlay */}
        <div
          className="absolute inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setActiveRegionModal(null)}
        />

        {/* Drawer container */}
        <div className="bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 w-full max-w-[350px] shadow-2xl relative z-10 flex flex-col h-full animate-slide-in-right text-xs">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-800 dark:text-white uppercase">
                {region.name.toUpperCase()}
              </span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${statusBadgeClass}`}>
                {region.status.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="px-4 py-4 space-y-4 flex-1">
            {/* First Metric Card: Customers Affected */}
            <div className="p-3 bg-red-50/50 dark:bg-red-955/15 border border-red-200/60 dark:border-red-900/40 rounded-xl">
              <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                Customers Affected
              </div>
              <div className={`text-2xl font-black ${region.affectedCustomers > 0 ? 'text-red-650 dark:text-red-400' : 'text-green-500'}`}>
                {region.affectedCustomers.toLocaleString()}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 dark:bg-slate-900/30 border border-slate-150 dark:border-slate-700/50 rounded-xl">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">TOTAL SERVICES</div>
                <div className="text-xl font-bold text-slate-600 dark:text-slate-300">{region.totalServices}</div>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-900/30 border border-slate-150 dark:border-slate-700/50 rounded-xl">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">IMPACTED</div>
                <div className={`text-xl font-bold ${region.impacted > 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {region.impacted}
                </div>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-900/30 border border-slate-150 dark:border-slate-700/50 rounded-xl">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">FAILED PODS</div>
                <div className={`text-xl font-bold ${region.failedPods > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                  {region.failedPods}
                </div>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-900/30 border border-slate-150 dark:border-slate-700/50 rounded-xl">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">AFFECTED CUSTOMERS</div>
                <div className={`text-xl font-bold ${region.affectedCustomers > 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {region.affectedCustomers.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-900/30 border border-slate-150 dark:border-slate-700/50 rounded-xl">
              <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">AVG LATENCY</div>
              <div className={`text-xl font-bold ${getLatencyColorClass(region.avgLatency)}`}>
                {region.avgLatency}
              </div>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-700/60 pt-4">
              <InlineCopilot
                pageType="blast"
                selectedEntity={`${region.name} Regional Operations`}
                entityData={{
                  region: region.name,
                  status: region.status,
                  failed_pods: region.failedPods,
                  impacted_services: region.impacted,
                  avg_latency: region.avgLatency,
                  affected_customers: region.affectedCustomers,
                  failure_source: service,
                  failure_source_label: rootLabel,
                }}
                suggestedQuestions={[
                  `Why is the ${region.name} region showing a ${region.status} status?`,
                  `Which microservice in ${region.name} has the highest latency?`,
                  `How do we isolate the failure in ${region.name}?`
                ]}
              />
            </div>
          </div>

          {/* Footer - Close button in blue */}
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/20 border-t border-slate-100 dark:border-slate-700/60">
            <button
              onClick={() => setActiveRegionModal(null)}
              className="w-full py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors text-center cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };


  const neighborsOfSelected = useMemo(() => {
    if (!selectedNodeId || !graph) return new Set<string>();
    const neighbors = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.source === selectedNodeId) {
        neighbors.add(edge.target);
      } else if (edge.target === selectedNodeId) {
        neighbors.add(edge.source);
      }
    }
    return neighbors;
  }, [selectedNodeId, graph]);

  const activeNodes = useMemo(() => {
    const selectedNodeObj = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
    const isSelectedRed = selectedNodeObj
      ? (selectedNodeObj.data?.impactRole === 'root' || selectedNodeObj.data?.impactRole === 'impacted')
      : false;

    return nodes.map((node) => {
      const isRed = node.data?.impactRole === 'root' || node.data?.impactRole === 'impacted';

      let targetOpacity = 1.0;
      let isGlowing = false;
      let isPulsing = false;
      const isFocusMode = selectedNodeId !== null;

      if (selectedNodeId !== null) {
        if (isSelectedRed) {
          // Rule 1: WHEN RED node is clicked:
          // - Red path nodes = 100% opacity + red glow border
          // - Non-red nodes = 70% opacity
          if (isRed) {
            targetOpacity = 1.0;
            isPulsing = true;
          } else {
            targetOpacity = 0.7;
          }
        } else {
          // Rule 2: WHEN NON-RED node is clicked:
          // - Clicked node = 100% opacity + color glow
          // - Its direct neighbors = 85% opacity
          // - Everything else = 60% opacity
          if (node.id === selectedNodeId) {
            targetOpacity = 1.0;
            isGlowing = true;
          } else if (neighborsOfSelected.has(node.id)) {
            targetOpacity = 0.85;
          } else {
            targetOpacity = 0.60;
          }
        }
      } else {
        // Rule 3: NO click (default state):
        // - Everything = 100% opacity
        targetOpacity = 1.0;
      }

      return {
        ...node,
        style: {
          ...node.style,
          opacity: targetOpacity,
          transition: 'opacity 200ms ease',
        },
        data: {
          ...node.data,
          isFocusMode,
          isGlowing,
          isPulsing,
        },
      };
    });
  }, [nodes, selectedNodeId, neighborsOfSelected]);

  const activeEdges = useMemo(() => {
    const selectedNodeObj = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
    const isSelectedRed = selectedNodeObj
      ? (selectedNodeObj.data?.impactRole === 'root' || selectedNodeObj.data?.impactRole === 'impacted')
      : false;

    return edges.map((edge) => {
      const isRed = edge.data?.kind === 'impact';

      let targetOpacity = 1.0;
      let filterStyle: string | undefined = undefined;

      if (selectedNodeId !== null) {
        if (isSelectedRed) {
          // Rule 1: WHEN RED node is clicked:
          // - Red arrows = 100% opacity + glowing
          // - Non-red arrows/edges = 40% opacity
          if (isRed) {
            targetOpacity = 1.0;
            filterStyle = 'drop-shadow(0 0 5px rgba(220, 60, 60, 0.85)) drop-shadow(0 0 3px rgba(220, 60, 60, 0.5))'; // glow red!
          } else {
            targetOpacity = 0.40;
          }
        } else {
          // Rule 2: WHEN NON-RED node is clicked:
          // - Its direct edges = 100% opacity
          // - Red arrows = 50% opacity
          // - Everything else = 60% opacity
          const isConnected = edge.source === selectedNodeId || edge.target === selectedNodeId;
          if (isConnected) {
            targetOpacity = 1.0;
          } else if (isRed) {
            targetOpacity = 0.50;
          } else {
            targetOpacity = 0.60;
          }
        }
      } else {
        // Rule 3: NO click (default state):
        // - Everything = 100% opacity
        targetOpacity = 1.0;
      }

      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: targetOpacity,
          filter: filterStyle,
          transition: 'opacity 200ms ease, filter 200ms ease, stroke-width 200ms ease',
        },
      };
    });
  }, [edges, nodes, selectedNodeId]);

  return (
    <div>
      <PageHeader
        title="Impact & Blast Radius"
        description="Predict impacted services, downstream failures, and visualize blast radius on dependency graph"
      />

      {(!result || result.dataset_available === false) && !loading && (
        <DatasetUploadBanner onUploadSuccess={() => window.location.reload()} />
      )}

      <div className="flex items-center gap-4 mb-4">
        <button onClick={runAnalysis} disabled={loading} className={btnPrimary}>
          {loading ? 'Analyzing...' : 'Refresh Analysis'}
        </button>

        {availableServices.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Target Service:</span>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              disabled={loading}
              className="text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
            >
              {availableServices.map((svc) => (
                <option key={svc} value={svc}>
                  {svc}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {result && result.dataset_available !== false && (
        <>
          {/* KPI Stat Cards and ConfidenceBar */}
          <div className="mb-4 space-y-3.5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
            <ConfidenceBar value={result.business_impact_score} label="Business Impact Score" />
          </div>

          {/* Compact Modern Metadata Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col justify-start items-stretch shadow-sm">
              <div className="flex items-center gap-2 mb-2 shrink-0 select-none">
                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Currently Impacted
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                  {result.currently_impacted_services.length}
                </span>
              </div>
              <div className="flex flex-wrap content-start gap-[8px] p-[12px] flex-1 overflow-y-auto min-h-[140px] border border-slate-100 dark:border-slate-800/50 rounded-lg bg-slate-50/30 dark:bg-slate-900/10">
                {result.currently_impacted_services.length === 0 ? (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">None</p>
                ) : (
                  result.currently_impacted_services.map((item) => {
                    const isSelected = selectedNodeId === item;
                    const label = labelForId(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => selectNode(item)}
                        title={item}
                        className={`flex items-center gap-[6px] py-[4px] px-[12px] h-[28px] text-[12px] rounded-[20px] border transition-all duration-150 cursor-pointer font-semibold bg-[#fff0f0] border-[#ef4444] text-[#dc2626] hover:bg-[#ffe4e4] dark:bg-red-955/20 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-955/40 ${
                          isSelected ? 'ring-2 ring-red-500 ring-offset-1 dark:ring-offset-slate-900 scale-105 font-bold' : 'hover:scale-102 active:scale-98'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444] dark:bg-red-400 shrink-0" />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col justify-start items-stretch shadow-sm">
              <div className="flex items-center gap-2 mb-2 shrink-0 select-none">
                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Likely Downstream
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-orange-100 text-orange-700 dark:bg-orange-955/25 dark:text-orange-400">
                  {result.likely_downstream_services.length}
                </span>
              </div>
              <div className="flex flex-wrap content-start gap-[8px] p-[12px] flex-1 overflow-y-auto min-h-[140px] border border-slate-100 dark:border-slate-800/50 rounded-lg bg-slate-50/30 dark:bg-slate-900/10">
                {result.likely_downstream_services.length === 0 ? (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">None</p>
                ) : (
                  result.likely_downstream_services.map((item) => {
                    const isSelected = selectedNodeId === item;
                    const label = labelForId(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => selectNode(item)}
                        title={item}
                        className={`flex items-center gap-[6px] py-[4px] px-[12px] h-[28px] text-[12px] rounded-[20px] border transition-all duration-150 cursor-pointer font-semibold bg-[#fff7ed] border-[#f59e0b] text-[#d97706] hover:bg-[#ffedd5] dark:bg-amber-955/20 dark:border-amber-500 dark:text-amber-400 dark:hover:bg-amber-955/40 ${
                          isSelected ? 'ring-2 ring-amber-500 ring-offset-1 dark:ring-offset-slate-900 scale-105 font-bold' : 'hover:scale-102 active:scale-98'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] dark:bg-amber-400 shrink-0" />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col justify-start items-stretch shadow-sm">
              <div className="flex items-center gap-2 mb-2 shrink-0 select-none">
                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Infrastructure
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                  {result.impacted_infrastructure.length}
                </span>
              </div>
              <div className="flex flex-wrap content-start gap-[8px] p-[12px] flex-1 overflow-y-auto min-h-[140px] border border-slate-100 dark:border-slate-800/50 rounded-lg bg-slate-50/30 dark:bg-slate-900/10">
                {result.impacted_infrastructure.length === 0 ? (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">None</p>
                ) : (
                  result.impacted_infrastructure.map((item) => {
                    const isSelected = selectedNodeId === item;
                    const label = labelForId(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => selectNode(item)}
                        title={item}
                        className={`flex items-center gap-[6px] py-[4px] px-[12px] h-[28px] text-[12px] rounded-[20px] border transition-all duration-150 cursor-pointer font-semibold bg-[#eff6ff] border-[#3b82f6] text-[#2563eb] hover:bg-[#dbeafe] dark:bg-blue-955/20 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-955/40 ${
                          isSelected ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900 scale-105 font-bold' : 'hover:scale-102 active:scale-98'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] dark:bg-blue-400 shrink-0" />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-[12px] flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  Regional Health Map
                </span>
                {(selectedRegionHighlight || selectedRegionFilter) && (
                  <button
                    onClick={() => {
                      setSelectedRegionHighlight(null);
                      setSelectedRegionFilter(null);
                    }}
                    className="text-[9px] text-sky-600 hover:text-sky-700 font-bold hover:underline"
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              <style>{`
                @keyframes mapPulse {
                  0% {
                    transform: scale(0.5);
                    opacity: 0.85;
                  }
                  100% {
                    transform: scale(1.6);
                    opacity: 0;
                  }
                }
                .animate-map-pulse {
                  animation: mapPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                }
              `}</style>

              <div className="relative w-full aspect-[784/458] select-none bg-[#f8fafc] dark:bg-slate-955/20 rounded-[12px] border border-slate-100 dark:border-slate-850/50">
                <img
                  src="/world-map.svg"
                  alt="World Map"
                  className="w-full h-auto opacity-100 pointer-events-none select-none"
                />

                {REGIONS_DATA.map((r) => {
                  const coords = regionCoords[r.id] || { top: '0%', left: '0%' };
                  const isSelected = activeRegionModal === r.id || selectedRegionHighlight === r.id || selectedRegionFilter === r.id;

                  const dotColorMap = {
                    Critical: 'bg-red-500',
                    Warning: 'bg-orange-500',
                    Healthy: 'bg-green-500',
                  };

                  const pulseColorMap = {
                    Critical: 'bg-red-400',
                    Warning: 'bg-orange-400',
                    Healthy: 'bg-green-400',
                  };

                  const haloColorMap = {
                    Critical: 'bg-red-500/20',
                    Warning: 'bg-orange-500/20',
                    Healthy: 'bg-green-500/20',
                  };

                  const textColorMap = {
                    Critical: 'text-red-500 font-bold',
                    Warning: 'text-orange-500 font-bold',
                    Healthy: 'text-green-500 font-semibold',
                  };

                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setActiveRegionModal(activeRegionModal === r.id ? null : r.id);
                      }}
                      onMouseEnter={() => setHoveredRegionId(r.id)}
                      onMouseLeave={() => setHoveredRegionId(null)}
                      style={{ top: coords.top, left: coords.left }}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 group cursor-pointer focus:outline-none z-10 transition-all duration-150 flex flex-col items-center justify-start ${
                        isSelected ? 'scale-115 z-20 font-bold' : 'hover:scale-108'
                      }`}
                    >
                      <div className="relative flex items-center justify-center w-[20px] h-[20px]">
                        {/* Pulse Ring */}
                        {r.status !== 'Healthy' && (
                          <span className={`absolute inline-flex h-[20px] w-[20px] rounded-full opacity-75 animate-map-pulse ${pulseColorMap[r.status]}`} />
                        )}

                        {/* Static Translucent Halo */}
                        <span className={`absolute inline-flex h-[14px] w-[14px] rounded-full ${
                          isSelected ? 'scale-110 ring-1 ring-sky-500/40' : ''
                        } ${haloColorMap[r.status]}`} />

                        {/* Core Solid Dot (10px diameter) */}
                        <span className={`relative inline-flex rounded-full h-[10px] w-[10px] shadow-sm border border-white dark:border-slate-900 ${dotColorMap[r.status]}`} />
                      </div>

                      {/* Customer Count */}
                      <span className={`text-[9px] leading-none mt-[2px] whitespace-nowrap bg-white/80 dark:bg-slate-900/80 px-[4px] py-[1px] rounded-sm select-none border border-slate-100/50 dark:border-slate-800/50 shadow-xs transition-opacity duration-150 ease-in-out ${textColorMap[r.status]} ${hoveredRegionId === r.id ? 'opacity-0' : 'opacity-100'}`}>
                        {r.affectedCustomers.toLocaleString()}
                      </span>
                    </button>
                  );
                })}

                {/* Dynamic Tooltip positioned at the top corners of the map wrapper, away from all dots */}
                <div
                  style={{
                    position: 'absolute',
                    top: '8px',
                    ...(hoveredRegionId && regionCoords[hoveredRegionId] && parseFloat(regionCoords[hoveredRegionId].left) < 50
                      ? { right: '8px', left: 'auto' }
                      : { left: '8px', right: 'auto' }
                    ),
                    width: '160px',
                    padding: '10px 14px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 9999,
                    pointerEvents: 'none',
                    opacity: hoveredRegionId ? 1 : 0,
                    transition: 'opacity 150ms ease-in-out',
                  }}
                  className="flex flex-col items-stretch bg-white border border-[#e5e7eb] rounded-[8px] text-[12px] text-[#1f2937] leading-normal"
                >
                  {(() => {
                    const r = REGIONS_DATA.find(reg => reg.id === hoveredRegionId);
                    if (!r) return null;
                    return (
                      <>
                        <div className="flex justify-between items-center w-full font-bold text-[#1f2937] pb-1 border-b border-[#e5e7eb] mb-1.5 uppercase">
                          <span>{r.name}</span>
                          <span className="font-semibold text-[11px] whitespace-nowrap">
                            {r.status === 'Critical' ? '🔴Critical' : r.status === 'Warning' ? '🟡Warning' : '🟢Healthy'}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1 w-full text-[#4b5563] font-medium text-left">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="text-[13px] leading-none">👥</span>
                            <span>{r.affectedCustomers.toLocaleString()} customers</span>
                          </div>
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="text-[13px] leading-none">⚡</span>
                            <span>{r.incidents} active incident{r.incidents !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="text-[13px] leading-none">✅</span>
                            <span>{r.resolved} resolved</span>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Legend at bottom */}
              <div className="flex flex-col gap-1 mt-3 text-[9px] font-bold text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800/60 pt-2 shrink-0 select-none">
                <div className="flex justify-between items-center px-1">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Critical</span>
                  <span className="text-slate-400 dark:text-slate-500 font-medium">(2 regions · 3,518 customers)</span>
                </div>
                <div className="flex justify-between items-center px-1">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Warning</span>
                  <span className="text-slate-400 dark:text-slate-500 font-medium">(3 regions · 1,140 customers)</span>
                </div>
                <div className="flex justify-between items-center px-1">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Healthy</span>
                  <span className="text-slate-400 dark:text-slate-500 font-medium">(5 regions · 0 customers)</span>
                </div>
                <div className="flex justify-between items-center px-1">
                  <span className="flex items-center gap-1">📍 Pending</span>
                  <span className="text-slate-400 dark:text-slate-500 font-medium">(342 customers · locating)</span>
                </div>
              </div>

              {/* Total Bar */}
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800/50 select-none">
                <div className="flex justify-between text-[9px] font-bold text-slate-655 dark:text-slate-400 leading-normal mb-1">
                  <span>4,658 of 5,000 customers located</span>
                  <span className="text-slate-400">across 10 regions</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full" style={{ width: '93%' }} />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 xl:gap-5">
            {/* Graph: Expanded to xl:col-span-8 and h-[780px] */}
            <div className="xl:col-span-8 h-[780px] bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden flex flex-col shadow-inner">
              <div className="flex-1 min-h-0 w-full relative">
                <ReactFlow
                  className="w-full h-full"
                  nodes={activeNodes}
                  edges={activeEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
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

            {/* Right side Investigation Workflow Panel: Adjusted height h-[780px] */}
            <div className="xl:col-span-4 h-[780px] flex flex-col gap-2 pr-1">
              <div className="shrink-0">
                <IncidentPropagationSummary
                  result={result}
                  rootLabel={rootLabel}
                  selection={selectionDetail}
                  alerts={alerts}
                  symptoms={symptoms}
                  isExpanded={expandedPanel === 'dynamic'}
                  onToggle={() => setExpandedPanel(prev => prev === 'dynamic' ? null : 'dynamic')}
                  onSelectNode={(nodeId) => {
                    setSelection({ type: 'node', id: nodeId });
                    setExpandedPanel('component');
                  }}
                />
              </div>

              <div className="shrink-0">
                <BlastRadiusDetailPanel
                  rootId={service}
                  rootLabel={rootLabel}
                  selection={selectionDetail}
                  onSelectNode={selectNode}
                  onSetRootCause={handleSetRootCause}
                  result={result}
                  graph={graph}
                  isExpanded={expandedPanel === 'component'}
                  onToggle={() => setExpandedPanel(prev => prev === 'component' ? null : 'component')}
                />
              </div>

              <div className="shrink-0">
                <BlastRadiusPathChat
                  service={service}
                  selection={selectionDetail}
                  rootLabel={rootLabel}
                  isExpanded={expandedPanel === 'chat'}
                  onToggle={() => setExpandedPanel(prev => prev === 'chat' ? null : 'chat')}
                />
              </div>
            </div>
          </div>
        </>
      )}
      {renderMetricModal()}
      {renderRegionModal()}
    </div>
  );
}
