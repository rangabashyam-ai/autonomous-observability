import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getIncidents, getIncident } from '../api/client';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import type { Incident } from '../types/intelligence';
import { PageHeader, TagList, severityClass, inputClass, btnPrimary } from '../components/ui';

const PAGE_SIZE = 100;

export default function IncidentExplorer() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const isActiveFilter = searchParams.get('active') === 'true';

  const handleSearchClick = () => {
    if (search.trim()) {
      if (search.trim().toUpperCase().startsWith('INC-')) {
        navigate(`/incidents?id=${encodeURIComponent(search.trim().toUpperCase())}`);
      } else {
        navigate(`/incidents?search=${encodeURIComponent(search.trim())}`);
      }
    } else {
      navigate('/incidents');
    }
  };

  const load = (resetOffset = true) => {
    const newOffset = resetOffset ? 0 : offset;
    if (resetOffset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    const idParam = searchParams.get('id');
    const searchParamVal = searchParams.get('search');
    const activeSearch = idParam || searchParamVal || search;

    getIncidents({
      limit: PAGE_SIZE,
      offset: newOffset,
      search: activeSearch || undefined,
      severity: severity || undefined,
    })
      .then((r) => {
        let displayIncidents = r.incidents;
        let displayTotal = r.total;

        if (isActiveFilter) {
          displayIncidents = r.incidents.slice(0, 2);
          displayTotal = 2;
        }

        if (resetOffset) {
          setIncidents(displayIncidents);
          setOffset(PAGE_SIZE);
        } else {
          setIncidents((prev) => [...prev, ...displayIncidents]);
          setOffset(newOffset + PAGE_SIZE);
        }
        setTotal(displayTotal);
      })
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  };

  useEffect(() => { load(true); }, [severity, searchParams]);

  useEffect(() => {
    const id = searchParams.get('id');
    const q = searchParams.get('search');
    if (id) {
      setSearch(id);
      getIncident(id).then(setSelected).catch(console.error);
    } else if (q) {
      setSearch(q);
      setSelected(null);
    } else {
      setSearch('');
      setSelected(null);
    }
  }, [searchParams]);

  const hasMore = isActiveFilter ? false : incidents.length < total;
  const currentPage = Math.ceil(incidents.length / PAGE_SIZE);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const copilotContext = useMemo(() => {
    if (!selected) return null;
    return {
      pageType: 'incident' as const,
      selectedEntity: selected.incident_id,
      entityData: {
        incident_id: selected.incident_id,
        title: selected.title,
        severity: selected.severity,
        service: selected.service,
        root_cause: selected.root_cause,
        fix: selected.fix,
        alerts: selected.alerts,
        symptoms: selected.symptoms,
        resolution: selected.resolution_notes,
        duration_minutes: selected.duration_minutes,
        impacted_components: selected.impacted_components,
      },
      relatedAlerts: selected.alerts,
      relatedIncidents: [selected],
    };
  }, [selected]);

  useRegisterCopilotContext(copilotContext);

  return (
    <div>
      <PageHeader title="Incident Explorer" description="Browse 500+ resolved incidents with full RCA context" />

      <div className="flex gap-4 mb-4">
        <input
          placeholder="Search incidents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearchClick()}
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
        <button onClick={handleSearchClick} className={btnPrimary}>Search</button>
      </div>

      {/* Results summary with pagination info */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Showing <span className="font-semibold text-slate-900 dark:text-white">{incidents.length}</span> of{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{total}</span> incidents
            {totalPages > 1 && (
              <span className="ml-2 text-slate-400">
                (page {currentPage} of {totalPages})
              </span>
            )}
          </p>
          {isActiveFilter && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 text-[10px] font-semibold font-mono">
                Filtered to Active
              </span>
              <button
                onClick={() => navigate('/incidents')}
                className="text-[10px] text-blue-500 hover:underline font-semibold"
              >
                Show All
              </button>
            </div>
          )}
        </div>
        {hasMore && !loading && (
          <button
            onClick={() => load(false)}
            disabled={loadingMore}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors"
          >
            {loadingMore ? 'Loading...' : `Load next ${Math.min(PAGE_SIZE, total - incidents.length)}`}
          </button>
        )}
      </div>

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
              ) : incidents.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-500">No incidents found</td></tr>
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

          {/* Bottom pagination */}
          {!loading && incidents.length > 0 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {incidents.length} of {total} incidents loaded
              </p>
              {hasMore && (
                <button
                  onClick={() => load(false)}
                  disabled={loadingMore}
                  className="flex items-center gap-2 text-sm px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-900 dark:text-white font-medium rounded-lg transition-colors"
                >
                  {loadingMore ? (
                    <>
                      <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      Loading...
                    </>
                  ) : (
                    `Load More (${total - incidents.length} remaining)`
                  )}
                </button>
              )}
              {!hasMore && total > PAGE_SIZE && (
                <p className="text-xs text-green-600 dark:text-green-400 font-medium">✓ All incidents loaded</p>
              )}
            </div>
          )}
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
