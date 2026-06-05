import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOverview } from '../api/client';
import type { Overview } from '../types/intelligence';
import { PageHeader, StatCard, severityClass } from '../components/ui';

export default function HomeOverview() {
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    getOverview().then(setData).catch(console.error);
  }, []);

  if (!data) return <p className="text-slate-500 dark:text-slate-400">Loading command center...</p>;

  const s = data.summary;

  return (
    <div>
      <PageHeader
        title="Operations Command Center"
        description="Unified view of incidents, alerts, knowledge graph intelligence, and early warnings"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Resolved Incidents" value={s.total_incidents} sub="Historical knowledge" />
        <StatCard label="Open Alerts" value={s.open_alerts} alert={s.open_alerts > 10} />
        <StatCard label="Graph Nodes" value={s.knowledge_graph_nodes} sub="RCA knowledge" />
        <StatCard label="Graph Edges" value={s.knowledge_graph_edges} sub="Relationships" />
        <StatCard label="Early Warnings" value={s.early_warnings} alert={s.early_warnings > 0} />
        <StatCard label="Active Investigations" value={s.active_investigations} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Recent Incidents</h3>
            <Link to="/incidents" className="text-xs text-blue-700 dark:text-blue-400 hover:underline">View all →</Link>
          </div>
          <div className="space-y-2">
            {data.recent_incidents.map((inc) => (
              <Link
                key={inc.incident_id}
                to={`/incidents?id=${inc.incident_id}`}
                className="block p-3 bg-slate-100 dark:bg-slate-900/50 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityClass(inc.severity)}`}>{inc.severity}</span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">{inc.incident_id}</span>
                </div>
                <p className="text-sm text-slate-900 dark:text-white">{inc.title}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">RC: {inc.root_cause}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Early Failure Warnings</h3>
            <Link to="/early-detection" className="text-xs text-blue-700 dark:text-blue-400 hover:underline">Details →</Link>
          </div>
          {data.early_detections.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No active patterns detected</p>
          ) : (
            data.early_detections.map((d) => (
              <div key={d.pattern_id} className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-500/30 rounded-lg mb-2">
                <div className="flex justify-between">
                  <span className="text-sm text-red-700 dark:text-red-300 font-medium">Probable incident forming</span>
                  <span className="text-sm font-bold text-red-600 dark:text-red-400">{d.confidence}%</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {d.expected_impacted_service} · ETA {d.estimated_time_to_incident_minutes} min
                </p>
              </div>
            ))
          )}

          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-4 mb-2">Top Root Causes</h3>
          {data.top_root_causes.map((rc) => (
            <div key={rc.root_cause} className="flex justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-700 dark:text-slate-300">{rc.root_cause}</span>
              <span className="text-slate-600 dark:text-slate-400 font-mono">{rc.count} incidents</span>
            </div>
          ))}
        </section>

        <section className="lg:col-span-2 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { to: '/rca', label: 'Run RCA Analysis', desc: 'Predict root causes' },
              { to: '/blast-radius', label: 'Blast Radius', desc: 'Impact prediction' },
              { to: '/investigation', label: 'Start Investigation', desc: 'AI workflow' },
              { to: '/copilot', label: 'Ask Copilot', desc: 'Natural language ops' },
            ].map((a) => (
              <Link key={a.to} to={a.to} className="p-3 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-blue-500/50 transition-colors">
                <p className="text-sm font-medium text-slate-900 dark:text-white">{a.label}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{a.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
