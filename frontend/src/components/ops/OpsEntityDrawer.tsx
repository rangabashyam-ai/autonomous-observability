import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DrilldownDrawer from '../drilldown/DrilldownDrawer';
import { HealthBadge } from '../ui/data-table';
import { getOpsEntityTelemetry } from '../../api/client';
import type { Incident } from '../../types/intelligence';import {
  deriveEntityEvents,
  deriveEntityRunbook,
  filterDeploymentsForEntity,
  filterSecurityForEntity,
} from '../../utils/mockOpsData';
import EntityLogTerminal from './EntityLogTerminal';
import EntityIncidentsPanel from './EntityIncidentsPanel';
import { ENTITY_DRAWER_TABS, type EntityDrawerTab, type OpsEntity, type OpsEntityTelemetry } from '../../types/ops';
import { cn } from '../../lib/cn';

interface OpsEntityDrawerProps {
  entity: OpsEntity | null;
  onClose: () => void;
  relatedEntities?: OpsEntity[];
}

export default function OpsEntityDrawer({ entity, onClose, relatedEntities = [] }: OpsEntityDrawerProps) {
  const [tab, setTab] = useState<EntityDrawerTab>('overview');
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [telemetry, setTelemetry] = useState<OpsEntityTelemetry | null>(null);  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  useEffect(() => {
    if (!entity) return;
    setTab('overview');
    setSelectedIncident(null);
    setTelemetry(null);    setTelemetryError(null);
    setTelemetryLoading(true);
    getOpsEntityTelemetry(entity.id)
      .then(setTelemetry)
      .catch((e) => setTelemetryError(e?.message ?? 'Failed to load telemetry'))
      .finally(() => setTelemetryLoading(false));
  }, [entity?.id]);

  if (!entity) return null;

  const drawerType =
    entity.entity_type === 'api' ? 'api' : entity.entity_type.includes('incident') ? 'incident' : 'service';

  const parquetLogs = telemetry?.logs ?? [];
  const logs = parquetLogs;
  const parquetTraces = telemetry?.traces ?? [];
  const traces = parquetTraces;
  const deployments = filterDeploymentsForEntity(relatedEntities.length ? relatedEntities : [entity], entity);
  const security = filterSecurityForEntity(relatedEntities.length ? relatedEntities : [entity], entity);
  const events = deriveEntityEvents(entity);
  const runbook = deriveEntityRunbook(entity);
  const configEntries = Object.entries({ ...entity.metadata, platform: entity.platform, region: entity.region, owner: entity.owner }).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );

  const entityAI = selectedIncident
    ? {
        pageType: 'incident' as const,
        selectedEntity: selectedIncident.incident_id,
        entityData: {
          incident_id: selectedIncident.incident_id,
          title: selectedIncident.title,
          severity: selectedIncident.severity,
          state: selectedIncident.state,
          service: selectedIncident.service,
          root_cause: selectedIncident.root_cause,
          fix: selectedIncident.fix,
          impacted_components: selectedIncident.impacted_components,
          entity: entity.name,
        },
        suggestedQuestions: [
          `What is the root cause of ${selectedIncident.incident_id}?`,
          `How does ${selectedIncident.incident_id} impact ${entity.name}?`,
          `What remediation steps should we take for ${selectedIncident.incident_id}?`,
        ],
      }
    : {
        pageType: 'service' as const,
        selectedEntity: entity.name,
        entityData: { ...entity.metrics, entity_type: entity.entity_type, id: entity.id, metadata: entity.metadata },
        relatedMetrics: entity.metrics,
        suggestedQuestions: [
          `Summarize health and risks for ${entity.name}`,
          `What are the top metrics to watch for this ${entity.entity_type}?`,
          `Recommend remediation steps for ${entity.name}`,
        ],
      };
  return (
    <DrilldownDrawer
      isOpen
      onClose={onClose}
      title={entity.name}
      subtitle={`${entity.entity_type}${entity.platform ? ` · ${entity.platform}` : ''}`}
      type={drawerType as 'service' | 'api' | 'incident' | 'infrastructure'}
      health={entity.health === 'unknown' ? undefined : entity.health}
      aiAssistant={entityAI}
    >
      <div className="flex gap-1 flex-wrap mb-4 border-b border-border pb-3">
        {ENTITY_DRAWER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              if (t.id !== 'incidents') setSelectedIncident(null);
            }}
            className={cn(
              'px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wide transition-colors',
              tab === t.id ? 'bg-primary/15 text-primary' : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {telemetryLoading && tab !== 'logs' && (
        <p className="text-xs text-text-secondary mb-3">Loading telemetry…</p>
      )}
      {telemetryError && tab !== 'logs' && (
        <p className="text-xs text-warning mb-3">Telemetry unavailable: {telemetryError}</p>
      )}
      {!telemetryLoading && !telemetryError && logs.length === 0 && traces.length === 0 && tab === 'logs' && (
        <p className="text-xs text-text-secondary mb-3">Please Connect your Data Source</p>
      )}

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <HealthBadge health={entity.health} />
            {entity.owner && <span className="text-xs text-text-secondary">Owner: {entity.owner}</span>}
          </div>
          <p className="text-sm text-text-secondary">
            {(entity.metadata.description as string) ||
              `Enterprise ${entity.entity_type.replace(/_/g, ' ')} entity monitored across the operations platform.`}
          </p>
          {!!entity.metadata.business_service && (
            <p className="text-xs">
              <span className="text-text-secondary">Business Service: </span>
              <span className="font-medium text-text-primary">{String(entity.metadata.business_service)}</span>
            </p>
          )}
          {telemetry?.window && (
            <p className="text-[10px] font-mono text-text-secondary">
              Telemetry window: {new Date(telemetry.window.start).toLocaleString()} → {new Date(telemetry.window.end).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {tab === 'metrics' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(entity.metrics).map(([key, val]) => (
              <div key={key} className="p-3 rounded-lg border border-border bg-card-hover">
                <p className="text-[10px] uppercase text-text-secondary mb-1">{key.replace(/_/g, ' ')}</p>
                <p className="text-lg font-semibold font-mono text-text-primary">{String(val)}</p>
              </div>
            ))}
          </div>
          {telemetry && telemetry.metrics.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-card-hover text-text-secondary">
                    <th className="px-2 py-1.5 text-left">Time</th>
                    <th className="px-2 py-1.5 text-left">RPS</th>
                    <th className="px-2 py-1.5 text-left">Success %</th>
                    <th className="px-2 py-1.5 text-left">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.metrics.slice(-12).map((m, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1 font-mono">{new Date(m.timestamp).toLocaleTimeString()}</td>
                      <td className="px-2 py-1 font-mono">{m.request_rate}</td>
                      <td className="px-2 py-1 font-mono">{m.success_rate}%</td>
                      <td className="px-2 py-1 font-mono">{m.mean_response_time}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {telemetry && telemetry.host_metrics.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2">Host CPU</p>
              <div className="space-y-1">
                {telemetry.host_metrics.slice(-8).map((h, i) => (
                  <div key={i} className="flex justify-between text-xs font-mono">
                    <span>{new Date(h.timestamp).toLocaleTimeString()}</span>
                    <span>{h.host}</span>
                    <span>{h.cpu}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'dependencies' && (
        <div className="space-y-2">
          {entity.relationships.length === 0 ? (
            <p className="text-sm text-text-secondary">No dependencies mapped.</p>
          ) : (
            entity.relationships.map((relId) => {
              const rel = relatedEntities.find((r) => r.id === relId);
              return (
                <div key={relId} className="flex items-center justify-between p-2 rounded border border-border text-sm">
                  <span className="font-mono text-xs">{rel?.name ?? relId}</span>
                  <HealthBadge health={rel?.health ?? 'unknown'} />
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'topology' && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Topology for <strong>{entity.name}</strong> — {entity.relationships.length} connected entities in the catalog.
          </p>
          <Link to="/dependencies" className="text-sm text-primary hover:underline">
            Open Dependency Map →
          </Link>
        </div>
      )}

      {tab === 'logs' && (
        <EntityLogTerminal
          logs={logs}
          loading={telemetryLoading}
          entityName={entity.name}
          active={tab === 'logs'}
        />
      )}

      {tab === 'traces' && (
        <div>
          {traces.length === 0 ? (
            <p className="text-sm text-text-secondary">No traces matched for this entity in the current window.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-card-hover text-text-secondary">
                    <th className="px-2 py-1.5 text-left">Trace ID</th>
                    <th className="px-2 py-1.5 text-left">Service</th>
                    <th className="px-2 py-1.5 text-left">Host</th>
                    <th className="px-2 py-1.5 text-left">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {traces.map((t, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1 font-mono text-primary max-w-[140px] truncate">{t.trace_id}</td>
                      <td className="px-2 py-1 font-mono">{t.service}</td>
                      <td className="px-2 py-1 font-mono">{t.host}</td>
                      <td className="px-2 py-1 font-mono text-text-secondary">
                        {typeof t.timestamp === 'string' && t.timestamp.includes('T')
                          ? new Date(t.timestamp).toLocaleTimeString()
                          : t.timestamp}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'events' && (
        <div className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-text-secondary">No events available. Connect a data source to populate event history.</p>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="p-3 rounded-lg border border-border bg-card-hover">
                <div className="flex justify-between text-[10px] text-text-secondary mb-1">
                  <span className="font-semibold uppercase">{ev.type}</span>
                  <span>{ev.time}</span>
                </div>
                <p className="text-sm text-text-primary">{ev.message}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'incidents' && (
        <EntityIncidentsPanel
          entityName={entity.name}
          active={tab === 'incidents'}
          selected={selectedIncident}
          onSelect={setSelectedIncident}
        />
      )}

      {tab === 'deployments' && (
        <div className="space-y-2">
          {deployments.length === 0 ? (
            <p className="text-sm text-text-secondary">No recent deployments recorded for this entity.</p>
          ) : (
            deployments.map((d) => (
              <div key={d.id} className="p-3 rounded-lg border border-border">
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-mono font-semibold">{d.version}</span>
                  <span className={d.status === 'rollback' ? 'text-critical' : 'text-success'}>{d.status}</span>
                </div>
                <p className="text-[10px] text-text-secondary">{d.timestamp} · {d.deployedBy}</p>
                <p className="text-xs text-text-primary mt-1">{d.changeImpact}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'configuration' && (
        <div className="space-y-2">
          {configEntries.length === 0 ? (
            <p className="text-sm text-text-secondary">No configuration metadata available.</p>
          ) : (
            configEntries.map(([key, val]) => (
              <div key={key} className="flex justify-between gap-4 p-2 rounded border border-border text-xs">
                <span className="text-text-secondary">{key.replace(/_/g, ' ')}</span>
                <span className="font-mono text-text-primary text-right break-all">{String(val)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-2">
          {security.length === 0 ? (
            <p className="text-sm text-text-secondary">No open security findings for this entity.</p>
          ) : (
            security.map((s) => (
              <div key={s.id} className="p-3 rounded-lg border border-border">
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-mono font-semibold">{s.cve}</span>
                  <span className="text-critical uppercase">{s.severity}</span>
                </div>
                <p className="text-xs text-text-primary">{s.description}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'runbook' && (
        runbook.length === 0 ? (
          <p className="text-sm text-text-secondary">No runbook steps available. Connect a data source to populate runbooks.</p>
        ) : (
          <ol className="space-y-3">
            {runbook.map((step, idx) => (
              <li key={step.id} className="flex gap-3">
                <span className="h-6 w-6 shrink-0 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                  {idx + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-text-primary">{step.title}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        )
      )}

    </DrilldownDrawer>
  );
}
