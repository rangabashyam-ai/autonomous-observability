import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactFlow, { Background, Controls, MiniMap, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { getMonitoringDashboard, getOverview, getDependencyGraph } from '../api/client';
import type { MonitoringDashboard, ServiceMetric } from '../types/api';
import type { Overview } from '../types/intelligence';
import { PageHeader, Grid12, CollapsibleSection } from '../components/ui/layout-primitives';
import { MetricCard } from '../components/ui/metric-card';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { DataTable, HealthBadge } from '../components/ui/data-table';
import { generateTrend, MiniLineChart, TrendChart } from '../components/charts/charts';
import { useTheme } from '../context/ThemeContext';
import { getHealthNodeStyle } from '../utils/graphTheme';
import { AlertCircle, Sparkles } from 'lucide-react';

export default function ServiceOperationsCenter() {
  const { theme } = useTheme();
  const [monitoring, setMonitoring] = useState<MonitoringDashboard | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [graphNodes, setGraphNodes] = useState<Node[]>([]);
  const [graphEdges, setGraphEdges] = useState<Edge[]>([]);

  useEffect(() => {
    Promise.all([
      getMonitoringDashboard(),
      getOverview(),
      getDependencyGraph('microservice', 'latency'),
    ])
      .then(([m, o, g]) => {
        setMonitoring(m);
        setOverview(o);
        const nodes: Node[] = g.nodes.slice(0, 12).map((n, i) => {
          const angle = (i / Math.min(g.nodes.length, 12)) * 2 * Math.PI;
          const r = 180;
          return {
            id: n.id,
            data: { label: n.label },
            position: { x: 250 + r * Math.cos(angle), y: 200 + r * Math.sin(angle) },
            style: getHealthNodeStyle(n.health, theme),
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
            style: { stroke: theme === 'dark' ? '#3B82F6' : '#2563EB', strokeWidth: 1 },
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

  if (!monitoring || !overview) {
    return <p className="text-text-secondary text-sm">Loading service operations center...</p>;
  }

  return (
    <div>
      <PageHeader
        title="Service Operations Center"
        description="Operational monitoring, dependency mapping, and incident correlation"
      />

      <Grid12 className="mb-4">
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Services Monitored"
            value={services.length}
            sub={`${services.filter((s) => s.health === 'healthy').length} healthy`}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Active Incidents"
            value={exec!.active_incidents}
            variant={exec!.active_incidents > 0 ? 'critical' : 'success'}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard label="Avg P99 Latency" value={`${avgLatency.toFixed(0)}ms`} variant="warning" />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard label="Avg Error Rate" value={`${avgError.toFixed(2)}%`} variant={avgError > 1.5 ? 'critical' : 'default'} />
        </div>
      </Grid12>

      <Grid12>
        <div className="col-span-12 xl:col-span-8 space-y-4">
          <CollapsibleSection title="Service Health Overview" defaultOpen>
            <Card padding={false}>
              <DataTable
                compact
                data={services}
                columns={[
                  {
                    key: 'name',
                    header: 'Service',
                    render: (s) => (
                      <Link
                        to={`/services/${s.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.name}
                      </Link>
                    )
                  },
                  { key: 'health', header: 'Status', render: (s) => <HealthBadge health={s.health} /> },
                  { key: 'latency', header: 'P99 Latency', render: (s) => <span className="font-mono text-xs">{s.latency_p99_ms.toFixed(1)}ms</span> },
                  { key: 'error', header: 'Error Rate', render: (s) => <span className="font-mono text-xs">{s.error_rate.toFixed(2)}%</span> },
                  { key: 'avail', header: 'Availability', render: (s) => <span className="font-mono text-xs">{s.availability.toFixed(2)}%</span> },
                  { key: 'rps', header: 'Throughput', render: (s) => <span className="font-mono text-xs">{s.throughput_rps.toFixed(0)} rps</span> },
                ]}
              />
            </Card>
          </CollapsibleSection>

          <CollapsibleSection title="Service Dependency Graph" defaultOpen>
            <Card padding={false} className="overflow-hidden">
              <div className="h-[280px]">
                <ReactFlow
                  nodes={graphNodes}
                  edges={graphEdges}
                  fitView
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color={theme === 'dark' ? '#1F2937' : '#E2E8F0'} gap={16} />
                  <Controls showInteractive={false} />
                  <MiniMap
                    nodeColor={() => (theme === 'dark' ? '#3B82F6' : '#2563EB')}
                    maskColor={theme === 'dark' ? '#0B122080' : '#F8FAFC80'}
                  />
                </ReactFlow>
              </div>
            </Card>
          </CollapsibleSection>

          <Grid12>
            <div className="col-span-12 md:col-span-6">
              <Card>
                <CardHeader><CardTitle>Latency Trends</CardTitle></CardHeader>
                <TrendChart data={latencyTrend} height={120} color="#F59E0B" />
              </Card>
            </div>
            <div className="col-span-12 md:col-span-6">
              <Card>
                <CardHeader><CardTitle>Error Rate Trends</CardTitle></CardHeader>
                <TrendChart data={errorTrend} height={120} color="#EF4444" />
              </Card>
            </div>
          </Grid12>
        </div>

        <div className="col-span-12 xl:col-span-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Incidents</CardTitle>
              <Link to="/incidents" className="text-xs text-primary hover:underline">All →</Link>
            </CardHeader>
            <div className="space-y-2">
              {overview.recent_incidents.slice(0, 4).map((inc) => (
                <Link
                  key={inc.incident_id}
                  to={`/incidents?id=${inc.incident_id}`}
                  className="block p-3 rounded-lg border border-border bg-background hover:bg-card-hover transition-colors"
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

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-warning" />
                <CardTitle>Top Risks</CardTitle>
              </div>
            </CardHeader>
            <div className="space-y-3">
              {topRisks.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-text-primary truncate">{s.name}</p>
                    <p className="text-[10px] text-text-secondary">
                      {s.error_rate.toFixed(2)}% errors · {s.latency_p99_ms.toFixed(0)}ms
                    </p>
                  </div>
                  <HealthBadge health={s.health} />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle>AI Recommendations</CardTitle>
              </div>
            </CardHeader>
            <div className="space-y-2">
              {overview.early_detections.slice(0, 3).map((d) => (
                <div key={d.pattern_id} className="p-3 rounded-lg border border-border bg-background">
                  <p className="text-xs text-text-primary">{d.recommended_actions[0] ?? 'Investigate anomaly pattern'}</p>
                  <p className="text-[10px] text-text-secondary mt-1">
                    {d.expected_impacted_service} · {d.confidence}% confidence
                  </p>
                </div>
              ))}
              {overview.early_detections.length === 0 && (
                <p className="text-xs text-text-secondary">No active recommendations</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Predicted Incidents</CardTitle></CardHeader>
            {overview.early_detections.length === 0 ? (
              <p className="text-xs text-text-secondary">No predicted incidents in next 4 hours</p>
            ) : (
              overview.early_detections.map((d) => (
                <div key={d.pattern_id} className="mb-3 last:mb-0">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-primary">{d.expected_impacted_service}</span>
                    <span className="text-critical font-mono">{d.estimated_time_to_incident_minutes}m</span>
                  </div>
                  <MiniLineChart data={generateTrend(d.confidence, 8)} height={40} color="#EF4444" />
                </div>
              ))
            )}
          </Card>
        </div>
      </Grid12>

      <CollapsibleSection title="Incident Timeline" className="mt-6" defaultOpen>
        <Card>
          <div className="flex gap-1 overflow-x-auto pb-2">
            {Array.from({ length: 24 }, (_, h) => {
              const hasIncident = overview.recent_incidents.some((_, i) => i === h % 4);
              return (
                <div key={h} className="flex flex-col items-center gap-1 min-w-[32px]">
                  <div
                    className={`h-8 w-full rounded-sm ${
                      hasIncident ? 'bg-critical/70' : h >= 8 && h <= 18 ? 'bg-success/40' : 'bg-success/20'
                    }`}
                    title={`${h}:00`}
                  />
                  <span className="text-[9px] text-text-secondary">{h}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </CollapsibleSection>
    </div>
  );
}
