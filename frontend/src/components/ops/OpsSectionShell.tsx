import type { ReactNode } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Layers } from 'lucide-react';
import { Grid12 } from '../ui/layout-primitives';
import { MetricCard } from '../ui/metric-card';
import type { OpsDashboardSection } from '../../types/ops';

type Row = Record<string, unknown> & { id: string };

function healthOf(row: Row): string {
  return String(row.health ?? row.status ?? 'unknown').toLowerCase();
}

function summarizeRows(rows: Row[]) {
  let healthy = 0;
  let warning = 0;
  let critical = 0;
  for (const row of rows) {
    const h = healthOf(row);
    if (h === 'healthy' || h === 'success' || h === 'compliant' || h === 'ok') healthy += 1;
    else if (h === 'warning' || h === 'degraded') warning += 1;
    else if (h === 'critical' || h === 'breached' || h === 'rollback' || h === 'error') critical += 1;
  }
  return { total: rows.length, healthy, warning, critical };
}

const SECTION_DESCRIPTIONS: Record<string, string> = {
  business_services: 'End-to-end business capabilities and their operational health.',
  applications: 'Application processes, runtimes, and instance health across the fleet.',
  apis: 'API endpoints with throughput, latency, and error signals.',
  workers: 'Background workers and message consumers.',
  batch_jobs: 'Scheduled and batch workloads.',
  pipelines: 'ETL, streaming, and data movement pipelines.',
  ai_services: 'Inference and ML services with model performance.',
  transactions: 'Business journeys and completion rates.',
  traces: 'Distributed traces across service boundaries.',
  slo_sla: 'SLO targets, error budgets, and burn rates.',
  deployments: 'Release history and change impact.',
  security: 'Vulnerabilities and security posture by service.',
  cost: 'Spend, waste, and cost anomalies.',
  inventory: 'Unified platform inventory across environments.',
  compute: 'Hosts, VMs, and compute utilization.',
  containers: 'Kubernetes pods and container health.',
  cloud: 'Cloud accounts, regions, and spend.',
  virtualization: 'Hypervisors and virtual machine density.',
  networking: 'Load balancers, DNS, and network latency.',
  storage: 'Volumes, capacity, and IOPS.',
  runtime: 'JVM and runtime platform metrics.',
  databases: 'Database engines, connections, and query health.',
  messaging: 'Brokers, topics, lag, and dead-letter queues.',
  data_platforms: 'Spark, Airflow, Kafka, and analytics platforms.',
  serverless: 'Functions and serverless invocations.',
  capacity: 'Capacity forecasts and exhaustion risk.',
  platform_health: 'Overall platform health score and trends.',
  dependencies: 'Service topology and blast-radius relationships.',
  incidents: 'Correlated incidents and operational events.',
};

interface OpsSectionShellProps {
  section: OpsDashboardSection;
  rows: Row[];
  children: ReactNode;
  chartSeed?: number;
  noData?: boolean;
}

export default function OpsSectionShell({ section, rows, children, noData = false }: OpsSectionShellProps) {
  const stats = summarizeRows(rows);
  const description = section.description ?? SECTION_DESCRIPTIONS[section.id];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/8 via-card to-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <Layers className="h-4 w-4 text-primary" />
              </div>
              <h2 className="text-base font-semibold text-text-primary">{section.label}</h2>
            </div>
            {description && (
              <p className="text-sm text-text-secondary ml-10">{description}</p>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
            {!noData && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-card border border-border">
                <Activity className="h-3 w-3" /> {stats.total} entities
              </span>
            )}
          </div>
        </div>
      </div>

      {!noData && rows.length > 0 && (
        <Grid12>
          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <MetricCard label="Total" value={stats.total} sub={`In ${section.label.toLowerCase()}`} />
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <MetricCard
              label="Healthy"
              value={stats.healthy}
              variant="success"
              sub={stats.total ? `${Math.round((stats.healthy / stats.total) * 100)}% of fleet` : undefined}
            />
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <MetricCard label="Warning" value={stats.warning} variant={stats.warning > 0 ? 'warning' : 'default'} />
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <MetricCard label="Critical" value={stats.critical} variant={stats.critical > 0 ? 'critical' : 'default'} />
          </div>
        </Grid12>
      )}

      <div className={noData ? '' : 'grid grid-cols-1 xl:grid-cols-12 gap-5'}>
        <div className={noData ? '' : 'xl:col-span-9'}>{children}</div>
        {!noData && (
          <div className="xl:col-span-3 space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-2">
              <p className="text-xs font-semibold text-text-primary">Fleet Status</p>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span>{stats.healthy} healthy</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                <span>{stats.warning} need attention</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <AlertTriangle className="h-3.5 w-3.5 text-critical" />
                <span>{stats.critical} critical</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
