import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import ReactFlow, { Background, Controls, MiniMap, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { getMonitoringDashboard, getOverview, getDependencyGraph, getDependencyPaths, getTimeseries } from '../api/client';
import type { MonitoringDashboard, GraphNode as APIGraphNode, GraphEdge as APIGraphEdge } from '../types/api';
import type { Overview, EarlyDetection } from '../types/intelligence';
import { PageHeader, Grid12, CollapsibleSection } from '../components/ui/layout-primitives';
import { MetricCard } from '../components/ui/metric-card';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { DataTable, HealthBadge } from '../components/ui/data-table';
import { TrendChart } from '../components/charts/charts';
import { useTheme } from '../context/ThemeContext';
import { getHealthNodeStyle } from '../utils/graphTheme';
import DrilldownDrawer, { DrilldownSection, DrilldownMetricCard, DrilldownButton } from '../components/drilldown/DrilldownDrawer';
import RelatedResourcesPanel from '../components/drilldown/RelatedResourcesPanel';
import { AlertCircle, Sparkles, ChevronRight, Activity, Network } from 'lucide-react';
import { type DrawerAIAssistantProps } from '../components/drilldown/DrawerAIAssistant';
import { useOpsDashboard } from '../hooks/useOpsDashboard';
import OpsSubNav from '../components/ops/OpsSubNav';
import OpsSectionContent from '../components/ops/OpsSectionContent';
import OpsEntityDrawer from '../components/ops/OpsEntityDrawer';
import type { OpsEntity } from '../types/ops';
import DatasetUploadBanner from '../components/DatasetUploadBanner';
import { EMPTY_OVERVIEW, NO_DATA_MESSAGE } from '../utils/emptyState';
import { cn } from '../lib/cn';

type IncidentPreview = Overview['recent_incidents'][number];

type OpsDrawer =
  | { kind: 'service'; node: APIGraphNode; deps: { upstream: any[]; downstream: any[] } | null }
  | { kind: 'services-list' }
  | { kind: 'incidents-list' }
  | { kind: 'incident'; incident: IncidentPreview }
  | { kind: 'latency' }
  | { kind: 'error' }
  | { kind: 'early-detection'; detection: EarlyDetection | null };

export default function ServiceOperationsCenter() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [monitoring, setMonitoring] = useState<MonitoringDashboard | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [graphNodes, setGraphNodes] = useState<Node[]>([]);
  const [graphEdges, setGraphEdges] = useState<Edge[]>([]);
  const [rawGraphNodes, setRawGraphNodes] = useState<APIGraphNode[]>([]);
  const [rawGraphEdges, setRawGraphEdges] = useState<APIGraphEdge[]>([]);

  const [drawer, setDrawer] = useState<OpsDrawer | null>(null);
  const [opsEntity, setOpsEntity] = useState<OpsEntity | null>(null);
  const [visibleIncidentsCount, setVisibleIncidentsCount] = useState(20);

  useEffect(() => {
    if (drawer?.kind === 'incidents-list') {
      setVisibleIncidentsCount(20);
    }
  }, [drawer?.kind]);

  const {
    entities: opsEntities,
    navItems: serviceNav,
    activeSection,
    setActiveSection,
    currentSection,
  } = useOpsDashboard('service-ops');

  useEffect(() => {
    setPageLoading(true);
    Promise.all([
      getMonitoringDashboard(),
      getOverview(),
      getDependencyGraph(['microservice'], 'latency'),
    ])
      .then(([m, o, g]) => {
        setMonitoring(m);
        setOverview(o);
        setRawGraphNodes(g.nodes);
        setRawGraphEdges(g.edges);
      })
      .catch(console.error)
      .finally(() => setPageLoading(false));
  }, []);

  useEffect(() => {
    if (!rawGraphNodes.length) return;

    const nodes: Node[] = rawGraphNodes.slice(0, 12).map((n, i) => {
      const angle = (i / Math.min(rawGraphNodes.length, 12)) * 2 * Math.PI;
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
    const edges: Edge[] = rawGraphEdges
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
  }, [theme, rawGraphNodes, rawGraphEdges]);

  const services = monitoring?.service.services ?? [];
  const exec = monitoring?.executive;
  const overviewData = overview ?? EMPTY_OVERVIEW;

  const [latencyTrend, setLatencyTrend] = useState<{ name: string; value: number }[]>([]);
  const [errorTrend, setErrorTrend] = useState<{ name: string; value: number }[]>([]);

  useEffect(() => {
    if (monitoring?.dataset_available === false) {
      setLatencyTrend([]);
      setErrorTrend([]);
      return;
    }
    getTimeseries('latency_p99').then((res) =>
      setLatencyTrend((res.points ?? []).map((p) => ({ name: String(p.t), value: p.v }))),
    ).catch(() => setLatencyTrend([]));
    getTimeseries('error_rate').then((res) =>
      setErrorTrend((res.points ?? []).map((p) => ({ name: String(p.t), value: p.v }))),
    ).catch(() => setErrorTrend([]));
  }, [monitoring?.dataset_available]);

  const topRisks = useMemo(() => services.filter((s) => s.health !== 'healthy').slice(0, 4), [services]);
  const avgLatency = latencyTrend.at(-1)?.value ?? 0;
  const avgError = errorTrend.at(-1)?.value ?? 0;


  const closeDrawer = () => setDrawer(null);
  const closeOpsEntity = () => setOpsEntity(null);

  const openIncident = (incident: IncidentPreview) => {
    setDrawer({ kind: 'incident', incident });
  };

  const selectedNode = drawer?.kind === 'service' ? drawer.node : null;
  const selectedNodeDeps = drawer?.kind === 'service' ? drawer.deps : null;

  const normalizeDrawerHealth = (h?: string): 'healthy' | 'warning' | 'critical' | undefined => {
    const v = (h || '').toLowerCase();
    if (v === 'healthy' || v === 'ok' || v === 'up') return 'healthy';
    if (v === 'warning' || v === 'degraded' || v === 'warn') return 'warning';
    if (v === 'critical' || v === 'down' || v === 'error') return 'critical';
    return undefined;
  };

  const handleServiceClick = useCallback((serviceId: string, label: string) => {
    const opsEnt =
      opsEntities.find((e) => e.id === serviceId) ||
      opsEntities.find((e) => e.name === serviceId) ||
      opsEntities.find((e) => e.name === label) ||
      opsEntities.find((e) => e.id === label);

    if (opsEnt) {
      setDrawer(null);
      setOpsEntity(opsEnt);
      return;
    }

    const matched = services.find((s) => s.id === serviceId || s.name === label);
    const graphNode = rawGraphNodes.find((n) => n.id === serviceId);
    const gm = graphNode?.metrics as Record<string, number> | undefined;

    const node: APIGraphNode = {
      id: serviceId,
      label: label || matched?.name || graphNode?.label || serviceId,
      type: graphNode?.type || 'microservice',
      layer: graphNode?.layer || 'microservice',
      health: normalizeDrawerHealth(matched?.health || graphNode?.health) ?? 'healthy',
      metrics: {
        cpu: gm?.cpu ?? 40,
        memory: gm?.memory ?? 55,
        storage: gm?.storage ?? 0,
        io: gm?.io ?? 0,
        network: gm?.network ?? 0,
        latency: matched?.latency_p99_ms ?? gm?.latency ?? gm?.mean_response_time ?? 0,
        error_rate: matched?.error_rate ?? gm?.error_rate ?? 0,
        risk_score: gm?.risk_score ?? (matched?.health === 'critical' ? 85 : matched?.health === 'warning' ? 55 : 20),
        incident_count: gm?.incident_count ?? 0,
      },
      heatmap_value: graphNode?.heatmap_value ?? matched?.latency_p99_ms ?? 0,
      platform: graphNode?.platform,
      region: graphNode?.region,
    };

    setOpsEntity(null);
    setDrawer({ kind: 'service', node, deps: null });
    getDependencyPaths(serviceId)
      .then((paths) => {
        setDrawer((current) =>
          current?.kind === 'service' && current.node.id === serviceId
            ? {
                ...current,
                deps: {
                  upstream: paths.upstream || [],
                  downstream: paths.downstream || [],
                },
              }
            : current
        );
      })
      .catch(() => {
        setDrawer((current) =>
          current?.kind === 'service' && current.node.id === serviceId
            ? { ...current, deps: { upstream: [], downstream: [] } }
            : current
        );
      });
  }, [rawGraphNodes, services, opsEntities]);

  // Handle dependency graph node click → open drilldown drawer
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      handleServiceClick(node.id, node.data?.label || node.id);
    },
    [handleServiceClick]
  );

  const copilotContext = useMemo(() => {
    if (!monitoring) return null;
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
      relatedAlerts: overviewData.open_alerts_preview ?? [],
      relatedIncidents: overviewData.recent_incidents ?? [],
      relatedMetrics: {
        avg_latency: avgLatency,
        avg_error_rate: avgError,
        active_incidents: exec?.active_incidents,
      },
    };
  }, [monitoring, overviewData, services, topRisks, avgLatency, avgError, exec]);


  const drawerRelatedResources = useMemo(() => {
    if (drawer?.kind !== 'service' || !drawer.deps) return [];
    return [
      ...drawer.deps.upstream.map((dep: any) => ({
        id: dep.node,
        name: dep.node.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        type: 'service' as const,
        relationship: 'upstream' as const,
        health: 'healthy' as const,
        metrics: [{ label: 'Relationship', value: dep.relationship || 'depends_on' }],
      })),
      ...drawer.deps.downstream.map((dep: any) => ({
        id: dep.node,
        name: dep.node.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        type: 'service' as const,
        relationship: 'downstream' as const,
        health: 'healthy' as const,
        metrics: [{ label: 'Relationship', value: dep.relationship || 'provides_to' }],
      })),
    ];
  }, [drawer]);

  const drawerMeta = useMemo(() => {
    if (!drawer) return null;
    switch (drawer.kind) {
      case 'service':
        return {
          title: drawer.node.label,
          subtitle: drawer.node.id,
          type: 'service' as const,
          health: normalizeDrawerHealth(drawer.node.health),
          onBack: undefined,
        };
      case 'services-list':
        return { title: 'Service Health Overview', subtitle: `${services.length} services monitored`, type: 'service' as const, onBack: undefined };
      case 'incidents-list':
        return { title: 'Active Incidents', subtitle: `${exec!.active_incidents} active`, type: 'incident' as const, onBack: undefined };
      case 'incident':
        return { title: drawer.incident.title, subtitle: drawer.incident.service, type: 'incident' as const, health: undefined, onBack: () => setDrawer({ kind: 'incidents-list' }) };
      case 'latency':
        return { title: 'Latency Trends', subtitle: `Avg P99 ${avgLatency.toFixed(0)}ms`, type: 'service' as const, onBack: undefined };
      case 'error':
        return { title: 'Error Rate Trends', subtitle: `Avg ${avgError.toFixed(2)}%`, type: 'service' as const, onBack: undefined };
      case 'early-detection':
        return {
          title: drawer.detection ? 'AI Prediction Detail' : 'AI Recommendations',
          subtitle: drawer.detection?.expected_impacted_service ?? 'Early detection patterns',
          type: 'incident' as const,
          onBack: drawer.detection ? () => setDrawer({ kind: 'early-detection', detection: null }) : undefined,
        };
    }
  }, [drawer, overviewData, services, exec, avgLatency, avgError]);

  const drawerAI = useMemo((): DrawerAIAssistantProps | null => {
    if (!drawer) return null;
    switch (drawer.kind) {
      case 'service':
        return {
          pageType: 'service',
          selectedEntity: drawer.node.label,
          entityData: {
            service_id: drawer.node.id,
            name: drawer.node.label,
            health: drawer.node.health,
            metrics: drawer.node.metrics,
          },
          relatedMetrics: {
            cpu: drawer.node.metrics?.cpu ?? 0,
            memory: drawer.node.metrics?.memory ?? 0,
            latency: drawer.node.metrics?.latency ?? 0,
            error_rate: drawer.node.metrics?.error_rate ?? 0,
          },
          relatedAlerts: overviewData.open_alerts_preview?.filter((a: any) => a.entity_id === drawer.node.id || a.service === drawer.node.id) ?? [],
          relatedIncidents: overviewData.recent_incidents?.filter((i: any) => i.service === drawer.node.id) ?? [],
          suggestedQuestions: [
            `Why is ${drawer.node.label} in ${drawer.node.health} state?`,
            `Analyze CPU and memory usage for ${drawer.node.label}`,
            `What are the active alerts/incidents for ${drawer.node.label}?`,
          ],
        };
      case 'services-list':
        return {
          pageType: 'service',
          selectedEntity: 'Service Health Overview',
          entityData: {
            services: services.map((s) => ({ id: s.id, name: s.name, health: s.health, latency: s.latency_p99_ms, error_rate: s.error_rate })),
            total: services.length,
          },
          relatedMetrics: { avg_latency: avgLatency, avg_error_rate: avgError },
          suggestedQuestions: [
            'Which services are in critical or warning state?',
            'Summarize overall service health across the fleet',
            'Which services need immediate attention?',
          ],
        };
      case 'incidents-list':
        return {
          pageType: 'incident',
          selectedEntity: 'Active Incidents',
          entityData: { incidents: overviewData.recent_incidents, active_count: exec?.active_incidents },
          relatedIncidents: overviewData.recent_incidents,
          suggestedQuestions: [
            'Summarize all active incidents and their severity',
            'Which services are most impacted by current incidents?',
            'What should we prioritize first?',
          ],
        };
      case 'incident':
        return {
          pageType: 'incident',
          selectedEntity: drawer.incident.title,
          entityData: { ...drawer.incident },
          relatedIncidents: [drawer.incident],
          suggestedQuestions: [
            `What is the root cause of incident ${drawer.incident.incident_id}?`,
            `How does this incident affect ${drawer.incident.service}?`,
            'What remediation steps do you recommend?',
          ],
        };
      case 'latency':
        return {
          pageType: 'service',
          selectedEntity: 'Latency Trends',
          entityData: { avg_p99_latency_ms: avgLatency, services: services.map((s) => ({ name: s.name, latency: s.latency_p99_ms })) },
          relatedMetrics: { avg_latency: avgLatency },
          suggestedQuestions: [
            'Which services have the highest P99 latency?',
            'Is current average latency within SLA targets?',
            'What could be causing latency spikes?',
          ],
        };
      case 'error':
        return {
          pageType: 'service',
          selectedEntity: 'Error Rate Trends',
          entityData: { avg_error_rate: avgError, services: services.map((s) => ({ name: s.name, error_rate: s.error_rate })) },
          relatedMetrics: { avg_error_rate: avgError },
          suggestedQuestions: [
            'Which services have the highest error rates?',
            'Are error rates trending up or down?',
            'What actions reduce error rate across services?',
          ],
        };
      case 'early-detection':
        if (drawer.detection) {
          return {
            pageType: 'service',
            selectedEntity: drawer.detection.expected_impacted_service,
            entityData: { ...drawer.detection },
            relatedMetrics: { confidence: drawer.detection.confidence, eta_minutes: drawer.detection.estimated_time_to_incident_minutes },
            suggestedQuestions: [
              `Why is ${drawer.detection.expected_impacted_service} at risk?`,
              `Explain the ${drawer.detection.confidence}% confidence prediction`,
              'What preventive actions should we take now?',
            ],
          };
        }
        return {
          pageType: 'service',
          selectedEntity: 'AI Recommendations',
          entityData: { predictions: overviewData.early_detections },
          suggestedQuestions: [
            'Summarize all early detection patterns',
            'Which predicted incidents are most urgent?',
            'What proactive steps should the team take?',
          ],
        };
      default:
        return null;
    }
  }, [drawer, services, overviewData, exec, avgLatency, avgError]);

  useRegisterCopilotContext(copilotContext);

  if (pageLoading || !monitoring) {
    return <p className="text-text-secondary text-sm">Loading service operations center...</p>;
  }

  const noData = monitoring.dataset_available === false;

  return (
    <div>
      <PageHeader
        title="Service Operations"
        description="Business services, applications, APIs, and user-facing systems — regardless of where they run."
      />

      {noData && <DatasetUploadBanner />}

      <div className="flex gap-6 items-start">
        <OpsSubNav items={serviceNav} activeId={activeSection} onChange={setActiveSection} perspective="service" />

        <div className="flex-1 min-w-0 rounded-2xl border border-border bg-card/30 p-4 sm:p-5 shadow-sm">
      {activeSection !== 'overview' && currentSection && (
        <OpsSectionContent
          dashboardId="service-ops"
          section={currentSection}
          entities={opsEntities}
          perspective="service"
          onEntityClick={setOpsEntity}
          noData={noData}
        />
      )}

      {activeSection === 'overview' && (
      <>
      <Grid12 className="mb-4">
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Services Monitored"
            value={noData ? 'N/A' : services.length}
            sub={noData ? '—' : `${services.filter((s) => s.health === 'healthy').length} healthy`}
            onClick={noData ? undefined : () => setDrawer({ kind: 'services-list' })}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Active Incidents"
            value={noData ? 'N/A' : exec!.active_incidents}
            variant={noData ? 'default' : exec!.active_incidents > 0 ? 'critical' : 'success'}
            onClick={noData ? undefined : () => setDrawer({ kind: 'incidents-list' })}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Avg P99 Latency"
            value={noData ? 'N/A' : `${avgLatency.toFixed(0)}ms`}
            variant={noData ? 'default' : 'warning'}
            onClick={noData ? undefined : () => setDrawer({ kind: 'latency' })}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Avg Error Rate"
            value={noData ? 'N/A' : `${avgError.toFixed(2)}%`}
            variant={noData ? 'default' : avgError > 1.5 ? 'critical' : 'default'}
            onClick={noData ? undefined : () => setDrawer({ kind: 'error' })}
          />
        </div>
      </Grid12>

      <Grid12>
        <div className="col-span-12 xl:col-span-8 space-y-4">
          {/* ─── Service Health Table (full row clickable) ─── */}
          <div id="service-health-section">
            <CollapsibleSection title="Service Health Overview" defaultOpen>
              <Card padding={false}>
                {noData ? (
                  <p className="text-sm text-text-secondary py-8 text-center">{NO_DATA_MESSAGE}</p>
                ) : (
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
                )}
              </Card>
            </CollapsibleSection>
          </div>

          {/* ─── Service Dependency Graph (clickable nodes) ─── */}
          <CollapsibleSection title="Service Dependency Graph" defaultOpen>
            <Card padding={false} className="overflow-hidden">
              {noData ? (
                <p className="text-sm text-text-secondary py-16 text-center">{NO_DATA_MESSAGE}</p>
              ) : (
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
                  <div className="absolute bottom-3 left-3 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-1.5 text-[10px] text-text-secondary flex items-center gap-1.5 pointer-events-none">
                    <Network className="h-3 w-3" />
                    Click any node to investigate
                  </div>
                </div>
              )}
            </Card>
          </CollapsibleSection>

          {/* ─── Latency & Error Trend Charts ─── */}
          <Grid12>
            <div className="col-span-12 md:col-span-6" id="latency-trends-section">
              <Card
                className={cn(!noData && 'cursor-pointer hover:shadow-lg transition-shadow')}
                onClick={noData ? undefined : () => setDrawer({ kind: 'latency' })}
              >
                <CardHeader><CardTitle>Latency Trends</CardTitle></CardHeader>
                {noData ? (
                  <p className="text-sm text-text-secondary py-8 text-center">{NO_DATA_MESSAGE}</p>
                ) : (
                  <TrendChart data={latencyTrend} height={120} color="#F59E0B" />
                )}
              </Card>
            </div>
            <div className="col-span-12 md:col-span-6" id="error-trends-section">
              <Card
                className={cn(!noData && 'cursor-pointer hover:shadow-lg transition-shadow')}
                onClick={noData ? undefined : () => setDrawer({ kind: 'error' })}
              >
                <CardHeader><CardTitle>Error Rate Trends</CardTitle></CardHeader>
                {noData ? (
                  <p className="text-sm text-text-secondary py-8 text-center">{NO_DATA_MESSAGE}</p>
                ) : (
                  <TrendChart data={errorTrend} height={120} color="#EF4444" />
                )}
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
              {!noData && (
                <button type="button" onClick={() => setDrawer({ kind: 'incidents-list' })} className="text-xs text-primary hover:underline">All →</button>
              )}
            </CardHeader>
            {noData ? (
              <p className="text-sm text-text-secondary py-4 text-center">{NO_DATA_MESSAGE}</p>
            ) : (
              <div className="space-y-2">
                {overviewData.recent_incidents.slice(0, 5).map((inc) => (
                  <button
                    key={inc.incident_id}
                    type="button"
                    onClick={() => openIncident(inc)}
                    className="w-full text-left block p-3 rounded-lg border border-border bg-background hover:bg-card-hover hover:shadow-sm transition-all duration-200"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={inc.severity.startsWith('P1') || inc.severity === '1' ? 'critical' : 'warning'}>
                        {inc.severity}
                      </Badge>
                      <span className="text-[10px] text-text-secondary">{inc.service}</span>
                    </div>
                    <p className="text-xs text-text-primary line-clamp-2">{inc.title}</p>
                  </button>
                ))}
                {overviewData.recent_incidents.length === 0 && (
                  <p className="text-xs text-text-secondary">No active incidents</p>
                )}
              </div>
            )}
          </Card>

          {/* ─── Top Risks (now clickable) ─── */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-warning" />
                <CardTitle>Top Risks</CardTitle>
              </div>
            </CardHeader>
            {noData ? (
              <p className="text-sm text-text-secondary py-4 text-center">{NO_DATA_MESSAGE}</p>
            ) : (
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
                {topRisks.length === 0 && (
                  <p className="text-xs text-text-secondary">No services at risk</p>
                )}
              </div>
            )}
          </Card>

          {/* ─── AI Recommendations (now clickable) ─── */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle>AI Recommendations</CardTitle>
              </div>
              {!noData && (
                <button type="button" onClick={() => setDrawer({ kind: 'early-detection', detection: null })} className="text-xs text-primary hover:underline">View all →</button>
              )}
            </CardHeader>
            {noData ? (
              <p className="text-sm text-text-secondary py-4 text-center">{NO_DATA_MESSAGE}</p>
            ) : (
              <div className="space-y-2">
                {overviewData.early_detections.slice(0, 3).map((d, i) => (
                  <button
                    key={`${d.pattern_id}-${i}`}
                    type="button"
                    onClick={() => setDrawer({ kind: 'early-detection', detection: d })}
                    className="w-full text-left block p-3 rounded-lg border border-border bg-background hover:bg-card-hover hover:border-primary/30 hover:shadow-sm transition-all duration-200 group"
                  >
                    <p className="text-xs text-text-primary group-hover:text-primary transition-colors">{d.recommended_actions[0] ?? 'Investigate anomaly pattern'}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[10px] text-text-secondary">
                        {d.expected_impacted_service} · {d.confidence}% confidence
                      </p>
                    </div>
                  </button>
                ))}
                {overviewData.early_detections.length === 0 && (
                  <p className="text-xs text-text-secondary">No active recommendations</p>
                )}
              </div>
            )}
          </Card>

          {/* ─── Predicted Incidents (now clickable) ─── */}
          <Card>
            <CardHeader>
              <CardTitle>Predicted Incidents</CardTitle>
              {!noData && (
                <button type="button" onClick={() => setDrawer({ kind: 'early-detection', detection: null })} className="text-xs text-primary hover:underline">Analyze →</button>
              )}
            </CardHeader>
            {noData ? (
              <p className="text-sm text-text-secondary py-4 text-center">{NO_DATA_MESSAGE}</p>
            ) : overviewData.early_detections.length === 0 ? (
              <p className="text-xs text-text-secondary">No predicted incidents in next 4 hours</p>
            ) : (
              overviewData.early_detections.map((d, i) => (
                <button
                  key={`${d.pattern_id}-${i}`}
                  type="button"
                  onClick={() => setDrawer({ kind: 'early-detection', detection: d })}
                  className="w-full text-left block mb-3 last:mb-0 p-3 -mx-1 rounded-lg hover:bg-card-hover transition-all duration-200 group"
                >
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-primary font-medium group-hover:text-primary transition-colors">{d.expected_impacted_service}</span>
                    <span className="text-critical font-mono font-semibold">{d.estimated_time_to_incident_minutes}m</span>
                  </div>
                </button>
              ))
            )}
          </Card>
        </div>
      </Grid12>

      {/* ─── Incident Timeline (clickable bars) ─── */}
      <CollapsibleSection title="Incident Timeline" className="mt-6" defaultOpen>
        <Card>
          {noData ? (
            <p className="text-sm text-text-secondary py-8 text-center">{NO_DATA_MESSAGE}</p>
          ) : (
            <div className="flex gap-1 overflow-x-auto pb-2">
              {Array.from({ length: 24 }, (_, h) => {
                const matchingIncident = overviewData.recent_incidents.find((_, i) => i === h % 4);
                const hasIncident = !!matchingIncident;
                return (
                  <div
                    key={h}
                    onClick={() => {
                      if (matchingIncident) {
                        openIncident(matchingIncident);
                      } else {
                        setDrawer({ kind: 'incidents-list' });
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
          )}
        </Card>
      </CollapsibleSection>

      </>
      )}

        </div>
      </div>

      {/* Drawers live outside section content so clicks always open the right panel */}
      <DrilldownDrawer
        isOpen={drawer !== null}
        onClose={closeDrawer}
        onBack={drawerMeta?.onBack}
        title={drawerMeta?.title ?? ''}
        subtitle={drawerMeta?.subtitle}
        type={drawerMeta?.type ?? 'service'}
        health={drawerMeta?.health}
        aiAssistant={drawerAI}
        actions={
          drawer?.kind === 'service' ? (
            <>
              <DrilldownButton onClick={() => navigate(`/services/${drawer.node.id}`)}>
                View Full Details
              </DrilldownButton>
              <DrilldownButton onClick={() => navigate(`/rca?service=${drawer.node.id}`)} variant="secondary">
                Run RCA
              </DrilldownButton>
              <DrilldownButton onClick={() => navigate(`/blast-radius?service=${drawer.node.id}`)} variant="secondary">
                Blast Radius
              </DrilldownButton>
            </>
          ) : drawer?.kind === 'incident' ? (
            <>
              <DrilldownButton onClick={() => navigate(`/rca?id=${drawer.incident.incident_id}`)}>
                Run RCA
              </DrilldownButton>
              <DrilldownButton onClick={() => navigate(`/incidents?id=${drawer.incident.incident_id}`)} variant="secondary">
                Open in Incidents
              </DrilldownButton>
            </>
          ) : undefined
        }
      >
        {drawer?.kind === 'service' && selectedNode && (
          <div className="space-y-6">
            <DrilldownSection title="Key Metrics" icon={<Activity className="w-4 h-4" />}>
              <div className="grid grid-cols-2 gap-3">
                <DrilldownMetricCard label="CPU Usage" value={Number(selectedNode.metrics?.cpu ?? 0).toFixed(1)} unit="%" status={Number(selectedNode.metrics?.cpu ?? 0) > 80 ? 'critical' : Number(selectedNode.metrics?.cpu ?? 0) > 60 ? 'warning' : 'good'} />
                <DrilldownMetricCard label="Memory" value={Number(selectedNode.metrics?.memory ?? 0).toFixed(1)} unit="%" status={Number(selectedNode.metrics?.memory ?? 0) > 85 ? 'critical' : Number(selectedNode.metrics?.memory ?? 0) > 70 ? 'warning' : 'good'} />
                <DrilldownMetricCard label="Latency" value={Number(selectedNode.metrics?.latency ?? 0).toFixed(1)} unit="ms" status={Number(selectedNode.metrics?.latency ?? 0) > 100 ? 'warning' : 'good'} />
                <DrilldownMetricCard label="Error Rate" value={Number(selectedNode.metrics?.error_rate ?? 0).toFixed(2)} unit="%" status={Number(selectedNode.metrics?.error_rate ?? 0) > 2 ? 'critical' : Number(selectedNode.metrics?.error_rate ?? 0) > 0.5 ? 'warning' : 'good'} />
                <DrilldownMetricCard label="Risk Score" value={Number(selectedNode.metrics?.risk_score ?? 0).toFixed(0)} status={Number(selectedNode.metrics?.risk_score ?? 0) > 70 ? 'critical' : Number(selectedNode.metrics?.risk_score ?? 0) > 40 ? 'warning' : 'good'} />
                <DrilldownMetricCard label="Incidents" value={Number(selectedNode.metrics?.incident_count ?? 0)} status={Number(selectedNode.metrics?.incident_count ?? 0) > 5 ? 'critical' : Number(selectedNode.metrics?.incident_count ?? 0) > 0 ? 'warning' : 'good'} />
              </div>
            </DrilldownSection>
            <DrilldownSection title="Dependencies" icon={<Network className="w-4 h-4" />}>
              {selectedNodeDeps ? (
                <RelatedResourcesPanel
                  resources={drawerRelatedResources}
                  title="Connected Services"
                  />
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">Loading dependencies...</p>
              )}
            </DrilldownSection>
          </div>
        )}

        {drawer?.kind === 'services-list' && (
          <div className="space-y-2">
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleServiceClick(s.id, s.name)}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border border-border hover:bg-card-hover transition-colors text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{s.name}</p>
                  <p className="text-xs text-text-secondary font-mono">{s.latency_p99_ms.toFixed(1)}ms · {s.error_rate.toFixed(2)}% errors</p>
                </div>
                <HealthBadge health={s.health} />
              </button>
            ))}
          </div>
        )}

        {drawer?.kind === 'incidents-list' && (
          <div className="space-y-2">
            {overviewData.recent_incidents.length === 0 ? (
              <p className="text-sm text-text-secondary">No active incidents</p>
            ) : (
              <>
                {overviewData.recent_incidents.slice(0, visibleIncidentsCount).map((inc) => (
                  <button
                    key={inc.incident_id}
                    type="button"
                    onClick={() => openIncident(inc)}
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-card-hover transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={inc.severity.startsWith('P1') || inc.severity === '1' ? 'critical' : 'warning'}>{inc.severity}</Badge>
                      <span className="text-xs text-text-secondary">{inc.service}</span>
                    </div>
                    <p className="text-sm text-text-primary">{inc.title}</p>
                  </button>
                ))}
                {overviewData.recent_incidents.length > visibleIncidentsCount && (
                  <button
                    type="button"
                    onClick={() => setVisibleIncidentsCount((prev) => prev + 20)}
                    className="w-full py-2 text-xs font-semibold text-center rounded-lg border border-border hover:bg-card-hover text-text-primary transition-colors mt-2"
                  >
                    Load More (+20)
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {drawer?.kind === 'incident' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={drawer.incident.severity.startsWith('P1') || drawer.incident.severity === '1' ? 'critical' : 'warning'}>
                {drawer.incident.severity}
              </Badge>
              <span className="text-sm text-text-secondary">{drawer.incident.service}</span>
            </div>
            <p className="text-sm text-text-primary">{drawer.incident.title}</p>
            {drawer.incident.root_cause && (
              <div className="p-4 rounded-lg border border-border bg-card-hover">
                <p className="text-xs font-semibold text-text-secondary mb-1">Root Cause</p>
                <p className="text-sm text-text-primary">{drawer.incident.root_cause}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => handleServiceClick(drawer.incident.service, drawer.incident.service)}
              className="w-full text-left p-3 rounded-lg border border-border hover:bg-card-hover transition-colors"
            >
              <p className="text-xs text-text-secondary mb-1">Impacted Service</p>
              <p className="text-sm font-medium text-primary">{drawer.incident.service}</p>
            </button>
          </div>
        )}

        {drawer?.kind === 'latency' && (
          <div className="space-y-4">
            <TrendChart data={latencyTrend} height={200} color="#F59E0B" />
            <div className="space-y-2">
              {services.slice().sort((a, b) => b.latency_p99_ms - a.latency_p99_ms).slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleServiceClick(s.id, s.name)}
                  className="w-full flex justify-between items-center p-3 rounded-lg border border-border hover:bg-card-hover text-left"
                >
                  <span className="text-sm text-text-primary">{s.name}</span>
                  <span className="font-mono text-xs">{s.latency_p99_ms.toFixed(1)}ms</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {drawer?.kind === 'error' && (
          <div className="space-y-4">
            <TrendChart data={errorTrend} height={200} color="#EF4444" />
            <div className="space-y-2">
              {services.slice().sort((a, b) => b.error_rate - a.error_rate).slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleServiceClick(s.id, s.name)}
                  className="w-full flex justify-between items-center p-3 rounded-lg border border-border hover:bg-card-hover text-left"
                >
                  <span className="text-sm text-text-primary">{s.name}</span>
                  <span className="font-mono text-xs">{s.error_rate.toFixed(2)}%</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {drawer?.kind === 'early-detection' && !drawer.detection && (
          <div className="space-y-2">
            {overviewData.early_detections.length === 0 ? (
              <p className="text-sm text-text-secondary">No active recommendations</p>
            ) : (
              overviewData.early_detections.map((d, i) => (
                <button
                  key={`${d.pattern_id}-${i}`}
                  type="button"
                  onClick={() => setDrawer({ kind: 'early-detection', detection: d })}
                  className="w-full text-left p-3 rounded-lg border border-border hover:bg-card-hover transition-colors"
                >
                  <p className="text-sm text-text-primary">{d.recommended_actions[0] ?? 'Investigate anomaly pattern'}</p>
                  <p className="text-xs text-text-secondary mt-1">{d.expected_impacted_service} · {d.confidence}% confidence · ETA {d.estimated_time_to_incident_minutes}m</p>
                </button>
              ))
            )}
          </div>
        )}

        {drawer?.kind === 'early-detection' && drawer.detection && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <DrilldownMetricCard label="Confidence" value={`${drawer.detection.confidence}%`} status={drawer.detection.confidence > 80 ? 'critical' : 'warning'} />
              <DrilldownMetricCard label="ETA" value={`${drawer.detection.estimated_time_to_incident_minutes}m`} status="warning" />
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2">Impacted Service</p>
              <button
                type="button"
                onClick={() => handleServiceClick(drawer.detection!.expected_impacted_service, drawer.detection!.expected_impacted_service)}
                className="text-sm font-medium text-primary hover:underline"
              >
                {drawer.detection.expected_impacted_service}
              </button>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2">Recommended Actions</p>
              <ul className="space-y-1">
                {drawer.detection.recommended_actions.map((action, i) => (
                  <li key={i} className="text-sm text-text-primary">• {action}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

      </DrilldownDrawer>

      <OpsEntityDrawer
        entity={opsEntity}
        onClose={closeOpsEntity}
        relatedEntities={opsEntities}
      />
    </div>
  );
}
