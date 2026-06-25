import { useEffect, useMemo, useState } from 'react';
import { PageHeader, inputClass } from '../components/ui';
import type { BankIncident, BankAlertItem } from './IncidentExplorer';
import { BankRCAPanel } from './IncidentExplorer';

// ---------------------------------------------------------------------------
// Shared constants (mirrored from IncidentExplorer)
// ---------------------------------------------------------------------------

const BANK_SEV_DOT: Record<string, string> = {
  High: 'bg-red-500', Medium: 'bg-orange-400', Low: 'bg-yellow-400', Informational: 'bg-blue-400',
};
const BANK_SEV_BADGE: Record<string, string> = {
  High:          'bg-red-50    text-red-700    border-red-200    dark:bg-red-950/30    dark:text-red-400    dark:border-red-800',
  Medium:        'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800',
  Low:           'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-500 dark:border-yellow-800',
  Informational: 'bg-blue-50   text-blue-700   border-blue-200   dark:bg-blue-950/30   dark:text-blue-400   dark:border-blue-800',
};
const ALERT_SEV_DOT: Record<string, string> = {
  Sev1: 'bg-red-500', Sev2: 'bg-orange-400', Sev3: 'bg-yellow-400',
};
const ALERT_SEV_BADGE: Record<string, string> = {
  Sev1: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/40 dark:border-red-800',
  Sev2: 'text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950/40 dark:border-orange-800',
  Sev3: 'text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/40 dark:border-yellow-800',
};
const SIGNAL_TYPE_BADGE: Record<string, string> = {
  Metric: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/40 dark:border-blue-800',
  Log:    'text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-950/40 dark:border-purple-800',
  Trace:  'text-cyan-700 bg-cyan-50 border-cyan-200 dark:text-cyan-400 dark:bg-cyan-950/40 dark:border-cyan-800',
};
const ALERT_CATEGORY_LABEL: Record<string, string> = {
  CPU: 'High CPU usage', MEM: 'High memory usage',
  DISK_IO: 'High disk I/O read usage', DISK_SP: 'High disk space usage',
  NET_LAT: 'Network latency', NET_PKT: 'Network packet loss',
  JVM_OOM: 'JVM Out of Memory (OOM) Heap', JVM_CPU: 'High JVM CPU load',
  APP_ERR: 'Low application success rate', APP_LAT: 'High application response latency',
  TRACE_SLOW: 'Slow distributed trace span',
};


function parseAlertCategory(rule: string): string {
  const catKey = (rule.split('-').pop() ?? '').toUpperCase();
  return ALERT_CATEGORY_LABEL[catKey] ?? catKey;
}

function parseAlertComponent(rule: string): string {
  const parts = rule.split('-');
  return parts.slice(1, -1).join('-') || parts[0];
}

// ---------------------------------------------------------------------------
// Incident list item (left sidebar)
// ---------------------------------------------------------------------------

function IncidentListItem({
  incident, selected, onClick,
}: {
  incident: BankIncident;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 transition-colors ${
        selected
          ? 'bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-500'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${BANK_SEV_DOT[incident.severity] ?? 'bg-slate-400'}`} />
        <span className={`text-[11px] font-mono font-semibold ${selected ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}>
          {incident.incidentId}
        </span>
        <span className="ml-auto text-[10px] font-mono text-slate-400 dark:text-slate-500 shrink-0">
          {incident.alerts.count}
        </span>
      </div>
      <p className="text-[10px] text-slate-600 dark:text-slate-400 line-clamp-2 leading-snug pl-4">
        {incident.title}
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline alerts table (shown inside the detail view)
// ---------------------------------------------------------------------------

function InlineAlertsTable({ alerts }: { alerts: BankAlertItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? alerts : alerts.slice(0, 10);

  const byCat = alerts.reduce<Record<string, number>>((acc, a) => {
    const cat = parseAlertCategory(a.alertRule);
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {/* Category summary chips */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(byCat)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, cnt]) => (
            <span key={cat} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium">
              {cat} &times; {cnt}
            </span>
          ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 w-24">Severity</th>
              <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 w-32">Component</th>
              <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">Description</th>
              <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 w-20">Signal</th>
              <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 w-40">Fired at</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a, i) => (
              <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${ALERT_SEV_DOT[a.severity] ?? 'bg-slate-400'}`} />
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${ALERT_SEV_BADGE[a.severity] ?? ''}`}>
                      {a.severity}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  {parseAlertComponent(a.alertRule)}
                </td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-200 max-w-sm truncate" title={a.description}>
                  {a.description}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${SIGNAL_TYPE_BADGE[a.signalType] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {a.signalType}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap text-[10px]">
                  {a.firedAt.replace('T', ' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {alerts.length > 10 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
        >
          {showAll ? `Show less` : `Show all ${alerts.length} alerts`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full incident detail view (right panel)
// ---------------------------------------------------------------------------

function IncidentDetailView({ incident }: { incident: BankIncident }) {
  return (
    <div className="flex flex-col gap-6 overflow-y-auto h-full px-6 py-5">

      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${BANK_SEV_BADGE[incident.severity] ?? ''}`}>
              {incident.severity}
            </span>
            <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{incident.incidentId}</span>
            <span className="px-1.5 py-0.5 rounded border text-[10px] font-medium bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600">
              {incident.status}
            </span>
          </div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white leading-snug">
            {incident.title}
          </h2>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 shrink-0">
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {incident.evidence.alertCount} alerts
          </span>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Created</p>
          <p className="font-mono text-slate-700 dark:text-slate-300">{incident.createdTime.replace('T', ' ')}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Last Update</p>
          <p className="font-mono text-slate-700 dark:text-slate-300">{incident.lastUpdateTime.replace('T', ' ')}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Owner</p>
          <p className="text-slate-700 dark:text-slate-300">{incident.owner.assignedTo ?? 'Unassigned'}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Query index</p>
          <p className="font-mono text-slate-700 dark:text-slate-300">{incident.queryIndex}</p>
        </div>
      </div>

      {/* Investigation window */}
      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">Investigation Window</p>
        <p className="font-mono text-slate-700 dark:text-slate-300">
          {incident.timeWindow.start.replace('T', ' ')} &mdash; {incident.timeWindow.end.replace('T', ' ')}
        </p>
      </div>

      {/* RCA Analysis */}
      <BankRCAPanel timeWindow={incident.timeWindow} />

      {/* Entities + Tactics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {incident.entities.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Entities</p>
            <div className="flex flex-wrap gap-1">
              {incident.entities.map((e) => (
                <span key={e} className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-mono">
                  {e}
                </span>
              ))}
            </div>
          </div>
        )}
        {incident.tactics.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Tactics</p>
            <div className="flex flex-wrap gap-1">
              {incident.tactics.map((t) => (
                <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-400">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Description</p>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
          {incident.description}
        </p>
      </div>

      {/* Linked alerts */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
          Linked Alerts <span className="ml-1 text-slate-500">({incident.alerts.count})</span>
        </p>
        <InlineAlertsTable alerts={incident.alerts.items} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RCADashboard() {
  const [incidents, setIncidents] = useState<BankIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BankIncident | null>(null);
  const [filterSev, setFilterSev] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/bank-incidents.json')
      .then((r) => r.json())
      .then((data: BankIncident[]) => {
        setIncidents(data);
        setSelected(data[0] ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return incidents.filter((i) => {
      if (filterSev !== 'All' && i.severity !== filterSev) return false;
      if (filterStatus !== 'All' && i.status !== filterStatus) return false;
      if (q && !i.title.toLowerCase().includes(q) && !i.incidentId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [incidents, filterSev, filterStatus, search]);

  // Auto-select first filtered incident when filters change
  useEffect(() => {
    if (filtered.length > 0 && selected && !filtered.find((i) => i.incidentId === selected.incidentId)) {
      setSelected(filtered[0]);
    }
  }, [filtered]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Bank RCA Incidents" description="Loading incidents…" />
        <p className="py-12 text-center text-slate-400 dark:text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <PageHeader
        title="Bank RCA Incidents"
        description="Select an incident to view full details and run root cause analysis"
      />

      {/* Master-detail layout */}
      <div className="flex flex-1 min-h-0 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">

        {/* Left: incident list */}
        <div className="w-72 shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50">
          {/* List filter bar */}
          <div className="p-2.5 border-b border-slate-200 dark:border-slate-700 space-y-2 shrink-0">
            <input
              placeholder="Search title or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`w-full text-xs ${inputClass}`}
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className={`w-full text-xs ${inputClass}`}
            >
              <option value="All">Status: All</option>
              <option value="New">New</option>
              <option value="Active">Active</option>
            </select>
            <select value={filterSev} onChange={(e) => setFilterSev(e.target.value)} className={`w-full text-xs ${inputClass}`}>
              <option value="All">Severity: All</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
              <option value="Informational">Informational</option>
            </select>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-right">
              {filtered.length} of {incidents.length}
            </p>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="p-4 text-xs text-slate-400 text-center">No incidents match filters</p>
            ) : (
              filtered.map((inc) => (
                <IncidentListItem
                  key={inc.incidentId}
                  incident={inc}
                  selected={selected?.incidentId === inc.incidentId}
                  onClick={() => setSelected(inc)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: detail view */}
        <div className="flex-1 overflow-hidden bg-white dark:bg-slate-800/30">
          {selected ? (
            <IncidentDetailView key={selected.incidentId} incident={selected} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 gap-3">
              <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">Select an incident to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
