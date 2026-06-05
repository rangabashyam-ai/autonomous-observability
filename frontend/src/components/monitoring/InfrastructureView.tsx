import type { MonitoringDashboard } from '../../types/api';
import { heatmapColor } from '../../utils/colors';
import { ResourceHeatmap } from '../ui/resource-heatmap';

interface Props {
  data: MonitoringDashboard['infrastructure'];
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  const color = heatmapColor(value, 'cpu');
  return (
    <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-center">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}%</p>
    </div>
  );
}

function getServerHealth(srv: { cpu: number; memory: number; storage: number; network: number; io: number }): 'healthy' | 'warning' | 'critical' {
  const maxVal = Math.max(srv.cpu, srv.memory, srv.storage, srv.network, srv.io);
  if (maxVal >= 80) return 'critical';
  if (maxVal >= 60) return 'warning';
  return 'healthy';
}

export default function InfrastructureView({ data }: Props) {
  const serverResources = data.servers.map((srv) => {
    return {
      id: srv.id,
      name: srv.id.replace('server-', '').toUpperCase(),
      type: 'server' as const,
      primaryMetric: {
        label: 'CPU',
        value: srv.cpu,
        unit: '%',
      },
      health: getServerHealth(srv),
      metrics: {
        cpu: srv.cpu,
        memory: srv.memory,
        storage: srv.storage,
        network: srv.network,
        io: srv.io,
        status: getServerHealth(srv),
        last_updated: new Date().toISOString(),
      },
    };
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard label="Avg CPU" value={data.summary.avg_cpu} />
        <SummaryCard label="Avg Memory" value={data.summary.avg_memory} />
        <SummaryCard label="Avg Storage" value={data.summary.avg_storage} />
        <SummaryCard label="Avg Network" value={data.summary.avg_network} />
        <SummaryCard label="Avg I/O" value={data.summary.avg_io} />
      </div>

      <ResourceHeatmap
        title="Server Infrastructure Heatmap"
        resources={serverResources}
        columns={5}
      />
    </div>
  );
}
