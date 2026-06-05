import type { MonitoringDashboard } from '../../types/api';
import { formatNumber } from '../../utils/colors';
import { ResourceHeatmap } from '../ui/resource-heatmap';

interface Props {
  data: MonitoringDashboard['technical'];
}

function Bar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function getPodHealth(cpu: number, memory: number): 'healthy' | 'warning' | 'critical' {
  const maxVal = Math.max(cpu, memory);
  if (maxVal >= 80) return 'critical';
  if (maxVal >= 60) return 'warning';
  return 'healthy';
}

function getApiHealth(latency: number, errorRate: number): 'healthy' | 'warning' | 'critical' {
  if (errorRate >= 5 || latency >= 500) return 'critical';
  if (errorRate >= 2 || latency >= 200) return 'warning';
  return 'healthy';
}

export default function TechnicalView({ data }: Props) {
  // Transform containers/pods for heatmap
  const podResources = data.containers.map((c) => ({
    id: c.id,
    name: c.id.replace('k8s-cluster-', 'K8S-').replace('-pod-', '-P'),
    type: 'pod' as const,
    primaryMetric: {
      label: 'CPU',
      value: c.cpu,
      unit: '%',
    },
    health: getPodHealth(c.cpu, c.memory),
    metrics: {
      cpu: c.cpu,
      memory: c.memory,
      status: c.status,
      last_updated: new Date().toISOString(),
    },
  }));

  // Transform APIs for heatmap
  const apiResources = data.apis.map((api) => ({
    id: api.name,
    name: api.name,
    type: 'api' as const,
    primaryMetric: {
      label: 'Latency',
      value: api.latency_ms,
      unit: 'ms',
    },
    health: getApiHealth(api.latency_ms, api.error_rate),
    metrics: {
      latency: api.latency_ms,
      error_rate: api.error_rate,
      status: `${formatNumber(api.requests_per_sec, 0)} RPS`,
      last_updated: new Date().toISOString(),
    },
  }));

  // Transform databases for heatmap
  const databaseResources = data.databases.map((db) => {
    const health: 'healthy' | 'warning' | 'critical' =
      db.query_latency_ms >= 100 || db.replication_lag_ms >= 1000 ? 'critical'
      : db.query_latency_ms >= 50 || db.replication_lag_ms >= 500 ? 'warning'
      : 'healthy';
    
    return {
      id: db.id,
      name: db.id.replace('-cluster', '').toUpperCase(),
      type: 'database' as const,
      primaryMetric: {
        label: 'Query Latency',
        value: db.query_latency_ms,
        unit: 'ms',
      },
      health,
      metrics: {
        latency: db.query_latency_ms,
        status: `${db.connections} connections`,
        last_updated: new Date().toISOString(),
      },
    };
  });

  // Transform queues for heatmap
  const queueResources = data.queues.map((q) => {
    const health: 'healthy' | 'warning' | 'critical' =
      q.depth >= 10000 || q.consumer_lag >= 5000 ? 'critical'
      : q.depth >= 5000 || q.consumer_lag >= 2000 ? 'warning'
      : 'healthy';
    
    return {
      id: q.id,
      name: q.id.replace('-cluster', '').toUpperCase(),
      type: 'queue' as const,
      primaryMetric: {
        label: 'Queue Depth',
        value: q.depth,
        unit: '',
      },
      health,
      metrics: {
        status: `${formatNumber(q.throughput_msg_s, 0)} msg/s`,
        last_updated: new Date().toISOString(),
      },
    };
  });

  return (
    <div className="space-y-6">
      <ResourceHeatmap
        title="Kubernetes Pods & Containers"
        resources={podResources}
        columns={4}
      />

      <ResourceHeatmap
        title="API Endpoints"
        resources={apiResources}
        columns={4}
      />

      <ResourceHeatmap
        title="Databases"
        resources={databaseResources}
        columns={3}
      />

      <ResourceHeatmap
        title="Message Queues"
        resources={queueResources}
        columns={3}
      />

      <section>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">JVM / Runtime Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.jvm.map((j) => (
            <div key={j.service} className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-xs">
              <p className="text-slate-700 dark:text-slate-300 mb-2 font-medium">{j.service}</p>
              <div className="space-y-1 text-slate-500 dark:text-slate-400">
                <div>Heap: {j.heap_used_pct}% <Bar value={j.heap_used_pct} /></div>
                <div>Threads: {j.thread_count}</div>
                <div>GC Pause: {j.gc_pause_ms}ms</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Databases</h3>
        <div className="space-y-2">
          {data.databases.map((db) => (
            <div key={db.id} className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg flex justify-between text-xs">
              <span className="text-slate-700 dark:text-slate-300">{db.id}</span>
              <div className="flex gap-4 font-mono text-slate-500 dark:text-slate-400">
                <span>conn: {db.connections}</span>
                <span>query: {db.query_latency_ms}ms</span>
                <span>lag: {db.replication_lag_ms}ms</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Queues</h3>
        <div className="space-y-2">
          {data.queues.map((q) => (
            <div key={q.id} className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-slate-700 dark:text-slate-300">{q.id}</span>
                <span className="text-slate-500 dark:text-slate-400">{formatNumber(q.throughput_msg_s, 0)} msg/s</span>
              </div>
              <div className="flex gap-4 text-[10px] text-slate-500 dark:text-slate-400">
                <span>Depth: {formatNumber(q.depth, 0)}</span>
                <span>Consumer lag: {formatNumber(q.consumer_lag, 0)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lg:col-span-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">JVM / Threads</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.jvm.map((j) => (
            <div key={j.service} className="p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-xs">
              <p className="text-slate-700 dark:text-slate-300 mb-2">{j.service}</p>
              <div className="space-y-1 text-slate-500 dark:text-slate-400">
                <div>Heap: {j.heap_used_pct}% <Bar value={j.heap_used_pct} /></div>
                <div>Threads: {j.thread_count}</div>
                <div>GC Pause: {j.gc_pause_ms}ms</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
