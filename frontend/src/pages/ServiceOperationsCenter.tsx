import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import ReactFlow, { Background, Controls, MiniMap, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { getMonitoringDashboard, getOverview, getDependencyGraph, getDependencyPaths } from '../api/client';
import type { MonitoringDashboard, ServiceMetric, GraphNode as APIGraphNode } from '../types/api';
import type { Overview } from '../types/intelligence';
import { PageHeader, Grid12, CollapsibleSection } from '../components/ui/layout-primitives';
import { MetricCard } from '../components/ui/metric-card';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { DataTable, HealthBadge } from '../components/ui/data-table';
import { generateTrend, MiniLineChart, TrendChart } from '../components/charts/charts';
import { useTheme } from '../context/ThemeContext';
import { getHealthNodeStyle } from '../utils/graphTheme';
import DrilldownDrawer, { DrilldownSection, DrilldownMetricCard, DrilldownButton } from '../components/drilldown/DrilldownDrawer';
import AIInsightsPanel from '../components/drilldown/AIInsightsPanel';
import RelatedResourcesPanel from '../components/drilldown/RelatedResourcesPanel';
import { AlertCircle, Sparkles, ChevronRight, ExternalLink, Activity, Zap, Network } from 'lucide-react';
import InlineCopilot from '../components/copilot/InlineCopilot';

export default function ServiceOperationsCenter() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [monitoring, setMonitoring] = useState<MonitoringDashboard | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [graphNodes, setGraphNodes] = useState<Node[]>([]);
  const [graphEdges, setGraphEdges] = useState<Edge[]>([]);
  const [rawGraphNodes, setRawGraphNodes] = useState<APIGraphNode[]>([]);

  // Drilldown drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<APIGraphNode | null>(null);
  const [selectedNodeDeps, setSelectedNodeDeps] = useState<{ upstream: any[]; downstream: any[] } | null>(null);

  useEffect(() => {
    Promise.all([
      getMonitoringDashboard(),
      getOverview(),
      getDependencyGraph('microservice', 'latency'),
    ])
      .then(([m, o, g]) => {
        setMonitoring(m);
        setOverview(o);
        setRawGraphNodes(g.nodes);
        const nodes: Node[] = g.nodes.slice(0, 12).map((n, i) => {
          const angle = (i / Math.min(g.nodes.length, 12)) * 2 * Math.PI;
          const r = 180;
          return {
            id: n.id,
            data: { label: n.label },
            position: { x: 250 + r * Math.cos(angle), y: 200 + r * Math.sin(angle) },
            style: {
              ...getHealthNodeStyle(n.health, theme),
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              borderWidth: '2px',
              borderStyle: 'solid',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '12px',
              fontWeight: 600,
            },
          };
        });
        const nodeIds = new Set(nodes.map((n) => n.id));
        const edges: Edge[] = g.edges
          .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
          .slice(0, 20)
          .map((e) => ({
            id: `${e.source}-${e.target}`,
            source: e.source,
            target: e.target,
            animated: true,
            style: { stroke: theme === 'dark' ? '#3B82F6' : '#2563EB', strokeWidth: 1.5 },
          }));
        setGraphNodes(nodes);
        setGraphEdges(edges);
      })
      .catch(console.error);
  }, [theme]);

  const services = monitoring?.service.services ?? [];
  const exec = monitoring?.executive;

  const avgLatency = useMemo(
    () => (services.length ? services.reduce((a, s) => a + s.latency_p99_ms, 0) / services.length : 0),
    [services]
  );
  const avgError = useMemo(
    () => (services.length ? services.reduce((a, s) => a + s.error_rate, 0) / services.length : 0),
    [services]
  );

  const latencyTrend = useMemo(() => generateTrend(avgLatency, 12), [avgLatency]);
  const errorTrend = useMemo(() => generateTrend(avgError, 12, 0.2), [avgError]);

  const topRisks = useMemo(() => {
    return [...services]
      .sort((a, b) => {
        const score = (s: ServiceMetric) =>
          (s.health === 'critical' ? 3 : s.health === 'warning' ? 2 : 1) * 100 + s.error_rate * 10 + s.latency_p99_ms * 0.1;
        return score(b) - score(a);
      })
      .slice(0, 4);
  }, [services]);

  const handleServiceClick = useCallback((serviceId: string, _label: string) => {
    let graphNode = rawGraphNodes.find((n) => n.id === serviceId);
    if (!graphNode) {
      const matched = services.find((s) => s.id === serviceId);
      if (matched) {
        graphNode = {
          id: matched.id,
          label: matched.name,
          type: 'microservice',
          status: matched.health,
          health: matched.health,
          metrics: {
            cpu: Math.random() * 30 + 40,
            memory: Math.random() * 30 + 50,
            latency: matched.latency_p99_ms,
            error_rate: matched.error_rate,
            risk_score: matched.health === 'critical' ? 85 : matched.health === 'warning' ? 55 : 20,
            incident_count: matched.health === 'critical' ? 2 : 0,
          }
        } as any;
      }
    }
    if (graphNode) {
      setSelectedNode(graphNode);
      setDrawerOpen(true);
      getDependencyPaths(serviceId)
        .then((paths) => {
          setSelectedNodeDeps({
            upstream: paths.upstream || [],
            downstream: paths.downstream || [],
          });
        })
        .catch(() => {
          setSelectedNodeDeps({ upstream: [], downstream: [] });
        });
    }
  }, [rawGraphNodes, services]);

  // Handle dependency graph node click → open drilldown drawer
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      handleServiceClick(node.id, node.data?.label || node.id);
    },
    [handleServiceClick]
  );

  const copilotContext = useMemo(() => {
    if (!monitoring || !overview) return null;
    return {
      pageType: 'service' as const,
      selectedEntity: 'service-operations',
      entityData: {
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          health: s.health,
          latency: s.latency_p99_ms,
          error_rate: s.error_rate,
          availability: s.availability,
        })),
        top_risks: topRisks.map((s) => s.id),
      },
      relatedAlerts: overview.open_alerts_preview ?? [],
      relatedIncidents: overview.recent_incidents ?? [],
      relatedMetrics: {
        avg_latency: avgLatency,
        avg_error_rate: avgError,
        active_incidents: exec?.active_incidents,
      },
    };
  }, [monitoring, overview, services, topRisks, avgLatency, avgError, exec]);

  useRegisterCopilotContext(copilotContext);

  if (!monitoring || !overview) {
    return <p className="text-text-secondary text-sm">Loading service operations center...</p>;
  }

  // Build related resources for the drawer from dependencies
  const drawerRelatedResources = selectedNodeDeps
    ? [
        ...selectedNodeDeps.upstream.map((dep: any) => ({
          id: dep.node,
          name: dep.node.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          type: 'service' as const,
          relationship: 'upstream' as const,
          health: 'healthy' as const,
          metrics: [{ label: 'Relationship', value: dep.relationship || 'depends_on' }],
        })),
        ...selectedNodeDeps.downstream.map((dep: any) => ({
          id: dep.node,
          name: dep.node.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          type: 'service' as const,
          relationship: 'downstream' as const,
          health: 'healthy' as const,
          metrics: [{ label: 'Relationship', value: dep.relationship || 'provides_to' }],
        })),
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="Service Operations Center"
        description="Operational monitoring, dependency mapping, and incident correlation"
      />

      {/* ─── Top Metric Cards (clickable) ─── */}
      <Grid12 className="mb-4">
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Services Monitored"
            value={services.length}
            sub={`${services.filter((s) => s.health === 'healthy').length} healthy`}
            onClick={() => {
              document.getElementById('service-health-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Active Incidents"
            value={exec!.active_incidents}
            variant={exec!.active_incidents > 0 ? 'critical' : 'success'}
            onClick={() => navigate('/incidents?active=true')}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Avg P99 Latency"
            value={`${avgLatency.toFixed(0)}ms`}
            variant="warning"
            onClick={() => {
              document.getElementById('latency-trends-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Avg Error Rate"
            value={`${avgError.toFixed(2)}%`}
            variant={avgError > 1.5 ? 'critical' : 'default'}
            onClick={() => {
              document.getElementById('error-trends-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        </div>
      </Grid12>

      <Grid12>
        <div className="col-span-12 xl:col-span-8 space-y-4">
          {/* ─── Service Health Table (full row clickable) ─── */}
          <div id="service-health-section">
            <CollapsibleSection title="Service Health Overview" defaultOpen>
              <Card padding={false}>
                <DataTable
                  compact
                  data={services}
                  onRowClick={(s) => handleServiceClick(s.id, s.name)}
                  columns={[
                    {
                      key: 'name',
                      header: 'Service',
                      render: (s) => (
                        <div className="flex items-center gap-2">
                          <Activity className="h-3.5 w-3.5 text-primary/60" />
                          <span className="font-medium text-primary">{s.name}</span>
                          <ChevronRight className="h-3 w-3 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      ),
                    },
                    { key: 'health', header: 'Status', render: (s) => <HealthBadge health={s.health} /> },
                    {
                      key: 'latency',
                      header: 'P99 Latency',
                      render: (s) => <span className="font-mono text-xs">{s.latency_p99_ms.toFixed(1)}ms</span>,
                    },
                    {
                      key: 'error',
                      header: 'Error Rate',
                      render: (s) => <span className="font-mono text-xs">{s.error_rate.toFixed(2)}%</span>,
                    },
                    {
                      key: 'avail',
                      header: 'Availability',
                      render: (s) => <span className="font-mono text-xs">{s.availability.toFixed(2)}%</span>,
                    },
                    {
                      key: 'rps',
                      header: 'Throughput',
                      render: (s) => <span className="font-mono text-xs">{s.throughput_rps.toFixed(0)} rps</span>,
                    },
                    {
                      key: 'action',
                      header: '',
                      render: () => (
                        <ChevronRight className="h-4 w-4 text-text-secondary/50" />
                      ),
                    },
                  ]}
                />
              </Card>
            </CollapsibleSection>
          </div>

          {/* ─── Service Dependency Graph (clickable nodes) ─── */}
          <CollapsibleSection title="Service Dependency Graph" defaultOpen>
            <Card padding={false} className="overflow-hidden">
              <div className="h-[320px] relative">
                <ReactFlow
                  nodes={graphNodes}
                  edges={graphEdges}
                  fitView
                  nodesDraggable
                  nodesConnectable={false}
                  onNodeClick={onNodeClick}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color={theme === 'dark' ? '#1F2937' : '#E2E8F0'} gap={16} />
                  <Controls showInteractive={false} />
                  <MiniMap
                    nodeColor={() => (theme === 'dark' ? '#3B82F6' : '#2563EB')}
                    maskColor={theme === 'dark' ? '#0B122080' : '#F8FAFC80'}
                  />
                </ReactFlow>
                {/* Hint overlay */}
                <div className="absolute bottom-3 left-3 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-1.5 text-[10px] text-text-secondary flex items-center gap-1.5 pointer-events-none">
                  <Network className="h-3 w-3" />
                  Click any node to investigate
                </div>
              </div>
            </Card>
          </CollapsibleSection>

          {/* ─── Latency & Error Trend Charts ─── */}
          <Grid12>
            <div className="col-span-12 md:col-span-6" id="latency-trends-section">
              <Card>
                <CardHeader><CardTitle>Latency Trends</CardTitle></CardHeader>
                <TrendChart data={latencyTrend} height={120} color="#F59E0B" />
              </Card>
            </div>
            <div className="col-span-12 md:col-span-6" id="error-trends-section">
              <Card>
                <CardHeader><CardTitle>Error Rate Trends</CardTitle></CardHeader>
                <TrendChart data={errorTrend} height={120} color="#EF4444" />
              </Card>
            </div>
          </Grid12>
        </div>

        {/* ─── Sidebar ─── */}
        <div className="col-span-12 xl:col-span-4 space-y-4">
          {/* Active Incidents (already clickable) */}
          <Card>
            <CardHeader>
              <CardTitle>Active Incidents</CardTitle>
              <Link to="/incidents?active=true" className="text-xs text-primary hover:underline">All →</Link>
            </CardHeader>
            <div className="space-y-2">
              {overview.recent_incidents.slice(0, exec?.active_incidents || 2).map((inc) => (
                <Link
                  key={inc.incident_id}
                  to={`/incidents?id=${inc.incident_id}`}
                  className="block p-3 rounded-lg border border-border bg-background hover:bg-card-hover hover:shadow-sm transition-all duration-200"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={inc.severity.startsWith('P1') || inc.severity === '1' ? 'critical' : 'warning'}>
                      {inc.severity}
                    </Badge>
                    <span className="text-[10px] text-text-secondary">{inc.service}</span>
                  </div>
                  <p className="text-xs text-text-primary line-clamp-2">{inc.title}</p>
                </Link>
              ))}
            </div>
          </Card>

          {/* ─── Top Risks (now clickable) ─── */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-warning" />
                <CardTitle>Top Risks</CardTitle>
              </div>
            </CardHeader>
            <div className="space-y-2">
              {topRisks.map((s) => (
                <div
                  key={s.id}
                  onClick={() => handleServiceClick(s.id, s.name)}
                  className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border/50 bg-background hover:bg-card-hover hover:border-border hover:shadow-sm transition-all duration-200 group cursor-pointer text-left"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-text-primary truncate font-medium group-hover:text-primary transition-colors">{s.name}</p>
                    <p className="text-[10px] text-text-secondary">
                      {s.error_rate.toFixed(2)}% errors · {s.latency_p99_ms.toFixed(0)}ms
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <HealthBadge health={s.health} />
                    <ChevronRight className="h-3 w-3 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* ─── AI Recommendations (now clickable) ─── */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle>AI Recommendations</CardTitle>
              </div>
              <Link to="/early-detection" className="text-xs text-primary hover:underline">View all →</Link>
            </CardHeader>
            <div className="space-y-2">
              {overview.early_detections.slice(0, 3).map((d) => (
                <Link
                  key={d.pattern_id}
                  to="/early-detection"
                  className="block p-3 rounded-lg border border-border bg-background hover:bg-card-hover hover:border-primary/30 hover:shadow-sm transition-all duration-200 group"
                >
                  <p className="text-xs text-text-primary group-hover:text-primary transition-colors">{d.recommended_actions[0] ?? 'Investigate anomaly pattern'}</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[10px] text-text-secondary">
                      {d.expected_impacted_service} · {d.confidence}% confidence
                    </p>
                    <ExternalLink className="h-3 w-3 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
              {overview.early_detections.length === 0 && (
                <p className="text-xs text-text-secondary">No active recommendations</p>
              )}
            </div>
          </Card>

          {/* ─── Predicted Incidents (now clickable) ─── */}
          <Card>
            <CardHeader>
              <CardTitle>Predicted Incidents</CardTitle>
              <Link to="/early-detection" className="text-xs text-primary hover:underline">Analyze →</Link>
            </CardHeader>
            {overview.early_detections.length === 0 ? (
              <p className="text-xs text-text-secondary">No predicted incidents in next 4 hours</p>
            ) : (
              overview.early_detections.map((d) => (
                <Link
                  key={d.pattern_id}
                  to="/early-detection"
                  className="block mb-3 last:mb-0 p-3 -mx-1 rounded-lg hover:bg-card-hover transition-all duration-200 group"
                >
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-primary font-medium group-hover:text-primary transition-colors">{d.expected_impacted_service}</span>
                    <span className="text-critical font-mono font-semibold">{d.estimated_time_to_incident_minutes}m</span>
                  </div>
                  <MiniLineChart data={generateTrend(d.confidence, 8)} height={40} color="#EF4444" />
                </Link>
              ))
            )}
          </Card>
        </div>
      </Grid12>

      {/* ─── Incident Timeline (clickable bars) ─── */}
      <CollapsibleSection title="Incident Timeline" className="mt-6" defaultOpen>
        <Card>
          <div className="flex gap-1 overflow-x-auto pb-2">
            {Array.from({ length: 24 }, (_, h) => {
              const matchingIncident = overview.recent_incidents.find((_, i) => i === h % 4);
              const hasIncident = !!matchingIncident;
              return (
                <div
                  key={h}
                  onClick={() => {
                    if (matchingIncident) {
                      navigate(`/incidents?id=${matchingIncident.incident_id}`);
                    } else {
                      navigate(`/incidents`);
                    }
                  }}
                  className="flex flex-col items-center gap-1 min-w-[32px] cursor-pointer group"
                  title={matchingIncident ? `${h}:00 — Click to view ${matchingIncident.title}` : `${h}:00 — Click to view incidents`}
                >
                  <div
                    className={`h-8 w-full rounded-sm transition-all duration-200 group-hover:scale-y-110 group-hover:shadow-md ${
                      hasIncident
                        ? 'bg-critical/70 group-hover:bg-critical'
                        : h >= 8 && h <= 18
                        ? 'bg-success/40 group-hover:bg-success/60'
                        : 'bg-success/20 group-hover:bg-success/40'
                    }`}
                  />
                  <span className="text-[9px] text-text-secondary group-hover:text-text-primary transition-colors">{h}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </CollapsibleSection>

      {/* ─── Dependency Node Drilldown Drawer ─── */}
      <DrilldownDrawer
        isOpen={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedNode(null); setSelectedNodeDeps(null); }}
        title={selectedNode?.label ?? ''}
        subtitle={selectedNode?.id}
        type="service"
        health={selectedNode?.health as 'healthy' | 'warning' | 'critical' | undefined}
        actions={
          selectedNode ? (
            <>
              <DrilldownButton onClick={() => navigate(`/services/${selectedNode.id}`)}>
                View Full Details
              </DrilldownButton>
              <DrilldownButton onClick={() => navigate(`/rca?service=${selectedNode.id}`)} variant="secondary">
                Run RCA
              </DrilldownButton>
              <DrilldownButton onClick={() => navigate(`/blast-radius?service=${selectedNode.id}`)} variant="secondary">
                Blast Radius
              </DrilldownButton>
            </>
          ) : undefined
        }
      >
        {selectedNode && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <DrilldownSection title="Key Metrics" icon={<Activity className="w-4 h-4" />}>
              <div className="grid grid-cols-2 gap-3">
                <DrilldownMetricCard
                  label="CPU Usage"
                  value={selectedNode.metrics.cpu.toFixed(1)}
                  unit="%"
                  status={selectedNode.metrics.cpu > 80 ? 'critical' : selectedNode.metrics.cpu > 60 ? 'warning' : 'good'}
                />
                <DrilldownMetricCard
                  label="Memory"
                  value={selectedNode.metrics.memory.toFixed(1)}
                  unit="%"
                  status={selectedNode.metrics.memory > 85 ? 'critical' : selectedNode.metrics.memory > 70 ? 'warning' : 'good'}
                />
                <DrilldownMetricCard
                  label="Latency"
                  value={selectedNode.metrics.latency.toFixed(1)}
                  unit="ms"
                  status={selectedNode.metrics.latency > 100 ? 'warning' : 'good'}
                />
                <DrilldownMetricCard
                  label="Error Rate"
                  value={selectedNode.metrics.error_rate.toFixed(2)}
                  unit="%"
                  status={selectedNode.metrics.error_rate > 2 ? 'critical' : selectedNode.metrics.error_rate > 0.5 ? 'warning' : 'good'}
                />
                <DrilldownMetricCard
                  label="Risk Score"
                  value={selectedNode.metrics.risk_score.toFixed(0)}
                  status={selectedNode.metrics.risk_score > 70 ? 'critical' : selectedNode.metrics.risk_score > 40 ? 'warning' : 'good'}
                />
                <DrilldownMetricCard
                  label="Incidents"
                  value={selectedNode.metrics.incident_count}
                  status={selectedNode.metrics.incident_count > 5 ? 'critical' : selectedNode.metrics.incident_count > 0 ? 'warning' : 'good'}
                />
              </div>
            </DrilldownSection>

            {/* AI Insights */}
            <AIInsightsPanel
              insights={[]}
              entityType="service"
              entityName={selectedNode.label}
              health={selectedNode.health as 'healthy' | 'warning' | 'critical'}
            />

            {/* Dependencies */}
            <DrilldownSection title="Dependencies" icon={<Network className="w-4 h-4" />}>
              {selectedNodeDeps ? (
                <RelatedResourcesPanel resources={drawerRelatedResources} title="Connected Services" />
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">Loading dependencies...</p>
              )}
            </DrilldownSection>

            {/* Quick Navigation */}
            <DrilldownSection title="Quick Actions" icon={<Zap className="w-4 h-4" />}>
              <div className="space-y-2">
                <Link
                  to={`/services/${selectedNode.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Full Service Dashboard</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                </Link>
                <Link
                  to={`/rca?service=${selectedNode.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Root Cause Analysis</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                </Link>
                <Link
                  to={`/blast-radius?service=${selectedNode.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-red-500" />
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Blast Radius Analysis</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                </Link>
              </div>
            </DrilldownSection>

            {/* Scoped AI Assistant inside the Drawer */}
            <div className="mt-4 border-t border-border pt-4">
              <InlineCopilot
                pageType="service"
                selectedEntity={selectedNode.id}
                entityData={{
                  service_id: selectedNode.id,
                  name: selectedNode.label,
                  health: selectedNode.health,
                  metrics: {
                    cpu: selectedNode.metrics.cpu,
                    memory: selectedNode.metrics.memory,
                    latency: selectedNode.metrics.latency,
                    error_rate: selectedNode.metrics.error_rate,
                    risk_score: selectedNode.metrics.risk_score,
                    incident_count: selectedNode.metrics.incident_count,
                  },
                }}
                relatedMetrics={{
                  cpu: selectedNode.metrics.cpu,
                  memory: selectedNode.metrics.memory,
                  latency: selectedNode.metrics.latency,
                  error_rate: selectedNode.metrics.error_rate,
                }}
                relatedAlerts={overview.open_alerts_preview?.filter((a: any) => a.service === selectedNode.id) ?? []}
                relatedIncidents={overview.recent_incidents?.filter((i: any) => i.service === selectedNode.id) ?? []}
                title={`AI Assistant: ${selectedNode.label}`}
                subtitle={`Ask questions about ${selectedNode.label} only`}
                suggestedQuestions={[
                  `Why is ${selectedNode.label} in ${selectedNode.health} state?`,
                  `Analyze CPU and memory usage for ${selectedNode.label}`,
                  `What are the active alerts/incidents for ${selectedNode.label}?`,
                ]}
              />
            </div>
          </div>
        )}
      </DrilldownDrawer>
    </div>
  );
}
