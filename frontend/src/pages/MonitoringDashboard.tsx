import { useEffect, useState } from 'react';
import { getMonitoringDashboard } from '../api/client';
import type { MonitoringDashboard } from '../types/api';
import ExecutiveView, { ServiceViewTable } from '../components/monitoring/ExecutiveView';
import TechnicalView from '../components/monitoring/TechnicalView';
import InfrastructureView from '../components/monitoring/InfrastructureView';

type Tab = 'executive' | 'service' | 'technical' | 'infrastructure';

const TABS: { id: Tab; label: string; description: string }[] = [
  { id: 'executive', label: 'Executive', description: 'Service availability, SLA, revenue & customer impact' },
  { id: 'service', label: 'Service', description: 'Health, latency, error rate, throughput' },
  { id: 'technical', label: 'Technical', description: 'Containers, APIs, databases, queues, JVM' },
  { id: 'infrastructure', label: 'Infrastructure', description: 'CPU, memory, storage, network, I/O' },
];

export default function MonitoringDashboardPage() {
  const [tab, setTab] = useState<Tab>('executive');
  const [data, setData] = useState<MonitoringDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMonitoringDashboard()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Monitoring Dashboard</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{activeTab.description}</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 pb-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t.id
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 border-b-transparent -mb-px'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-slate-500 dark:text-slate-400">Loading dashboard...</p>}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}

      {data && !loading && (
        <div className="p-4 bg-slate-100 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-xl">
          {tab === 'executive' && <ExecutiveView data={data.executive} />}
          {tab === 'service' && <ServiceViewTable services={data.service.services} />}
          {tab === 'technical' && <TechnicalView data={data.technical} />}
          {tab === 'infrastructure' && <InfrastructureView data={data.infrastructure} />}
        </div>
      )}
    </div>
  );
}
