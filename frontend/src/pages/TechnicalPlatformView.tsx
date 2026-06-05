import { useEffect, useMemo, useState } from 'react';
import { getMonitoringDashboard } from '../api/client';
import type { MonitoringDashboard } from '../types/api';
import { PageHeader, Grid12, CollapsibleSection } from '../components/ui/layout-primitives';
import { MetricCard } from '../components/ui/metric-card';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Badge, HealthBadge } from '../components/ui/badge';
import { DataTable } from '../components/ui/data-table';
import { generateTrend, MiniAreaChart, MiniLineChart } from '../components/charts/charts';
import { ResourceHeatmap, UtilizationBar } from '../components/dashboard/visualizations';

export default function TechnicalPlatformView() {
  const [data, setData] = useState<MonitoringDashboard | null>(null);

  useEffect(() => {
    getMonitoringDashboard().then(setData).catch(console.error);
  }, []);

  const tech = data?.technical;
  const infra = data?.infrastructure;

  const k8sHealth = useMemo(() => {
    if (!tech?.containers.length) return 0;
    const healthy = tech.containers.filter((c) => c.status === 'healthy').length;
    return Math.round((healthy / tech.containers.length) * 100);
  }, [tech]);

  const nodeCells = useMemo(
    () =>
      infra?.servers.slice(0, 32).map((s) => ({
        id: s.id,
        value: (s.cpu + s.memory + s.storage) / 3,
        label: s.id,
      })) ?? [],
    [infra]
  );

  const podCells = useMemo(
    () =>
      tech?.containers.slice(0, 24).map((c) => ({
        id: c.id,
        value: (c.cpu + c.memory) / 2,
        label: c.id,
      })) ?? [],
    [tech]
  );

  const apiCells = useMemo(
    () =>
      tech?.apis.slice(0, 16).map((a) => ({
        id: a.name,
        value: Math.min(100, a.latency_ms / 3 + a.error_rate * 20),
        label: a.name,
      })) ?? [],
    [tech]
  );

  if (!data) {
    return <p className="text-text-secondary text-sm">Loading technical platform view...</p>;
  }

  const avgCpu = infra?.summary.avg_cpu ?? 0;
  const avgMem = infra?.summary.avg_memory ?? 0;

  return (
    <div>
      <PageHeader
        title="Technical Platform View"
        description="Kubernetes, infrastructure, API, database, and queue metrics for platform engineering"
      />

      <Grid12 className="mb-4">
        <div className="col-span-6 sm:col-span-3">
          <MetricCard label="K8s Cluster Health" value={`${k8sHealth}%`} variant={k8sHealth >= 90 ? 'success' : 'warning'} />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <MetricCard label="Active Pods" value={tech!.containers.length} sub={`${tech!.containers.filter((c) => c.status !== 'healthy').length} degraded`} />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <MetricCard label="Avg CPU" value={`${avgCpu.toFixed(1)}%`} variant={avgCpu > 75 ? 'warning' : 'default'} />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <MetricCard label="Avg Memory" value={`${avgMem.toFixed(1)}%`} variant={avgMem > 80 ? 'critical' : 'default'} />
        </div>
      </Grid12>

      <CollapsibleSection title="Resource Heatmaps" description="Cluster nodes, pods, and API gateway utilization">
        <Grid12>
          <div className="col-span-12 md:col-span-4">
            <Card>
              <CardHeader>
                <CardTitle>Kubernetes Nodes</CardTitle>
                <Badge variant="outline">{infra!.servers.length} nodes</Badge>
              </CardHeader>
              <ResourceHeatmap cells={nodeCells} columns={8} />
              <p className="text-[10px] text-text-secondary mt-2">CPU / Memory / Storage composite</p>
            </Card>
          </div>
          <div className="col-span-12 md:col-span-4">
            <Card>
              <CardHeader>
                <CardTitle>Pod Status Grid</CardTitle>
                <Badge variant="outline">{tech!.containers.length} pods</Badge>
              </CardHeader>
              <ResourceHeatmap cells={podCells} columns={6} />
              <p className="text-[10px] text-text-secondary mt-2">Per-pod resource utilization</p>
            </Card>
          </div>
          <div className="col-span-12 md:col-span-4">
            <Card>
              <CardHeader>
                <CardTitle>API Gateway Load</CardTitle>
                <Badge variant="outline">{tech!.apis.length} endpoints</Badge>
              </CardHeader>
              <ResourceHeatmap cells={apiCells} columns={4} />
              <p className="text-[10px] text-text-secondary mt-2">Latency + error composite score</p>
            </Card>
          </div>
        </Grid12>
      </CollapsibleSection>

      <CollapsibleSection title="Platform Metrics" className="mt-6" defaultOpen>
        <Grid12>
          <div className="col-span-12 lg:col-span-3">
            <Card>
              <CardHeader><CardTitle>K8s Cluster Status</CardTitle></CardHeader>
              <MiniAreaChart data={generateTrend(k8sHealth, 12)} height={80} color="#10B981" />
              <div className="mt-3 space-y-2">
                {['Running', 'Pending', 'Failed'].map((status, i) => (
                  <div key={status} className="flex justify-between text-xs">
                    <span className="text-text-secondary">{status}</span>
                    <span className="font-mono text-text-primary">
                      {i === 0
                        ? tech!.containers.filter((c) => c.status === 'healthy').length
                        : i === 1
                          ? tech!.containers.filter((c) => c.status === 'warning').length
                          : tech!.containers.filter((c) => c.status === 'critical').length}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div className="col-span-12 lg:col-span-3">
            <Card>
              <CardHeader><CardTitle>API Performance</CardTitle></CardHeader>
              <MiniLineChart
                data={generateTrend(tech!.apis.reduce((a, x) => a + x.latency_ms, 0) / tech!.apis.length, 12)}
                height={80}
                color="#3B82F6"
              />
              <div className="mt-3 space-y-2">
                {tech!.apis.slice(0, 3).map((a) => (
                  <UtilizationBar key={a.name} label={a.name} value={a.latency_ms} max={300} />
                ))}
              </div>
            </Card>
          </div>
          <div className="col-span-12 lg:col-span-3">
            <Card>
              <CardHeader><CardTitle>Database Load</CardTitle></CardHeader>
              <MiniAreaChart
                data={generateTrend(
                  tech!.databases.reduce((a, d) => a + d.connections, 0) / tech!.databases.length,
                  12
                )}
                height={80}
                color="#F59E0B"
              />
              <div className="mt-3 space-y-2">
                {tech!.databases.slice(0, 3).map((db) => (
                  <div key={db.id} className="flex justify-between text-xs">
                    <span className="text-text-secondary truncate">{db.id}</span>
                    <span className="font-mono text-text-primary">{db.query_latency_ms.toFixed(0)}ms</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div className="col-span-12 lg:col-span-3">
            <Card>
              <CardHeader><CardTitle>Queue Metrics</CardTitle></CardHeader>
              <MiniLineChart
                data={generateTrend(tech!.queues.reduce((a, q) => a + q.depth, 0) / tech!.queues.length, 12, 0.2)}
                height={80}
                color="#EF4444"
              />
              <div className="mt-3 space-y-2">
                {tech!.queues.slice(0, 3).map((q) => (
                  <div key={q.id} className="flex justify-between text-xs">
                    <span className="text-text-secondary truncate">{q.id}</span>
                    <span className="font-mono text-text-primary">{q.depth.toLocaleString()} depth</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </Grid12>
      </CollapsibleSection>

      <CollapsibleSection title="Infrastructure Details" className="mt-6" defaultOpen>
        <Grid12>
          <div className="col-span-12 lg:col-span-6">
            <Card padding={false}>
              <div className="p-5 pb-0">
                <CardHeader><CardTitle>Container Status</CardTitle></CardHeader>
              </div>
              <DataTable
                compact
                data={tech!.containers}
                columns={[
                  { key: 'id', header: 'Pod', render: (c) => <span className="text-xs font-mono">{c.id}</span> },
                  { key: 'status', header: 'Status', render: (c) => <HealthBadge health={c.status} /> },
                  { key: 'cpu', header: 'CPU', render: (c) => <span className="font-mono text-xs">{c.cpu.toFixed(1)}%</span> },
                  { key: 'mem', header: 'Memory', render: (c) => <span className="font-mono text-xs">{c.memory.toFixed(1)}%</span> },
                ]}
              />
            </Card>
          </div>
          <div className="col-span-12 lg:col-span-6">
            <Card padding={false}>
              <div className="p-5 pb-0">
                <CardHeader><CardTitle>JVM Metrics</CardTitle></CardHeader>
              </div>
              <DataTable
                compact
                data={tech!.jvm}
                columns={[
                  { key: 'service', header: 'Service', render: (j) => <span className="text-xs">{j.service}</span> },
                  { key: 'heap', header: 'Heap', render: (j) => <span className="font-mono text-xs">{j.heap_used_pct.toFixed(1)}%</span> },
                  { key: 'threads', header: 'Threads', render: (j) => <span className="font-mono text-xs">{j.thread_count}</span> },
                  { key: 'gc', header: 'GC Pause', render: (j) => <span className="font-mono text-xs">{j.gc_pause_ms.toFixed(0)}ms</span> },
                ]}
              />
            </Card>
          </div>
        </Grid12>
      </CollapsibleSection>
    </div>
  );
}
