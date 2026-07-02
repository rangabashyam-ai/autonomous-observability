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
import DatasetUploadBanner from '../components/DatasetUploadBanner';
import DrawerAIAssistant, { type DrawerAIAssistantProps } from '../components/drilldown/DrawerAIAssistant';
import RightDrawerShell, { RightDrawerBody, RightDrawerHeader } from '../components/drilldown/RightDrawerShell';

import BlastRadiusEdge from '../components/BlastRadiusEdge';

const nodeTypes = { blastRadius: BlastRadiusNode };
const edgeTypes = { blastRadiusEdge: BlastRadiusEdge };

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
  const [selectedRegionHighlight, setSelectedRegionHighlight] = useState<string | null>(null);
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string | null>(null);
  const [activeRegionModal, setActiveRegionModal] = useState<string | null>(null);
  const [activeInvestigationDrawer, setActiveInvestigationDrawer] = useState<'propagation' | 'component' | 'investigation' | null>(null);

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
      highlightRegion: string | null,
      filterRegion: string | null,
    ) => {
      const focusedNodeId = currentSelection?.type === 'node' ? currentSelection.id : null;
      const selectedEdgeId = currentSelection?.type === 'edge' ? currentSelection.id : null;

      const regionServiceMap: Record<string, string[]> = {
        'us-east': ['payment-authorization', 'auth-service', 'api-gateway-services', 'k8s-cluster-a Pod 01', 'External LB'],
        'eu-central': ['settlement-processing', 'postgres-cluster', 'storage-cluster-1', 'internal-lb', 'merchant-services'],
        'ap-southeast': ['fraud-detection', 'redis-cluster', 'partner-integrations', 'identity-service'],
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

  const buildBlastDrawerAI = useCallback(
    (focus: string, suggestedQuestions?: string[]): DrawerAIAssistantProps | null => {
      if (!result) return null;
      return {
        pageType: 'blast',
        selectedEntity: focus,
        entityData: {
          failure_source: service,
          failure_source_label: rootLabel,
          business_impact_score: result.business_impact_score,
          severity_recommendation: result.severity_recommendation,
          issue_scope: result.issue_scope,
          impacted_customers_estimate: result.impacted_customers_estimate,
          currently_impacted_services: result.currently_impacted_services,
          likely_downstream_services: result.likely_downstream_services,
          impacted_infrastructure: result.impacted_infrastructure,
          impacted_regions: result.impacted_regions,
          selected_component: selectionDetail
            ? selectionDetail.type === 'node'
              ? {
                  type: 'node',
                  id: selectionDetail.detail.id,
                  label: selectionDetail.detail.label,
                  health: selectionDetail.detail.health,
                }
              : {
                  type: 'edge',
                  source: selectionDetail.detail.sourceLabel,
                  target: selectionDetail.detail.targetLabel,
                }
            : null,
        },
        relatedMetrics: {
          business_impact_score: result.business_impact_score,
          impacted_customers_estimate: result.impacted_customers_estimate,
        },
        suggestedQuestions:
          suggestedQuestions ?? [
            'Explain this blast radius and how the incident propagates',
            'Which downstream services are most at risk?',
            'Summarize business impact and affected customers',
            'What should we investigate next?',
          ],
      };
    },
    [result, service, rootLabel, selectionDetail]
  );

  const renderInvestigationDrawer = () => {
    if (!activeInvestigationDrawer || !result) return null;

    const drawerConfig = {
      propagation: {
        title: 'Dynamic Impact Analysis',
        subtitle: `${rootLabel} · ${result.severity_recommendation} · ${result.issue_scope}`,
        aiFocus: `Incident propagation: ${rootLabel}`,
        questions: [
          'Summarize how this incident is propagating',
          'Which services are directly impacted vs downstream?',
          'What is the estimated business impact?',
        ],
      },
      component: {
        title: 'Component Inspector',
        subtitle: selectionDetail?.type === 'node'
          ? selectionDetail.detail.label
          : selectionDetail?.type === 'edge'
            ? `${selectionDetail.detail.sourceLabel} → ${selectionDetail.detail.targetLabel}`
            : 'Select a node or edge on the graph',
        aiFocus: selectionDetail?.type === 'node'
          ? `Component: ${selectionDetail.detail.label}`
          : selectionDetail?.type === 'edge'
            ? `Dependency: ${selectionDetail.detail.sourceLabel} → ${selectionDetail.detail.targetLabel}`
            : `Component analysis: ${rootLabel}`,
        questions: [
          'Why is this component affected by the incident?',
          'What is the propagation path from the root cause?',
          'What remediation steps apply to this component?',
        ],
      },
      investigation: {
        title: 'Blast Radius Investigation',
        subtitle: `Live analysis · ${rootLabel}`,
        aiFocus: `Blast Radius: ${rootLabel}`,
        questions: [
          'Explain this blast radius and how the incident propagates',
          'Which downstream services are most at risk?',
          'Summarize business impact and affected customers',
          'What should we investigate next?',
        ],
      },
    }[activeInvestigationDrawer];

    const drawerAI = buildBlastDrawerAI(drawerConfig.aiFocus, drawerConfig.questions);

    return (
      <RightDrawerShell
        isOpen
        onClose={() => setActiveInvestigationDrawer(null)}
        zIndexClass="z-[9999]"
        ariaLabel={drawerConfig.title}
        disableAutoAI
      >
        <RightDrawerHeader
          title={drawerConfig.title}
          subtitle={drawerConfig.subtitle}
          onClose={() => setActiveInvestigationDrawer(null)}
        />
        <RightDrawerBody className="px-4 py-4 space-y-4">
          {activeInvestigationDrawer === 'propagation' && (
            <IncidentPropagationSummary
              result={result}
              rootLabel={rootLabel}
              selection={selectionDetail}
              alerts={alerts}
              symptoms={symptoms}
              contentOnly
            />
          )}
          {activeInvestigationDrawer === 'component' && (
            <BlastRadiusDetailPanel
              rootId={service}
              rootLabel={rootLabel}
              selection={selectionDetail}
              onSelectNode={selectNode}
              onSetRootCause={handleSetRootCause}
              result={result}
              graph={graph}
              contentOnly
            />
          )}
          {activeInvestigationDrawer === 'investigation' && (
            <p className="text-sm text-text-secondary">
              Ask questions about blast radius propagation, impacted services, infrastructure dependencies,
              and recommended investigation steps for <strong className="text-text-primary">{rootLabel}</strong>.
            </p>
          )}
          {drawerAI && <DrawerAIAssistant {...drawerAI} embedded />}
        </RightDrawerBody>
      </RightDrawerShell>
    );
  };

  const buildMetricDrawerAI = (modalTitle: string, modalKey: string): DrawerAIAssistantProps => ({
    pageType: 'blast',
    selectedEntity: modalTitle,
    entityData: {
      analysis_type: modalKey,
      failure_source: service,
      failure_source_label: rootLabel,
      business_impact_score: result?.business_impact_score,
      severity_recommendation: result?.severity_recommendation,
      issue_scope: result?.issue_scope,
      impacted_customers_estimate: result?.impacted_customers_estimate,
    },
    relatedMetrics: {
      business_impact_score: result?.business_impact_score ?? 0,
      impacted_customers_estimate: result?.impacted_customers_estimate ?? 0,
    },
    suggestedQuestions: [
      `How is ${modalTitle.toLowerCase()} calculated for this incident?`,
      'What is driving the current blast radius score?',
      'Which services should we prioritize based on this metric?',
    ],
  });

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
              <span className="font-mono text-slate-800 dark:text-slate-200">{service}</span>
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
      <RightDrawerShell
        isOpen
        onClose={() => setActiveModal(null)}
        zIndexClass="z-[9999]"
        ariaLabel={`${title} analysis`}
        aiAssistant={buildMetricDrawerAI(`${title} Analysis`, activeModal)}
      >
        <RightDrawerHeader title={`${title} Analysis`} onClose={() => setActiveModal(null)} />
        <RightDrawerBody className="px-6 py-5">{explanation}</RightDrawerBody>
        <div className="flex justify-end px-6 py-3.5 bg-card-hover/40 border-t border-border shrink-0">
          <button
            onClick={() => setActiveModal(null)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-text-primary hover:bg-card-hover transition-colors"
          >
            Close
          </button>
        </div>
      </RightDrawerShell>
    );
  };

  const getRegionStatus = useCallback((rName: string) => {
    if (!result) return 'Healthy';

    const regionServiceMap: Record<string, string[]> = {
      'us-east': ['payment-authorization', 'auth-service', 'api-gateway-services', 'k8s-cluster-a Pod 01', 'External LB'],
      'eu-central': ['settlement-processing', 'postgres-cluster', 'storage-cluster-1', 'internal-lb', 'merchant-services'],
      'ap-southeast': ['fraud-detection', 'redis-cluster', 'partner-integrations', 'identity-service'],
    };

    const isOriginRegion = regionServiceMap[rName]?.some(
      s => s.toLowerCase() === service.toLowerCase()
    );
    const hasImpactedServices = result.currently_impacted_services.some(s =>
      regionServiceMap[rName]?.some(ls => ls.toLowerCase() === s.toLowerCase() || s.toLowerCase().includes(ls.toLowerCase()))
    );

    if (isOriginRegion && result.severity_recommendation === 'P1') {
      return 'Critical';
    }
    if (hasImpactedServices || result.impacted_regions.includes(rName)) {
      return 'Warning';
    }
    return 'Healthy';
  }, [result, service]);

  const renderRegionModal = () => {
    if (!activeRegionModal || !result) return null;
    const rName = activeRegionModal;

    const status = getRegionStatus(rName);

    const regionServiceMap: Record<string, string[]> = {
      'us-east': ['payment-authorization', 'auth-service', 'api-gateway-services', 'k8s-cluster-a Pod 01', 'External LB'],
      'eu-central': ['settlement-processing', 'postgres-cluster', 'storage-cluster-1', 'internal-lb', 'merchant-services'],
      'ap-southeast': ['fraud-detection', 'redis-cluster', 'partner-integrations', 'identity-service'],
    };

    const localServices = regionServiceMap[rName] || [];

    // Impacted services = currently_impacted_services & localServices
    const impactedServices = result.currently_impacted_services.filter(s =>
      localServices.some(ls => ls.toLowerCase() === s.toLowerCase() || s.toLowerCase().includes(ls.toLowerCase()))
    );

    const failedPods = result.impacted_infrastructure.filter(infra =>
      localServices.some(ls => infra.toLowerCase() === ls.toLowerCase() || infra.toLowerCase().includes(ls.toLowerCase()))
    );

    let affectedCustomers = 0;
    let latency = '45ms';

    if (status === 'Critical') {
      affectedCustomers = result.impacted_customers_estimate;
      latency = '840ms';
    } else if (status === 'Warning') {
      affectedCustomers = Math.round(result.impacted_customers_estimate * 0.35);
      latency = '310ms';
    }

    const statusBadgeClass = {
      Healthy: 'bg-green-100 dark:bg-green-955/40 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900',
      Warning: 'bg-amber-105 dark:bg-amber-955/40 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50',
      Critical: 'bg-red-105 dark:bg-red-955/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50',
    }[status];

    const statusEmojiMap = {
      Healthy: '🟢',
      Warning: '🟡',
      Critical: '🔴',
    };
    const statusEmoji = statusEmojiMap[status] || '🟢';

    return (
      <RightDrawerShell
        isOpen
        onClose={() => setActiveRegionModal(null)}
        zIndexClass="z-[9999]"
        ariaLabel={`Region ${rName}`}
        aiAssistant={{
          pageType: 'blast',
          selectedEntity: `Region ${rName}`,
          entityData: {
            region: rName,
            status,
            impacted_services: impactedServices,
            failed_pods: failedPods,
            affected_customers: affectedCustomers,
            avg_latency: latency,
            failure_source: service,
            failure_source_label: rootLabel,
          },
          relatedMetrics: {
            affected_customers: affectedCustomers,
            impacted_service_count: impactedServices.length,
          },
          suggestedQuestions: [
            `What is the blast radius impact in ${rName}?`,
            'Which services in this region are most affected?',
            'How many customers are impacted in this region?',
            'What remediation steps should we take for this region?',
          ],
        }}
      >
        <RightDrawerHeader title={rName.toUpperCase()} onClose={() => setActiveRegionModal(null)}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-text-primary uppercase">{rName}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${statusBadgeClass}`}>
              {statusEmoji} {status}
            </span>
          </div>
        </RightDrawerHeader>
        <RightDrawerBody className="px-4 py-3.5 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 bg-card-hover border border-border rounded-lg">
              <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wider mb-0.5">Total Services</div>
              <div className="text-xs font-semibold text-text-primary">{localServices.length}</div>
            </div>
            <div className="p-2 bg-card-hover border border-border rounded-lg">
              <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wider mb-0.5">Impacted</div>
              <div className={`text-xs font-bold ${impactedServices.length > 0 ? 'text-critical' : 'text-success'}`}>
                {impactedServices.length}
              </div>
            </div>
            <div className="p-2 bg-card-hover border border-border rounded-lg">
              <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wider mb-0.5">Failed Pods</div>
              <div className={`text-xs font-semibold ${failedPods.length > 0 ? 'text-warning' : 'text-text-secondary'}`}>
                {failedPods.length}
              </div>
            </div>
            <div className="p-2 bg-card-hover border border-border rounded-lg">
              <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wider mb-0.5">Affected Customers</div>
              <div className="text-xs font-semibold text-primary">{affectedCustomers.toLocaleString()}</div>
            </div>
            <div className="p-2 bg-card-hover border border-border rounded-lg col-span-2">
              <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wider mb-0.5">Avg Latency</div>
              <div className={`text-xs font-semibold ${status === 'Critical' ? 'text-critical' : status === 'Warning' ? 'text-warning' : 'text-success'}`}>
                {latency}
              </div>
            </div>
          </div>
        </RightDrawerBody>
        <div className="px-4 py-3 border-t border-border shrink-0">
          <button
            onClick={() => setActiveRegionModal(null)}
            className="w-full py-2 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-white transition-colors"
          >
            Close
          </button>
        </div>
      </RightDrawerShell>
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

      <div className="flex gap-3 mb-4">
        <button onClick={runAnalysis} disabled={loading} className={btnPrimary}>
          {loading ? 'Analyzing...' : 'Refresh Analysis'}
        </button>
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
            <div className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 block">
                Currently Impacted
              </span>
              <div className="flex-1 overflow-y-auto max-h-[80px] pr-1">
                <BlastRadiusClickableTags
                  items={result.currently_impacted_services}
                  color="red"
                  selectedId={selectedNodeId}
                  labelFor={labelForId}
                  onSelect={selectNode}
                />
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 block">
                Likely Downstream
              </span>
              <div className="flex-1 overflow-y-auto max-h-[80px] pr-1">
                <BlastRadiusClickableTags
                  items={result.likely_downstream_services}
                  color="yellow"
                  selectedId={selectedNodeId}
                  labelFor={labelForId}
                  onSelect={selectNode}
                />
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col justify-between shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 block">
                Infrastructure
              </span>
              <div className="flex-1 overflow-y-auto max-h-[80px] pr-1">
                <BlastRadiusClickableTags
                  items={result.impacted_infrastructure}
                  color="blue"
                  selectedId={selectedNodeId}
                  labelFor={labelForId}
                  onSelect={selectNode}
                />
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  Regions
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
              <div className="flex-1 overflow-y-auto max-h-[80px] pr-1">
                <div className="flex flex-wrap gap-1.5">
                  {['us-east', 'eu-central', 'ap-southeast'].map((r) => {
                    const status = getRegionStatus(r);

                    const isSelected = activeRegionModal === r || selectedRegionHighlight === r || selectedRegionFilter === r;

                    const statusEmojiMap = {
                      Healthy: '🟢',
                      Warning: '🟡',
                      Critical: '🔴',
                    };
                    const statusEmoji = statusEmojiMap[status] || '🟢';

                    // Compute impacted service count dynamically:
                    const regionServiceMap: Record<string, string[]> = {
                      'us-east': ['payment-authorization', 'auth-service', 'api-gateway-services', 'k8s-cluster-a Pod 01', 'External LB'],
                      'eu-central': ['settlement-processing', 'postgres-cluster', 'storage-cluster-1', 'internal-lb', 'merchant-services'],
                      'ap-southeast': ['fraud-detection', 'redis-cluster', 'partner-integrations', 'identity-service'],
                    };
                    const localServices = regionServiceMap[r] || [];
                    const impactedCount = result.currently_impacted_services.filter(s =>
                      localServices.some(ls => ls.toLowerCase() === s.toLowerCase() || s.toLowerCase().includes(ls.toLowerCase()))
                    ).length;

                    const chipBgMap = {
                      Healthy: 'bg-green-50/50 hover:bg-green-50 dark:bg-green-955/15 dark:hover:bg-green-955/25 border-green-200 dark:border-green-900/50 text-green-700 dark:text-green-400',
                      Warning: 'bg-amber-50/50 hover:bg-amber-50 dark:bg-amber-955/15 dark:hover:bg-amber-955/25 border-amber-250 dark:border-amber-900/50 text-amber-800 dark:text-amber-400',
                      Critical: 'bg-red-50/50 hover:bg-red-50 dark:bg-red-955/15 dark:hover:bg-red-955/25 border-red-200 dark:border-red-900/50 text-red-750 dark:text-red-450',
                    };

                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => {
                          setActiveRegionModal(activeRegionModal === r ? null : r);
                        }}
                        className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer font-medium ${chipBgMap[status]} ${isSelected ? 'ring-2 ring-sky-500 ring-offset-1 dark:ring-offset-slate-900 scale-105' : ''
                          }`}
                      >
                        <span>{r} {statusEmoji} {impactedCount}</span>
                      </button>
                    );
                  })}
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
                  onOpenDrawer={() => setActiveInvestigationDrawer('propagation')}
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
                  onOpenDrawer={() => setActiveInvestigationDrawer('component')}
                />
              </div>

              <button
                type="button"
                onClick={() => setActiveInvestigationDrawer('investigation')}
                className="shrink-0 w-full bg-white dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-sm overflow-hidden hover:bg-[#f9fafb] dark:hover:bg-slate-750/30 transition-colors"
              >
                <div className="flex items-center justify-between px-4 h-[48px] gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 text-base">🤖</span>
                    <span className="font-bold text-slate-850 dark:text-slate-250 truncate text-xs sm:text-sm">
                      Blast Radius Investigation
                    </span>
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 px-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-955/20 text-emerald-700 dark:text-emerald-450 border border-emerald-200 dark:border-emerald-900/50 flex items-center gap-1.5">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                      </span>
                      Live
                    </span>
                  </div>
                  <span className="text-slate-400 dark:text-slate-500 p-1 shrink-0" style={{ transform: 'rotate(-90deg)' }}>
                    ▼
                  </span>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
      {renderMetricModal()}
      {renderRegionModal()}
      {renderInvestigationDrawer()}
    </div>
  );
}
