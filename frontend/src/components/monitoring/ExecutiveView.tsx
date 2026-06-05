import { healthBadgeClass, formatNumber } from '../../utils/colors';
import type { ExecutiveMetrics, ServiceMetric } from '../../types/api';

interface Props {
  data: ExecutiveMetrics;
}

function MetricCard({
  label,
  value,
  unit,
  status,
}: {
  label: string;
  value: string | number;
  unit?: string;
  status?: 'good' | 'warn' | 'bad';
}) {
  const statusColor =
    status === 'good' ? 'text-green-600 dark:text-emerald-600 dark:text-green-400' : status === 'warn' ? 'text-yellow-600 dark:text-yellow-400' : status === 'bad' ? 'text-red-600 dark:text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white';

  return (
    <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${statusColor}`}>
        {value}
        {unit && <span className="text-sm font-normal text-slate-500 dark:text-slate-400 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

export default function ExecutiveView({ data }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Service Availability"
          value={data.service_availability}
          unit="%"
          status={data.service_availability >= 99.9 ? 'good' : data.service_availability >= 99 ? 'warn' : 'bad'}
        />
        <MetricCard
          label="Transaction Success Rate"
          value={data.transaction_success_rate}
          unit="%"
          status={data.transaction_success_rate >= 99 ? 'good' : 'warn'}
        />
        <MetricCard
          label="SLA Compliance"
          value={data.sla_compliance}
          unit="%"
          status={data.sla_compliance >= 98 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Active Incidents"
          value={data.active_incidents}
          status={data.active_incidents === 0 ? 'good' : data.active_incidents <= 2 ? 'warn' : 'bad'}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Revenue Impact"
          value={`$${formatNumber(data.revenue_impact_usd, 0)}`}
          status={data.revenue_impact_usd < 1000 ? 'good' : 'bad'}
        />
        <MetricCard
          label="Customer Impact"
          value={formatNumber(data.customer_impact_count, 0)}
          unit="customers"
          status={data.customer_impact_count < 50 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Services at Risk"
          value={data.services_at_risk}
          status={data.services_at_risk === 0 ? 'good' : 'bad'}
        />
      </div>
    </div>
  );
}

export function ServiceViewTable({ services }: { services: ServiceMetric[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="pb-3 pr-4">Service</th>
            <th className="pb-3 pr-4">Health</th>
            <th className="pb-3 pr-4">Latency P99</th>
            <th className="pb-3 pr-4">Error Rate</th>
            <th className="pb-3 pr-4">Throughput</th>
            <th className="pb-3 pr-4">Volume</th>
            <th className="pb-3">Availability</th>
          </tr>
        </thead>
        <tbody>
          {services.map((svc) => (
            <tr key={svc.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-100 dark:bg-slate-800/30">
              <td className="py-3 pr-4 font-medium text-slate-900 dark:text-white">{svc.name}</td>
              <td className="py-3 pr-4">
                <span className={`text-xs px-2 py-0.5 rounded border ${healthBadgeClass(svc.health)}`}>
                  {svc.health}
                </span>
              </td>
              <td className="py-3 pr-4 font-mono text-slate-700 dark:text-slate-300">{svc.latency_p99_ms} ms</td>
              <td className="py-3 pr-4 font-mono text-slate-700 dark:text-slate-300">{svc.error_rate}%</td>
              <td className="py-3 pr-4 font-mono text-slate-700 dark:text-slate-300">{formatNumber(svc.throughput_rps, 0)} rps</td>
              <td className="py-3 pr-4 font-mono text-slate-700 dark:text-slate-300">{formatNumber(svc.transaction_volume, 0)}</td>
              <td className="py-3 font-mono text-slate-700 dark:text-slate-300">{svc.availability}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
