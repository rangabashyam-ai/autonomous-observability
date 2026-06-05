import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getIncidents, getIncident } from '../api/client';
import type { Incident } from '../types/intelligence';
import { PageHeader, TagList, severityClass, inputClass, btnPrimary } from '../components/ui';

export default function IncidentExplorer() {
  const [searchParams] = useSearchParams();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getIncidents({ limit: 50, search: search || undefined, severity: severity || undefined })
      .then((r) => { setIncidents(r.incidents); setTotal(r.total); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [severity]);

  useEffect(() => {
    const id = searchParams.get('id');
    if (id) getIncident(id).then(setSelected).catch(console.error);
  }, [searchParams]);

  return (
    <div>
      <PageHeader title="Incident Explorer" description="Browse 500+ resolved incidents with full RCA context" />

      <div className="flex gap-4 mb-4">
        <input
          placeholder="Search incidents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          className={`flex-1 ${inputClass}`}
        />
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className={inputClass}
        >
          <option value="">All severities</option>
          {['P1', 'P2', 'P3', 'P4'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={load} className={btnPrimary}>Search</button>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">{total} incidents found</p>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 pr-3">ID</th>
                <th className="pb-2 pr-3">Title</th>
                <th className="pb-2 pr-3">Service</th>
                <th className="pb-2 pr-3">Severity</th>
                <th className="pb-2 pr-3">Root Cause</th>
                <th className="pb-2">Fix</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-500">Loading...</td></tr>
              ) : incidents.map((inc) => (
                <tr
                  key={inc.incident_id}
                  onClick={() => setSelected(inc)}
                  className={`border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 ${selected?.incident_id === inc.incident_id ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                >
                  <td className="py-2.5 pr-3 font-mono text-xs text-blue-700 dark:text-blue-400">{inc.incident_id}</td>
                  <td className="py-2.5 pr-3 text-slate-900 dark:text-white max-w-[200px] truncate">{inc.title}</td>
                  <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400 text-xs">{inc.service}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityClass(inc.severity)}`}>{inc.severity}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-300 text-xs">{inc.root_cause}</td>
                  <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs">{inc.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4 h-fit sticky top-4">
            <div>
              <span className={`text-xs px-2 py-0.5 rounded border ${severityClass(selected.severity)}`}>{selected.severity}</span>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-2">{selected.title}</h3>
              <p className="text-xs text-slate-500 font-mono">{selected.incident_id}</p>
            </div>
            <div className="text-xs space-y-2">
              <p><span className="text-slate-600 dark:text-slate-400">Service:</span> <span className="text-slate-900 dark:text-white">{selected.service}</span></p>
              <p><span className="text-slate-600 dark:text-slate-400">Environment:</span> <span className="text-slate-900 dark:text-white">{selected.environment} / {selected.region}</span></p>
              <p><span className="text-slate-600 dark:text-slate-400">Team:</span> <span className="text-slate-900 dark:text-white">{selected.owner_team}</span></p>
              <p><span className="text-slate-600 dark:text-slate-400">Duration:</span> <span className="text-slate-900 dark:text-white">{selected.duration_minutes} min</span></p>
            </div>
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Alerts</p>
              <TagList items={selected.alerts} color="red" />
            </div>
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Symptoms</p>
              <TagList items={selected.symptoms} color="yellow" />
            </div>
            <div className="p-3 bg-slate-100 dark:bg-slate-900/50 rounded-lg text-xs">
              <p className="text-slate-600 dark:text-slate-400">Root Cause</p>
              <p className="text-red-700 dark:text-red-300 font-medium mt-1">{selected.root_cause}</p>
              <p className="text-slate-600 dark:text-slate-400 mt-2">Fix</p>
              <p className="text-emerald-700 dark:text-green-300 font-medium mt-1">{selected.fix}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Impacted Components</p>
              <TagList items={selected.impacted_components} />
            </div>
            {selected.similar_incidents && selected.similar_incidents.length > 0 && (
              <div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Similar Incidents</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{selected.similar_incidents.join(', ')}</p>
              </div>
            )}
            {selected.resolution_notes && (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">{selected.resolution_notes}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
