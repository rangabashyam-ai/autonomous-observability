import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { getIncidents } from '../../api/client';
import type { Incident } from '../../types/intelligence';
import { TagList, severityClass } from '../ui';
import { cn } from '../../lib/cn';

interface EntityIncidentsPanelProps {
  entityName: string;
  active: boolean;
  selected: Incident | null;
  onSelect: (incident: Incident | null) => void;
}

function incidentMatchesEntity(incident: Incident, entityName: string): boolean {
  const needle = entityName.toLowerCase();
  if (incident.service?.toLowerCase().includes(needle)) return true;
  if (incident.impacted_components?.some((c) => c.toLowerCase().includes(needle))) return true;
  if (incident.impacted_services?.some((s) => s.toLowerCase().includes(needle))) return true;
  if (incident.alerts?.some((a) => a.toLowerCase().includes(needle))) return true;
  return false;
}

function stateBadgeClass(state?: string): string {
  if (state === 'Resolved' || state === 'Closed') {
    return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800';
  }
  if (state === 'In Progress') {
    return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800';
  }
  return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800';
}

export default function EntityIncidentsPanel({ entityName, active, selected, onSelect }: EntityIncidentsPanelProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    onSelect(null);
    setLoading(true);
    setError(null);

    Promise.all([
      getIncidents({ service: entityName, limit: 25 }),
      getIncidents({ search: entityName, limit: 25 }),
    ])
      .then(([byService, bySearch]) => {
        const merged = new Map<string, Incident>();
        [...byService.incidents, ...bySearch.incidents].forEach((inc) => {
          if (incidentMatchesEntity(inc, entityName)) {
            merged.set(inc.incident_id, inc);
          }
        });
        setIncidents(Array.from(merged.values()));
      })
      .catch((e) => setError(e?.message ?? 'Failed to load incidents'))
      .finally(() => setLoading(false));
  }, [active, entityName, onSelect]);

  if (!active) return null;

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to incidents
        </button>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', severityClass(selected.severity))}>
              {selected.severity}
            </span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', stateBadgeClass(selected.state))}>
              {selected.state ?? 'Open'}
            </span>
            <span className="text-xs font-mono text-text-secondary">{selected.incident_id}</span>
          </div>

          <h3 className="text-sm font-semibold text-text-primary leading-snug">{selected.title}</h3>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <p>
              <span className="text-text-secondary">Service: </span>
              <span className="font-medium text-text-primary">{selected.service}</span>
            </p>
            <p>
              <span className="text-text-secondary">Team: </span>
              <span className="font-medium text-text-primary">{selected.owner_team}</span>
            </p>
            <p>
              <span className="text-text-secondary">Started: </span>
              <span className="font-mono text-text-primary">{selected.start_time}</span>
            </p>
            <p>
              <span className="text-text-secondary">Duration: </span>
              <span className="font-mono text-text-primary">{selected.duration_minutes ?? '—'} min</span>
            </p>
          </div>

          {selected.details && (
            <div className="p-3 rounded-lg border border-border bg-card-hover">
              <p className="text-xs text-text-primary leading-relaxed">{selected.details}</p>
            </div>
          )}

          {selected.root_cause && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">Root cause</p>
              <p className="text-xs text-text-primary">{selected.root_cause}</p>
            </div>
          )}

          {selected.fix && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">Fix</p>
              <p className="text-xs text-text-primary">{selected.fix}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-2">Alerts</p>
              <TagList items={selected.alerts} color="red" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-2">Impacted components</p>
              <TagList items={selected.impacted_components} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        Incidents impacting <strong className="text-text-primary">{entityName}</strong>
      </p>

      {loading && <p className="text-xs text-text-secondary">Loading incidents…</p>}
      {error && <p className="text-xs text-warning">{error}</p>}

      {!loading && !error && incidents.length === 0 && (
        <p className="text-sm text-text-secondary">No incidents correlated with this entity.</p>
      )}

      {!loading && incidents.length > 0 && (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {incidents.map((inc) => (
            <button
              key={inc.incident_id}
              type="button"
              onClick={() => onSelect(inc)}
              className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-card-hover transition-colors"
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', severityClass(inc.severity))}>
                  {inc.severity}
                </span>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', stateBadgeClass(inc.state))}>
                  {inc.state ?? 'Open'}
                </span>
                <span className="text-[10px] font-mono text-text-secondary">{inc.incident_id}</span>
              </div>
              <p className="text-xs font-medium text-text-primary leading-snug line-clamp-2">
                {inc.details || inc.title}
              </p>
              <p className="text-[10px] text-text-secondary mt-1">{inc.start_time}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
