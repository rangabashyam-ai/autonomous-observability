import { useCallback, useEffect, useState } from 'react';
import ReactFlow, { Background, Controls, MarkerType, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { analyzeBlastRadius, getDependencyGraph } from '../api/client';
import type { BlastRadiusResult } from '../types/intelligence';
import { PageHeader, StatCard, ConfidenceBar, TagList, btnPrimary, mutedText } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { getGraphNodeStyle, getGraphBackgroundColor, getGraphEdgeColor } from '../utils/graphTheme';

export default function BlastRadiusDashboard() {
  const { theme } = useTheme();
  const [alerts] = useState(['CPU Saturation', 'API Error Spike']);
  const [symptoms] = useState(['Latency Increase', 'Retry Storm']);
  const [service] = useState('payment-authorization');
  const [result, setResult] = useState<BlastRadiusResult | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);

  const buildGraph = useCallback(async (blast: BlastRadiusResult, currentTheme: 'light' | 'dark') => {
    const graph = await getDependencyGraph('microservice', 'risk_score');
    const highlightSet = new Set(blast.blast_radius_nodes);
    const edgeColor = getGraphEdgeColor(currentTheme, true);

    const flowNodes: Node[] = graph.nodes.map((n, i) => {
      const isHighlighted = highlightSet.has(n.id);
      const isSource = blast.currently_impacted_services.includes(n.id);
      const role = isSource ? 'source' : isHighlighted ? 'highlighted' : 'default';
      const nodeStyle = getGraphNodeStyle(role, currentTheme);

      return {
        id: n.id,
        position: { x: (i % 6) * 160, y: Math.floor(i / 6) * 100 },
        data: { label: n.label },
        style: {
          background: nodeStyle.background,
          border: `${isSource || isHighlighted ? '2px' : '1px'} solid ${nodeStyle.border}`,
          color: nodeStyle.color,
          fontSize: 11,
          fontWeight: isSource || isHighlighted ? 600 : 400,
          padding: '8px 10px',
          borderRadius: 8,
          minWidth: 120,
          boxShadow: currentTheme === 'light' ? '0 1px 3px rgba(0,0,0,0.08)' : undefined,
        },
      };
    });

    const flowEdges: Edge[] = graph.edges
      .filter((e) => highlightSet.has(e.source) && highlightSet.has(e.target))
      .map((e, i) => ({
        id: `be-${i}`,
        source: e.source,
        target: e.target,
        animated: true,
        style: { stroke: edgeColor, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
      }));

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, []);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const r = await analyzeBlastRadius({ alerts, symptoms, service });
      setResult(r);
      await buildGraph(r, theme);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render graph when theme toggles so node text/backgrounds update
  useEffect(() => {
    if (result) {
      buildGraph(result, theme);
    }
  }, [theme, result, buildGraph]);

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

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="space-y-4">
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Currently Impacted</h3>
                <TagList items={result.currently_impacted_services} color="red" />
              </div>
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Likely Downstream</h3>
                <TagList items={result.likely_downstream_services} color="yellow" />
              </div>
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Infrastructure</h3>
                <TagList items={result.impacted_infrastructure} />
              </div>
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Regions</h3>
                <TagList items={result.impacted_regions} />
              </div>
              <ConfidenceBar value={result.business_impact_score} label="Business Impact Score" />
            </div>

            <div className="xl:col-span-2 h-[500px] bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden flex flex-col">
              <div className="flex-1 min-h-0">
                <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.3}>
                  <Background color={getGraphBackgroundColor(theme)} gap={16} />
                  <Controls />
                </ReactFlow>
              </div>
              <p className={`text-[10px] ${mutedText} px-4 py-2 border-t border-slate-200 dark:border-slate-700 shrink-0`}>
                <span className="inline-block w-2 h-2 rounded-sm bg-red-200 border border-red-600 mr-1 align-middle" />
                Red = source ·
                <span className="inline-block w-2 h-2 rounded-sm bg-yellow-200 border border-yellow-600 mx-1 align-middle" />
                Yellow = blast radius · Animated edges = impact path
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
