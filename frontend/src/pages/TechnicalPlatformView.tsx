import { useEffect, useMemo, useState } from 'react';
import { getMonitoringDashboard } from '../api/client';
import type { MonitoringDashboard } from '../types/api';
import { PageHeader, Grid12, CollapsibleSection } from '../components/ui/layout-primitives';
import { MetricCard } from '../components/ui/metric-card';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { HealthBadge } from '../components/ui/badge';
import { DataTable } from '../components/ui/data-table';
import { generateTrend, MiniAreaChart, MiniLineChart } from '../components/charts/charts';
import { UtilizationBar } from '../components/dashboard/visualizations';
import { DrilldownHeatmap } from '../components/dashboard/drilldown-heatmap';
import { Modal } from '../components/ui/modal';
import InlineCopilot from '../components/copilot/InlineCopilot';

export default function TechnicalPlatformView() {
  const [data, setData] = useState<MonitoringDashboard | null>(null);
  const [openModal, setOpenModal] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [modalPage, setModalPage] = useState(1);
  const itemsPerPage = 25;

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
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <MetricCard
            label="K8s Cluster Health"
            value={`${k8sHealth}%`}
            variant={k8sHealth >= 90 ? 'success' : 'warning'}
            onClick={() => {
              setOpenModal('k8s');
              setModalPage(1);
            }}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <MetricCard
            label="Active Pods"
            value={tech!.containers.length}
            sub={`${tech!.containers.filter((c) => c.status !== 'healthy').length} degraded`}
            onClick={() => {
              setOpenModal('pods');
              setModalPage(1);
            }}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <MetricCard
            label="Avg CPU"
            value={`${avgCpu.toFixed(1)}%`}
            variant={avgCpu > 75 ? 'warning' : 'default'}
            onClick={() => {
              setOpenModal('cpu');
              setModalPage(1);
            }}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <MetricCard
            label="Avg Memory"
            value={`${avgMem.toFixed(1)}%`}
            variant={avgMem > 80 ? 'critical' : 'default'}
            onClick={() => {
              setOpenModal('memory');
              setModalPage(1);
            }}
          />
        </div>
      </Grid12>

      <CollapsibleSection title="Resource Heatmaps" description="Interactive drill-down: click nodes to see pods, click pods for detailed metrics">
        <Grid12>
          <div className="col-span-12">
            <DrilldownHeatmap
              title="Kubernetes Nodes"
              description={`${infra!.servers.length} nodes - Click any node to see pods running on it`}
              type="nodes"
              data={infra!.servers}
              containers={tech!.containers}
            />
          </div>
          <div className="col-span-12">
            <DrilldownHeatmap
              title="Pod Status Grid"
              description={`${tech!.containers.length} pods - Click any pod to see detailed CPU, memory, node, and cluster information`}
              type="pods"
              data={tech!.containers}
              containers={tech!.containers}
            />
          </div>
          <div className="col-span-12">
            <DrilldownHeatmap
              title="API Gateway Load"
              description={`${tech!.apis.length} API endpoints - Shows latency, error rate, and request throughput`}
              type="apis"
              data={tech!.apis}
              containers={[]}
            />
          </div>
        </Grid12>
      </CollapsibleSection>

      <CollapsibleSection title="Platform Metrics" className="mt-6" defaultOpen>
        <Grid12>
          <div className="col-span-12 lg:col-span-3 cursor-pointer" onClick={() => setSelectedMetric('k8s')}>
            <Card className="hover:shadow-lg transition-shadow h-full">
              <CardHeader><CardTitle>K8s Cluster Status</CardTitle></CardHeader>
              <MiniAreaChart data={generateTrend(k8sHealth, 12)} height={80} color="#10B981" />
              <div className="mt-3 space-y-2 px-5 pb-5">
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Running</span>
                  <span className="font-mono text-text-primary">{tech!.containers.filter((c) => c.status === 'healthy').length}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Degraded</span>
                  <span className="font-mono text-text-primary">{tech!.containers.filter((c) => c.status === 'warning').length}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Critical</span>
                  <span className="font-mono text-text-primary">{tech!.containers.filter((c) => c.status === 'critical').length}</span>
                </div>
              </div>
            </Card>
          </div>
          <div className="col-span-12 lg:col-span-3 cursor-pointer" onClick={() => setSelectedMetric('apis')}>
            <Card className="hover:shadow-lg transition-shadow h-full">
              <CardHeader><CardTitle>API Performance</CardTitle></CardHeader>
              <MiniLineChart
                data={generateTrend(tech!.apis.reduce((a, x) => a + x.latency_ms, 0) / tech!.apis.length, 12)}
                height={80}
                color="#3B82F6"
              />
              <div className="mt-3 space-y-2 px-5 pb-5">
                {tech!.apis.slice(0, 3).map((a) => (
                  <UtilizationBar key={a.name} label={a.name} value={a.latency_ms} max={300} />
                ))}
              </div>
            </Card>
          </div>
          <div className="col-span-12 lg:col-span-3 cursor-pointer" onClick={() => setSelectedMetric('databases')}>
            <Card className="hover:shadow-lg transition-shadow h-full">
              <CardHeader><CardTitle>Database Load</CardTitle></CardHeader>
              <MiniAreaChart
                data={generateTrend(
                  tech!.databases.reduce((a, d) => a + d.connections, 0) / tech!.databases.length,
                  12
                )}
                height={80}
                color="#F59E0B"
              />
              <div className="mt-3 space-y-2 px-5 pb-5">
                {tech!.databases.slice(0, 3).map((db) => (
                  <div key={db.id} className="flex justify-between text-xs">
                    <span className="text-text-secondary truncate">{db.id}</span>
                    <span className="font-mono text-text-primary">{db.query_latency_ms.toFixed(0)}ms</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div className="col-span-12 lg:col-span-3 cursor-pointer" onClick={() => setSelectedMetric('queues')}>
            <Card className="hover:shadow-lg transition-shadow h-full">
              <CardHeader><CardTitle>Queue Metrics</CardTitle></CardHeader>
              <MiniLineChart
                data={generateTrend(tech!.queues.reduce((a, q) => a + q.depth, 0) / tech!.queues.length, 12, 0.2)}
                height={80}
                color="#EF4444"
              />
              <div className="mt-3 space-y-2 px-5 pb-5">
                {tech!.queues.slice(0, 3).map((q) => (
                  <div key={q.id} className="flex justify-between text-xs">
                    <span className="text-text-secondary truncate">{q.id}</span>
                    <span className="font-mono text-text-primary">{q.depth.toLocaleString()}</span>
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

      {/* K8s Cluster Health Modal */}
      <Modal isOpen={openModal === 'k8s'} onClose={() => setOpenModal(null)} title="K8s Cluster Health Details" size="lg">
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-card-hover">
              <p className="text-xs text-text-secondary mb-1">Running</p>
              <p className="text-2xl font-bold text-success">{tech!.containers.filter((c) => c.status === 'healthy').length}</p>
            </div>
            <div className="p-4 rounded-lg bg-card-hover">
              <p className="text-xs text-text-secondary mb-1">Degraded</p>
              <p className="text-2xl font-bold text-warning">{tech!.containers.filter((c) => c.status === 'warning').length}</p>
            </div>
            <div className="p-4 rounded-lg bg-card-hover">
              <p className="text-xs text-text-secondary mb-1">Critical</p>
              <p className="text-2xl font-bold text-critical">{tech!.containers.filter((c) => c.status === 'critical').length}</p>
            </div>
          </div>
          
          <div>
            <h3 className="text-sm font-semibold mb-3">Pod Distribution ({tech!.containers.length} total)</h3>
            <div className="space-y-2">
              {tech!.containers
                .slice((modalPage - 1) * itemsPerPage, modalPage * itemsPerPage)
                .map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                    <div>
                      <p className="text-sm font-mono">{c.id}</p>
                      <p className="text-xs text-text-secondary mt-0.5">CPU: {c.cpu.toFixed(1)}% | Memory: {c.memory.toFixed(1)}%</p>
                    </div>
                    <HealthBadge health={c.status} />
                  </div>
                ))}
            </div>

            {tech!.containers.length > itemsPerPage && (
              <div className="flex justify-center items-center gap-2 mt-4">
                <button
                  onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                  disabled={modalPage === 1}
                  className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
                >
                  ← Prev
                </button>
                <span className="text-xs text-text-secondary">
                  Page {modalPage} of {Math.ceil(tech!.containers.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setModalPage((p) => Math.min(Math.ceil(tech!.containers.length / itemsPerPage), p + 1))}
                  disabled={modalPage === Math.ceil(tech!.containers.length / itemsPerPage)}
                  className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Active Pods Modal */}
      <Modal isOpen={openModal === 'pods'} onClose={() => setOpenModal(null)} title="Active Pods - Complete List" size="xl">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">Total Pods: <span className="font-semibold text-text-primary">{tech!.containers.length}</span></p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-semibold text-text-primary">Pod Name</th>
                  <th className="text-left py-2 px-3 font-semibold text-text-primary">Status</th>
                  <th className="text-right py-2 px-3 font-semibold text-text-primary">CPU</th>
                  <th className="text-right py-2 px-3 font-semibold text-text-primary">Memory</th>
                  <th className="text-right py-2 px-3 font-semibold text-text-primary">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {tech!.containers
                  .slice((modalPage - 1) * itemsPerPage, modalPage * itemsPerPage)
                  .map((c) => (
                    <tr key={c.id} className="border-b border-border hover:bg-card-hover">
                      <td className="py-2 px-3 font-mono text-xs">{c.id}</td>
                      <td className="py-2 px-3"><HealthBadge health={c.status} /></td>
                      <td className="py-2 px-3 text-right font-mono text-xs">{c.cpu.toFixed(1)}%</td>
                      <td className="py-2 px-3 text-right font-mono text-xs">{c.memory.toFixed(1)}%</td>
                      <td className="py-2 px-3 text-right">
                        <div className="w-16 h-2 bg-border rounded-full overflow-hidden mx-auto">
                          <div
                            className="h-full bg-gradient-to-r from-success to-warning"
                            style={{ width: `${(c.cpu + c.memory) / 2}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {tech!.containers.length > itemsPerPage && (
            <div className="flex justify-center items-center gap-2">
              <button
                onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                disabled={modalPage === 1}
                className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
              >
                ← Prev
              </button>
              <span className="text-xs text-text-secondary">
                Page {modalPage} of {Math.ceil(tech!.containers.length / itemsPerPage)}
              </span>
              <button
                onClick={() => setModalPage((p) => Math.min(Math.ceil(tech!.containers.length / itemsPerPage), p + 1))}
                disabled={modalPage === Math.ceil(tech!.containers.length / itemsPerPage)}
                className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Average CPU Modal */}
      <Modal isOpen={openModal === 'cpu'} onClose={() => setOpenModal(null)} title="CPU Usage - Nodes & Pods Breakdown" size="xl">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-card-hover">
              <p className="text-xs text-text-secondary mb-1">Average Cluster CPU</p>
              <p className="text-3xl font-bold text-primary">{avgCpu.toFixed(1)}%</p>
            </div>
            <div className="p-4 rounded-lg bg-card-hover">
              <p className="text-xs text-text-secondary mb-1">Node Count</p>
              <p className="text-3xl font-bold">{infra!.servers.length}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">Node CPU Usage ({infra!.servers.length} total)</h3>
            <div className="space-y-2">
              {infra!.servers
                .slice((modalPage - 1) * itemsPerPage, modalPage * itemsPerPage)
                .map((s) => (
                  <div key={s.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-mono text-text-primary">{s.id}</span>
                      <span className="font-semibold">{s.cpu.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-2 bg-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          s.cpu > 75 ? 'bg-critical' : s.cpu > 50 ? 'bg-warning' : 'bg-success'
                        }`}
                        style={{ width: `${s.cpu}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>

            {infra!.servers.length > itemsPerPage && (
              <div className="flex justify-center items-center gap-2 mt-4">
                <button
                  onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                  disabled={modalPage === 1}
                  className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
                >
                  ← Prev
                </button>
                <span className="text-xs text-text-secondary">
                  Page {modalPage} of {Math.ceil(infra!.servers.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setModalPage((p) => Math.min(Math.ceil(infra!.servers.length / itemsPerPage), p + 1))}
                  disabled={modalPage === Math.ceil(infra!.servers.length / itemsPerPage)}
                  className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">Top 10 Pod CPU Usage</h3>
            <div className="space-y-2">
              {tech!.containers
                .slice()
                .sort((a, b) => b.cpu - a.cpu)
                .slice(0, 10)
                .map((c) => (
                  <div key={c.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-mono text-text-primary">{c.id}</span>
                      <span className="font-semibold">{c.cpu.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-2 bg-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          c.cpu > 75 ? 'bg-critical' : c.cpu > 50 ? 'bg-warning' : 'bg-success'
                        }`}
                        style={{ width: `${Math.min(100, c.cpu)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Average Memory Modal */}
      <Modal isOpen={openModal === 'memory'} onClose={() => setOpenModal(null)} title="Memory Usage - Complete Breakdown" size="xl">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-card-hover">
              <p className="text-xs text-text-secondary mb-1">Average Cluster Memory</p>
              <p className="text-3xl font-bold text-primary">{avgMem.toFixed(1)}%</p>
            </div>
            <div className="p-4 rounded-lg bg-card-hover">
              <p className="text-xs text-text-secondary mb-1">Total Infrastructure</p>
              <p className="text-3xl font-bold">{infra!.servers.length} nodes</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">Node Memory Usage ({infra!.servers.length} total)</h3>
            <div className="space-y-2">
              {infra!.servers
                .slice((modalPage - 1) * itemsPerPage, modalPage * itemsPerPage)
                .map((s) => (
                  <div key={s.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-mono text-text-primary">{s.id}</span>
                      <span className="font-semibold">{s.memory.toFixed(1)}% | Storage: {s.storage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-2 bg-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          s.memory > 80 ? 'bg-critical' : s.memory > 60 ? 'bg-warning' : 'bg-success'
                        }`}
                        style={{ width: `${s.memory}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>

            {infra!.servers.length > itemsPerPage && (
              <div className="flex justify-center items-center gap-2 mt-4">
                <button
                  onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                  disabled={modalPage === 1}
                  className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
                >
                  ← Prev
                </button>
                <span className="text-xs text-text-secondary">
                  Page {modalPage} of {Math.ceil(infra!.servers.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setModalPage((p) => Math.min(Math.ceil(infra!.servers.length / itemsPerPage), p + 1))}
                  disabled={modalPage === Math.ceil(infra!.servers.length / itemsPerPage)}
                  className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">Top 10 Pod Memory Usage</h3>
            <div className="space-y-2">
              {tech!.containers
                .slice()
                .sort((a, b) => b.memory - a.memory)
                .slice(0, 10)
                .map((c) => (
                  <div key={c.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-mono text-text-primary">{c.id}</span>
                      <span className="font-semibold">{c.memory.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-2 bg-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          c.memory > 80 ? 'bg-critical' : c.memory > 60 ? 'bg-warning' : 'bg-success'
                        }`}
                        style={{ width: `${Math.min(100, c.memory)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">Database Connections</h3>
            <div className="space-y-2">
              {tech!.databases.map((db) => (
                <div key={db.id} className="flex justify-between items-center p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm font-mono">{db.id}</p>
                    <p className="text-xs text-text-secondary">Query Latency: {db.query_latency_ms.toFixed(1)}ms | Replication Lag: {db.replication_lag_ms.toFixed(1)}ms</p>
                  </div>
                  <span className="font-semibold">{db.connections} conn</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* K8s Cluster Drill-Down Modal */}
      <Modal isOpen={selectedMetric === 'k8s'} onClose={() => setSelectedMetric(null)} title="K8s Cluster Status - Detailed View" size="xl">
        {tech && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-success/10 to-success/5 border border-success/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Running</p>
                <p className="text-3xl font-bold text-success">{tech.containers.filter((c) => c.status === 'healthy').length}</p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-warning/10 to-warning/5 border border-warning/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Degraded</p>
                <p className="text-3xl font-bold text-warning">{tech.containers.filter((c) => c.status === 'warning').length}</p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-critical/10 to-critical/5 border border-critical/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Critical</p>
                <p className="text-3xl font-bold text-critical">{tech.containers.filter((c) => c.status === 'critical').length}</p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">All Containers ({tech.containers.length} total)</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tech.containers.map((c) => (
                  <div key={c.id} className="p-3 rounded-lg border border-border hover:bg-card-hover transition-all">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-mono font-semibold">{c.id}</p>
                      <HealthBadge health={c.status} />
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs text-text-secondary">
                      <span>CPU: <span className="font-semibold text-text-primary">{c.cpu.toFixed(1)}%</span></span>
                      <span>Memory: <span className="font-semibold text-text-primary">{c.memory.toFixed(1)}%</span></span>
                      <span>Health: <span className="font-semibold text-text-primary">{((c.cpu + c.memory) / 2).toFixed(0)}%</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* API Performance Drill-Down Modal */}
      <Modal isOpen={selectedMetric === 'apis'} onClose={() => setSelectedMetric(null)} title="API Performance - All Endpoints" size="xl">
        {tech && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Total APIs</p>
                <p className="text-3xl font-bold text-primary">{tech.apis.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-warning/10 to-warning/5 border border-warning/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Avg Latency</p>
                <p className="text-3xl font-bold text-warning">{(tech.apis.reduce((a, x) => a + x.latency_ms, 0) / tech.apis.length).toFixed(1)}ms</p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-critical/10 to-critical/5 border border-critical/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Avg Error Rate</p>
                <p className="text-3xl font-bold text-critical">{(tech.apis.reduce((a, x) => a + x.error_rate, 0) / tech.apis.length).toFixed(2)}%</p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">All API Endpoints ({tech.apis.length} total)</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tech.apis.map((api) => {
                  const score = Math.min(100, api.latency_ms / 3 + api.error_rate * 20);
                  return (
                    <div key={api.name} className="p-3 rounded-lg border border-border hover:bg-card-hover transition-all">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-mono font-semibold flex-1">{api.name}</p>
                        <span className={`px-2 py-1 rounded text-xs font-semibold text-white whitespace-nowrap ml-2 ${
                          score >= 85 ? 'bg-critical' : score >= 70 ? 'bg-warning' : 'bg-success'
                        }`}>
                          {score.toFixed(0)}%
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-xs text-text-secondary mb-2">
                        <span>Latency: <span className="font-semibold text-text-primary">{api.latency_ms.toFixed(1)}ms</span></span>
                        <span>Error: <span className="font-semibold text-text-primary">{api.error_rate.toFixed(2)}%</span></span>
                        <span>RPS: <span className="font-semibold text-text-primary">{api.requests_per_sec.toFixed(0)}</span></span>
                      </div>
                      <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, score)}%`,
                            backgroundColor: score >= 85 ? '#EF4444' : score >= 70 ? '#F59E0B' : '#10B981'
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Database Load Drill-Down Modal */}
      <Modal isOpen={selectedMetric === 'databases'} onClose={() => setSelectedMetric(null)} title="Database Load - All Databases" size="xl">
        {tech && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Total Databases</p>
                <p className="text-3xl font-bold text-primary">{tech.databases.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-warning/10 to-warning/5 border border-warning/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Avg Connections</p>
                <p className="text-3xl font-bold text-warning">{(tech.databases.reduce((a, d) => a + d.connections, 0) / tech.databases.length).toFixed(0)}</p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-success/10 to-success/5 border border-success/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Avg Query Time</p>
                <p className="text-3xl font-bold text-success">{(tech.databases.reduce((a, d) => a + d.query_latency_ms, 0) / tech.databases.length).toFixed(0)}ms</p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">All Databases ({tech.databases.length} total)</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tech.databases.map((db) => {
                  const connScore = Math.min(100, (db.connections / 100) * 100);
                  return (
                    <div key={db.id} className="p-3 rounded-lg border border-border hover:bg-card-hover transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-mono font-semibold">{db.id}</p>
                        <span className="text-xs font-semibold text-text-primary">{db.connections} connections</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-xs text-text-secondary mb-2">
                        <span>Query Latency: <span className="font-semibold text-text-primary">{db.query_latency_ms.toFixed(1)}ms</span></span>
                        <span>Replication: <span className="font-semibold text-text-primary">{db.replication_lag_ms.toFixed(1)}ms</span></span>
                        <span>Health: <span className="font-semibold text-text-primary">{(100 - connScore).toFixed(0)}%</span></span>
                      </div>
                      <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, connScore)}%`,
                            backgroundColor: connScore >= 80 ? '#EF4444' : connScore >= 50 ? '#F59E0B' : '#10B981'
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Queue Metrics Drill-Down Modal */}
      <Modal isOpen={selectedMetric === 'queues'} onClose={() => setSelectedMetric(null)} title="Queue Metrics - All Queues" size="xl">
        {tech && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Total Queues</p>
                <p className="text-3xl font-bold text-primary">{tech.queues.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-warning/10 to-warning/5 border border-warning/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Total Depth</p>
                <p className="text-3xl font-bold text-warning">{tech.queues.reduce((a, q) => a + q.depth, 0).toLocaleString()}</p>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-success/10 to-success/5 border border-success/20">
                <p className="text-xs text-text-secondary mb-2 font-medium">Avg Throughput</p>
                <p className="text-3xl font-bold text-success">{(tech.queues.reduce((a, q) => a + q.throughput_msg_s, 0) / tech.queues.length).toFixed(0)}/s</p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">All Queues ({tech.queues.length} total)</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tech.queues.map((q) => {
                  const depthScore = Math.min(100, (q.depth / 10000) * 100);
                  return (
                    <div key={q.id} className="p-3 rounded-lg border border-border hover:bg-card-hover transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-mono font-semibold">{q.id}</p>
                        <span className="text-xs font-semibold text-text-primary">{q.depth.toLocaleString()} messages</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-xs text-text-secondary mb-2">
                        <span>Throughput: <span className="font-semibold text-text-primary">{q.throughput_msg_s.toFixed(0)}/s</span></span>
                        <span>Lag: <span className="font-semibold text-text-primary">{q.consumer_lag.toFixed(0)}</span></span>
                        <span>Health: <span className="font-semibold text-text-primary">{(100 - depthScore).toFixed(0)}%</span></span>
                      </div>
                      <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, depthScore)}%`,
                            backgroundColor: depthScore >= 80 ? '#EF4444' : depthScore >= 50 ? '#F59E0B' : '#10B981'
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
