import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDrawerState } from '../hooks/useDrawerState';
import { useRegisterCopilotContext, useCopilot } from '../ai/context/CopilotProvider';
import ReactFlow, { Background, Controls, MiniMap, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { 
  getMonitoringDashboard, 
  getOverview, 
  getDependencyGraph, 
  getDependencyPaths, 
  getIncident, 
  getIncidentClickAnalysis, 
  getIncidentChangeRequests 
} from '../api/client';
import type { MonitoringDashboard, ServiceMetric, GraphNode as APIGraphNode } from '../types/api';
import type { Overview, Incident } from '../types/intelligence';
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
import { AlertCircle, Sparkles, ChevronRight, ExternalLink, Activity, Zap, Network, TrendingUp, AlertCircle as AlertIcon } from 'lucide-react';
import InlineCopilot from '../components/copilot/InlineCopilot';

export default function ServiceOperationsCenter() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { openCopilot, registerPageContext } = useCopilot();
  const [monitoring, setMonitoring] = useState<MonitoringDashboard | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [graphNodes, setGraphNodes] = useState<Node[]>([]);
  const [graphEdges, setGraphEdges] = useState<Edge[]>([]);
  const [rawGraphNodes, setRawGraphNodes] = useState<APIGraphNode[]>([]);

  // Drawer route state
  const { drawerType, drawerId, metricType, openDrawer, closeDrawer } = useDrawerState();

  const [selectedNode, setSelectedNode] = useState<APIGraphNode | null>(null);
  const [selectedNodeDeps, setSelectedNodeDeps] = useState<{ upstream: any[]; downstream: any[] } | null>(null);

  // Incident details state
  const [selectedIncident, setSelectedIncident] = useState<any | null>(null);
  const [incidentAnalysis, setIncidentAnalysis] = useState<any | null>(null);
  const [incidentAnalysisLoading, setIncidentAnalysisLoading] = useState(false);
  const [incidentAnalysisError, setIncidentAnalysisError] = useState<string | null>(null);
  const [incidentChangeRequests, setIncidentChangeRequests] = useState<any | null>(null);

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
    openDrawer('service', serviceId);
  }, [openDrawer]);

  const handleIncidentClick = useCallback((incidentId: string) => {
    openDrawer('incident', incidentId);
  }, [openDrawer]);

  // Load service drilldown details when drawer parameters change
  useEffect(() => {
    if (drawerType === 'service' && drawerId) {
      let graphNode = rawGraphNodes.find((n) => n.id === drawerId);
      if (!graphNode && services.length > 0) {
        const matched = services.find((s) => s.id === drawerId);
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
        getDependencyPaths(drawerId)
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
    } else {
      setSelectedNode(null);
      setSelectedNodeDeps(null);
    }
  }, [drawerType, drawerId, rawGraphNodes, services]);

  // Load incident details when drawer parameters change
  useEffect(() => {
    if (drawerType === 'incident' && drawerId) {
      setSelectedIncident(null);
      setIncidentAnalysis(null);
      setIncidentAnalysisError(null);
      setIncidentAnalysisLoading(true);
      setIncidentChangeRequests(null);

      getIncident(drawerId)
        .then(setSelectedIncident)
        .catch(console.error);

      getIncidentClickAnalysis(drawerId)
        .then(setIncidentAnalysis)
        .catch((err) => setIncidentAnalysisError(err?.message ?? 'Analysis failed'))
        .finally(() => setIncidentAnalysisLoading(false));

      getIncidentChangeRequests(drawerId)
        .then((r) => setIncidentChangeRequests({ tickets: r.tickets }))
        .catch(() => setIncidentChangeRequests(null));
    } else {
      setSelectedIncident(null);
      setIncidentAnalysis(null);
      setIncidentAnalysisError(null);
      setIncidentChangeRequests(null);
    }
  }, [drawerType, drawerId]);

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
            onClick={() => openDrawer('metric', undefined, { metricType: 'services' })}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Active Incidents"
            value={exec!.active_incidents}
            variant={exec!.active_incidents > 0 ? 'critical' : 'success'}
            onClick={() => openDrawer('metric', undefined, { metricType: 'incidents' })}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Avg P99 Latency"
            value={`${avgLatency.toFixed(0)}ms`}
            variant="warning"
            onClick={() => openDrawer('metric', undefined, { metricType: 'latency' })}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Avg Error Rate"
            value={`${avgError.toFixed(2)}%`}
            variant={avgError > 1.5 ? 'critical' : 'default'}
            onClick={() => openDrawer('metric', undefined, { metricType: 'errors' })}
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
          {/* Active Incidents (clickable directly to right drawer) */}
          <Card>
            <CardHeader>
              <CardTitle>Active Incidents</CardTitle>
              <Link to="/incidents?active=true" className="text-xs text-primary hover:underline">All →</Link>
            </CardHeader>
            <div className="space-y-2">
              {overview.recent_incidents.slice(0, exec?.active_incidents || 2).map((inc) => (
                <div
                  key={inc.incident_id}
                  onClick={() => handleIncidentClick(inc.incident_id)}
                  className="block p-3 rounded-lg border border-border bg-background hover:bg-card-hover hover:shadow-sm transition-all duration-200 cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={inc.severity.startsWith('P1') || inc.severity === '1' ? 'critical' : 'warning'}>
                      {inc.severity}
                    </Badge>
                    <span className="text-[10px] text-text-secondary">{inc.service}</span>
                  </div>
                  <p className="text-xs text-text-primary line-clamp-2">{inc.title}</p>
                </div>
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

      {/* ─── Incident Timeline (clickable directly to right drawer) ─── */}
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
                      handleIncidentClick(matchingIncident.incident_id);
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
        isOpen={drawerType === 'service'}
        onClose={closeDrawer}
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
            <div className="grid grid-cols-2 gap-4">
              <DrilldownMetricCard
                label="Error Rate"
                value={selectedNode.metrics.error_rate.toFixed(2)}
                unit="%"
                status={selectedNode.metrics.error_rate > 1.5 ? 'critical' : selectedNode.metrics.error_rate > 0.5 ? 'warning' : 'good'}
              />
              <DrilldownMetricCard
                label="P99 Latency"
                value={selectedNode.metrics.latency.toFixed(0)}
                unit="ms"
                status={selectedNode.metrics.latency > 150 ? 'critical' : selectedNode.metrics.latency > 80 ? 'warning' : 'good'}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                <p className="text-[10px] text-text-secondary mb-1">CPU</p>
                <p className="text-lg font-bold text-text-primary">{selectedNode.metrics.cpu.toFixed(0)}%</p>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                <p className="text-[10px] text-text-secondary mb-1">Memory</p>
                <p className="text-lg font-bold text-text-primary">{selectedNode.metrics.memory.toFixed(0)}%</p>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                <p className="text-[10px] text-text-secondary mb-1">Risk Score</p>
                <p className="text-lg font-bold text-text-primary">{selectedNode.metrics.risk_score.toFixed(0)}%</p>
              </div>
            </div>

            <DrilldownSection title="Resource Health Graph">
              <div className="h-24">
                <MiniLineChart data={generateTrend(selectedNode.metrics.latency, 10)} height={80} color="#3B82F6" />
              </div>
            </DrilldownSection>

            {drawerRelatedResources.length > 0 && (
              <DrilldownSection title="Connected Services">
                <RelatedResourcesPanel resources={drawerRelatedResources} title="Connected Services" />
              </DrilldownSection>
            )}

            <div className="mt-6">
              <InlineCopilot
                pageType="service"
                selectedEntity={selectedNode.id}
                entityData={{
                  service_id: selectedNode.id,
                  label: selectedNode.label,
                  metrics: selectedNode.metrics,
                }}
                relatedAlerts={overview.open_alerts_preview.filter(a => a.entity_id === selectedNode.id)}
                relatedIncidents={overview.recent_incidents.filter(i => i.service === selectedNode.label)}
                relatedMetrics={{
                  cpu: selectedNode.metrics.cpu,
                  memory: selectedNode.metrics.memory,
                  latency: selectedNode.metrics.latency,
                  error_rate: selectedNode.metrics.error_rate,
                }}
                suggestedQuestions={[
                  `Why is microservice ${selectedNode.label} health state ${selectedNode.health}?`,
                  `Analyze CPU and error rate hotspots for ${selectedNode.label}`,
                  `Show downstream impact if ${selectedNode.label} fails`
                ]}
              />
            </div>
          </div>
        )}
      </DrilldownDrawer>

      {/* Metric Drilldown Drawer for Service Operations */}
      <DrilldownDrawer
        isOpen={drawerType === 'metric'}
        onClose={closeDrawer}
        title={
          metricType === 'services' ? 'Services Monitored' :
            metricType === 'latency' ? 'Average P99 Latency' :
              metricType === 'errors' ? 'Average Error Rate' :
                metricType === 'incidents' ? 'Active Incidents' : ''
        }
        subtitle={
          metricType === 'services' ? 'Microservice health and availability snapshot' :
            metricType === 'latency' ? 'Historical response time trends and rankings' :
              metricType === 'errors' ? 'Microservice exception/error rate trends and rankings' :
                metricType === 'incidents' ? 'Current operational incidents requiring mitigation' : ''
        }
        type={
          metricType === 'services' ? 'service' :
            metricType === 'incidents' ? 'incident' : 'api'
        }
        health={
          metricType === 'services' ? (services.some(s => s.health === 'critical') ? 'critical' : services.some(s => s.health === 'warning') ? 'warning' : 'healthy') :
            metricType === 'latency' ? (avgLatency > 150 ? 'critical' : avgLatency > 80 ? 'warning' : 'healthy') :
              metricType === 'errors' ? (avgError > 2.0 ? 'critical' : avgError > 0.5 ? 'warning' : 'healthy') :
                metricType === 'incidents' ? (exec!.active_incidents > 0 ? 'critical' : 'healthy') : undefined
        }
      >
        {metricType === 'services' && (
          <div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <DrilldownMetricCard
                label="Healthy"
                value={services.filter(s => s.health === 'healthy').length}
                status="good"
              />
              <DrilldownMetricCard
                label="Warning"
                value={services.filter(s => s.health === 'warning').length}
                status="warning"
              />
              <DrilldownMetricCard
                label="Critical"
                value={services.filter(s => s.health === 'critical').length}
                status="critical"
              />
            </div>

            <DrilldownSection title="Service Availability Breakdown">
              <div className="space-y-3">
                {services.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                    <span className="font-semibold text-text-primary text-xs">{s.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs">{s.availability.toFixed(2)}%</span>
                      <HealthBadge health={s.health} />
                    </div>
                  </div>
                ))}
              </div>
            </DrilldownSection>

            <div className="mt-6">
              <InlineCopilot
                pageType="service"
                selectedEntity="Services Monitored"
                entityData={{
                  services_status: services.map(s => ({ name: s.name, availability: s.availability, health: s.health }))
                }}
                suggestedQuestions={[
                  "Identify the least stable service in terms of availability",
                  "Are there warning/critical alerts on any of these services?",
                  "Which services have been degraded for more than 15 minutes?"
                ]}
              />
            </div>
          </div>
        )}

        {metricType === 'latency' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <DrilldownMetricCard
                label="Avg Latency"
                value={avgLatency.toFixed(1)}
                unit="ms"
                status={avgLatency > 150 ? 'critical' : avgLatency > 80 ? 'warning' : 'good'}
              />
              <DrilldownMetricCard
                label="Slowest Endpoint"
                value="merchant-service"
              />
            </div>

            <DrilldownSection title="P99 Response Times">
              <div className="space-y-3">
                {[...services]
                  .sort((a, b) => b.latency_p99_ms - a.latency_p99_ms)
                  .map(s => (
                    <div key={s.id} className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold text-text-primary">
                        <span>{s.name}</span>
                        <span>{s.latency_p99_ms.toFixed(0)}ms</span>
                      </div>
                      <div className="w-full bg-border h-2 rounded-full overflow-hidden">
                        <div
                           className={`h-full rounded-full ${s.latency_p99_ms > 150 ? 'bg-critical' : s.latency_p99_ms > 85 ? 'bg-warning' : 'bg-success'
                            }`}
                          style={{ width: `${Math.min(100, s.latency_p99_ms / 3)}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </DrilldownSection>

            <div className="mt-6">
              <InlineCopilot
                pageType="service"
                selectedEntity="Avg P99 Latency"
                entityData={{
                  average_latency: avgLatency,
                  latency_trend: latencyTrend,
                  standings: services.map(s => ({ name: s.name, latency: s.latency_p99_ms, health: s.health }))
                }}
                suggestedQuestions={[
                  "Why is merchant-service experiencing p99 latency spikes?",
                  "Is the database query lag causing downstream API latency?",
                  "Recommend threshold configurations for latency alerts"
                ]}
              />
            </div>
          </div>
        )}

        {metricType === 'errors' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <DrilldownMetricCard
                label="Avg Error Rate"
                value={avgError.toFixed(2)}
                unit="%"
                status={avgError > 2.0 ? 'critical' : avgError > 0.5 ? 'warning' : 'good'}
              />
              <DrilldownMetricCard
                label="Highest Error Rate"
                value="auth-service"
              />
            </div>

            <DrilldownSection title="HTTP Exception/Error Rates">
              <div className="space-y-3">
                {[...services]
                  .sort((a, b) => b.error_rate - a.error_rate)
                  .map(s => (
                    <div key={s.id} className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold text-text-primary">
                        <span>{s.name}</span>
                        <span>{s.error_rate.toFixed(2)}%</span>
                      </div>
                      <div className="w-full bg-border h-2 rounded-full overflow-hidden">
                        <div
                           className={`h-full rounded-full ${s.error_rate > 2.0 ? 'bg-critical' : s.error_rate > 0.5 ? 'bg-warning' : 'bg-success'
                            }`}
                          style={{ width: `${Math.min(100, s.error_rate * 25)}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </DrilldownSection>

            <div className="mt-6">
              <InlineCopilot
                pageType="service"
                selectedEntity="Avg Error Rate"
                entityData={{
                  average_error_rate: avgError,
                  error_trend: errorTrend,
                  standings: services.map(s => ({ name: s.name, error_rate: s.error_rate, health: s.health }))
                }}
                suggestedQuestions={[
                  "Why is average error rate high?",
                  "Which microservice is throwing the most errors and why?",
                  "Is the API Gateway error spike related to a backend database failure?"
                ]}
              />
            </div>
          </div>
        )}

        {metricType === 'incidents' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <DrilldownMetricCard
                label="Active Incidents"
                value={exec!.active_incidents}
                status={exec!.active_incidents > 0 ? 'critical' : 'good'}
              />
              <DrilldownMetricCard
                label="Total Open Alerts"
                value={overview.summary.open_alerts}
                status={overview.summary.open_alerts > 0 ? 'warning' : 'good'}
              />
            </div>

            <DrilldownSection title="Active Incidents List" icon={<AlertIcon className="w-4 h-4 text-critical" />}>
              {overview.recent_incidents.slice(0, exec!.active_incidents).length === 0 ? (
                <p className="text-xs text-text-secondary">No active incidents found.</p>
              ) : (
                <div className="space-y-3">
                  {overview.recent_incidents.slice(0, exec!.active_incidents).map(inc => (
                    <div 
                      key={inc.incident_id} 
                      onClick={() => handleIncidentClick(inc.incident_id)}
                      className="p-3 rounded-lg border border-border bg-background hover:bg-card-hover hover:shadow-sm transition-all duration-200 cursor-pointer text-left"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border border-critical/30 bg-critical/10 text-critical`}>
                          {inc.severity}
                        </span>
                        <span className="text-[10px] text-text-secondary">{inc.service}</span>
                      </div>
                      <p className="text-xs font-semibold text-text-primary mb-1">{inc.title}</p>
                      <p className="text-[10px] text-text-secondary mb-3"><span className="font-medium">Root Cause:</span> {inc.root_cause}</p>
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <DrilldownButton onClick={() => { closeDrawer(); navigate(`/rca?id=${inc.incident_id}`); }} variant="primary">
                          View RCA
                        </DrilldownButton>
                        <DrilldownButton onClick={() => { closeDrawer(); navigate(`/blast-radius?id=${inc.incident_id}`); }} variant="secondary">
                          Blast Radius
                        </DrilldownButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DrilldownSection>

            <div className="mt-6">
              <InlineCopilot
                pageType="service"
                selectedEntity="Active Incidents"
                entityData={{
                  active_incidents_count: exec!.active_incidents,
                  incidents: overview.recent_incidents.slice(0, exec!.active_incidents),
                }}
                relatedIncidents={overview.recent_incidents.slice(0, exec!.active_incidents)}
                suggestedQuestions={[
                  "Can you explain the root cause of these active incidents?",
                  "What is the estimated time to resolution?",
                  "Are there correlated alerts for these incidents?"
                ]}
              />
            </div>
          </div>
        )}
      </DrilldownDrawer>

      {/* ─── Incident Detail Drawer ─── */}
      <DrilldownDrawer
        isOpen={drawerType === 'incident'}
        onClose={closeDrawer}
        title={selectedIncident ? selectedIncident.title : 'Incident details'}
        subtitle={drawerId || ''}
        type="incident"
        health={selectedIncident?.severity.startsWith('P1') || selectedIncident?.severity === '1' ? 'critical' : 'warning'}
      >
        {selectedIncident && (
          <div className="space-y-5">
            {/* Basic incident info */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <p><span className="text-slate-500 dark:text-slate-400 font-medium">Service: </span><span className="text-slate-900 dark:text-white font-semibold">{selectedIncident.service}</span></p>
              <p><span className="text-slate-500 dark:text-slate-400 font-medium">Team: </span><span className="text-slate-900 dark:text-white font-semibold">{selectedIncident.owner_team}</span></p>
              <p><span className="text-slate-500 dark:text-slate-400 font-medium">Environment: </span><span className="text-slate-900 dark:text-white font-semibold">{selectedIncident.environment} / {selectedIncident.region}</span></p>
              <p><span className="text-slate-500 dark:text-slate-400 font-medium">Duration: </span><span className="text-slate-900 dark:text-white font-semibold">{selectedIncident.duration_minutes ?? '?'} min</span></p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Alerts</p>
                <div className="flex flex-wrap gap-1">
                  {selectedIncident.alerts.map((item: string) => (
                    <span key={item} className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                      {item}
                    </span>
                  ))}
                  {selectedIncident.alerts.length === 0 && <span className="text-xs text-slate-400 italic">none</span>}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Symptoms</p>
                <div className="flex flex-wrap gap-1">
                  {selectedIncident.symptoms.map((item: string) => (
                    <span key={item} className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-yellow-50 text-yellow-700 border-yellow-250 dark:bg-yellow-950/40 dark:text-yellow-400 dark:border-yellow-800">
                      {item}
                    </span>
                  ))}
                  {selectedIncident.symptoms.length === 0 && <span className="text-xs text-slate-400 italic">none</span>}
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Impacted Components</p>
              <div className="flex flex-wrap gap-1">
                {selectedIncident.impacted_components.map((item: string) => (
                  <span key={item} className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-350 dark:border-slate-700">
                    {item}
                  </span>
                ))}
                {selectedIncident.impacted_components.length === 0 && <span className="text-xs text-slate-400 italic">none</span>}
              </div>
            </div>

            {selectedIncident.similar_incidents && selectedIncident.similar_incidents.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-300">Similar incidents: </span>
                {selectedIncident.similar_incidents.join(', ')}
              </p>
            )}

            {/* Analysis Section */}
            {incidentAnalysisLoading ? (
              <div className="flex items-center gap-2 py-4 justify-center text-xs text-slate-500 dark:text-slate-400">
                <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Running analysis…
              </div>
            ) : incidentAnalysisError ? (
              <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
                {incidentAnalysisError}
              </div>
            ) : incidentAnalysis ? (
              <div className="space-y-4 text-xs">
                {/* Candidates / root causes */}
                {incidentAnalysis.type === 'incident_rca' && incidentAnalysis.root_cause_candidates && (
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase mb-2">Root Cause Candidates</p>
                    <div className="space-y-2">
                      {incidentAnalysis.root_cause_candidates.map((c: any, i: number) => (
                        <div key={i} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-slate-800 dark:text-white">{c.root_cause}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-955/40 dark:text-red-400`}>{c.confidence}% confidence</span>
                          </div>
                          {c.suggested_fixes?.[0] && (
                            <p className="text-emerald-700 dark:text-emerald-400">→ {c.suggested_fixes[0]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* suggested fix */}
                {incidentAnalysis.suggested_fix && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg">
                    <p className="text-slate-500 dark:text-slate-400 mb-0.5 font-medium">Suggested Fix</p>
                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">{incidentAnalysis.suggested_fix}</p>
                  </div>
                )}

                {/* reasoning */}
                {incidentAnalysis.reasoning && (
                  <div className="p-3 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg">
                    <p className="text-slate-500 dark:text-slate-400 mb-1 font-medium">Reasoning</p>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{incidentAnalysis.reasoning}</p>
                  </div>
                )}

                {/* AI Deep Analysis */}
                {incidentAnalysis.llm_analysis && (
                  <div className="p-4 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/20 dark:to-blue-950/20 border border-indigo-200 dark:border-indigo-800 rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-semibold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">AI Deep Analysis</span>
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed space-y-1">
                      {incidentAnalysis.llm_analysis.split('\n').map((line: string, idx: number) => {
                        if (line.trim() === '') return <div key={idx} className="h-1" />;
                        return <p key={idx}>{line}</p>;
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Change Requests Section */}
            {incidentChangeRequests && incidentChangeRequests.tickets && incidentChangeRequests.tickets.length > 0 && (
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase mb-2">Change Request History</p>
                {incidentChangeRequests.tickets.map((ticket: any, ti: number) => (
                  <div key={ti} className="p-3 rounded-lg border border-border bg-background">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded">
                        {ticket.jira_key || 'Change Ticket'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">{ticket.service}</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">{ticket.summary}</p>
                    <p className="text-[10px] text-slate-500 mt-1">Status: <span className="font-semibold">{ticket.incident_state}</span></p>
                  </div>
                ))}
              </div>
            )}

            {/* Inline AI Copilot inside the incident drawer */}
            <div className="mt-6 border-t border-border pt-6">
              <InlineCopilot
                pageType="incident"
                selectedEntity={selectedIncident.incident_id}
                entityData={{
                  incident_id: selectedIncident.incident_id,
                  title: selectedIncident.title,
                  severity: selectedIncident.severity,
                  service: selectedIncident.service,
                  root_cause: selectedIncident.root_cause,
                  fix: selectedIncident.fix,
                  alerts: selectedIncident.alerts,
                  symptoms: selectedIncident.symptoms,
                  duration_minutes: selectedIncident.duration_minutes,
                  impacted_components: selectedIncident.impacted_components,
                }}
                relatedAlerts={selectedIncident.alerts}
                relatedIncidents={[selectedIncident]}
                suggestedQuestions={[
                  "Can you explain the root cause of this incident?",
                  "What is the recommended fix and verification plan?",
                  "Are there similar past incidents on this service?"
                ]}
              />
            </div>
          </div>
        )}
      </DrilldownDrawer>
    </div>
  );
}
