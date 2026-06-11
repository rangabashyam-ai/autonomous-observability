import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getIncidents, getIncident, getIncidentClickAnalysis, getIncidentChangeRequests } from '../api/client';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import type { Incident, IncidentClickAnalysis, ComponentMetrics } from '../types/intelligence';
import { PageHeader, TagList, severityClass, inputClass, btnPrimary } from '../components/ui';
import { ReportChat } from '../components/ReportChat';

// ---------------------------------------------------------------------------
// State badge
// ---------------------------------------------------------------------------

const STATE_CONFIG: Record<string, { label: string; cls: string }> = {
  Resolved: { label: 'Resolved', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800' },
  Closed: { label: 'Closed', cls: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600' },
  'In Progress': { label: 'In Progress', cls: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800' },
  Open: { label: 'Open', cls: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800' },
};

function StateBadge({ state }: { state?: string }) {
  const cfg = STATE_CONFIG[state ?? 'Open'] ?? STATE_CONFIG['Open'];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function isResolved(state?: string) {
  return state === 'Resolved' || state === 'Closed';
}

// ---------------------------------------------------------------------------
// Metric pill
// ---------------------------------------------------------------------------

const THRESHOLDS: Record<string, number> = {
  cpu: 80, memory: 85, error_rate: 5, latency: 500, storage: 90,
};

function MetricPill({ label, value, warn }: { label: string; value?: number; warn?: boolean }) {
  if (value == null) return null;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${warn
      ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800'
      : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
      }`}>
      {label}&nbsp;{value.toFixed(1)}
    </span>
  );
}

function ComponentMetricRow({ name, metrics, anomalies }: {
  name: string;
  metrics: ComponentMetrics;
  anomalies?: string[];
}) {
  const hasAnomaly = anomalies && anomalies.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1.5 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
      <span className={`text-[10px] font-medium w-40 truncate ${hasAnomaly ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
        {hasAnomaly ? '⚠ ' : ''}{name}
      </span>
      <MetricPill label="CPU" value={metrics.cpu} warn={(metrics.cpu ?? 0) > THRESHOLDS.cpu} />
      <MetricPill label="MEM" value={metrics.memory} warn={(metrics.memory ?? 0) > THRESHOLDS.memory} />
      <MetricPill label="LAT" value={metrics.latency} warn={(metrics.latency ?? 0) > THRESHOLDS.latency} />
      <MetricPill label="ERR%" value={metrics.error_rate} warn={(metrics.error_rate ?? 0) > THRESHOLDS.error_rate} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caution level badge
// ---------------------------------------------------------------------------

const CAUTION_CFG = {
  high: { label: 'HIGH ⚠', cls: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800' },
  medium: { label: 'MEDIUM ⚡', cls: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800' },
  low: { label: 'LOW ✓', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800' },
};

function CautionBadge({ level }: { level?: 'low' | 'medium' | 'high' }) {
  const cfg = CAUTION_CFG[level ?? 'low'];
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// LLM deep-analysis block
// ---------------------------------------------------------------------------

function LLMAnalysisBlock({ content, model, error }: {
  content?: string | null;
  model?: string;
  error?: string;
}) {
  if (error && !content) {
    return (
      <div className="mt-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
        AI analysis unavailable: {error}
      </div>
    );
  }
  if (!content) return null;

  const lines = content.split('\n');
  return (
    <div className="mt-2 p-4 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/20 dark:to-blue-950/20 border border-indigo-200 dark:border-indigo-800 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V17a1 1 0 0 1-2 0v-.07A8 8 0 0 1 4.07 9H5a1 1 0 0 1 0 2 6 6 0 0 0 6 6zM12 8a1 1 0 0 1 1 1v4a1 1 0 0 1-2 0V9a1 1 0 0 1 1-1zm0-3a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
        </svg>
        <span className="text-[10px] font-semibold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">AI Deep Analysis</span>
        {model && <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500 font-mono">{model}</span>}
      </div>
      <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed space-y-1">
        {lines.map((line, i) => {
          if (line.startsWith('**') && line.endsWith('**')) {
            return <p key={i} className="font-semibold text-slate-900 dark:text-white mt-2 first:mt-0">{line.replace(/\*\*/g, '')}</p>;
          }
          if (line.startsWith('- ') || line.startsWith('• ')) {
            return <p key={i} className="flex gap-1.5"><span className="text-indigo-400 shrink-0">•</span>{line.slice(2)}</p>;
          }
          if (line.trim() === '') return <div key={i} className="h-1" />;
          return <p key={i}>{line}</p>;
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build compact context string from incident analysis for the chat
// ---------------------------------------------------------------------------

function buildIncidentContext(
  incident: Incident,
  analysis: IncidentClickAnalysis,
  changeRequests?: { tickets: TicketFlow[] } | null,
): string {
  const lines: string[] = [
    `INCIDENT: ${incident.incident_id} — ${incident.title}`,
    `SEVERITY: ${incident.severity}  STATE: ${incident.state ?? 'Unknown'}`,
    `SERVICE: ${incident.service}  TEAM: ${incident.owner_team}`,
    `ENVIRONMENT: ${incident.environment} / ${incident.region}`,
    `DURATION: ${incident.duration_minutes ?? '?'} min`,
    `ALERTS: ${incident.alerts.join(', ') || '(none)'}`,
    `SYMPTOMS: ${incident.symptoms.join(', ') || '(none)'}`,
    `IMPACTED_COMPONENTS: ${incident.impacted_components.join(', ') || '(none)'}`,
  ];

  if (incident.root_cause) lines.push(`ROOT_CAUSE: ${incident.root_cause}`);
  if (incident.fix) lines.push(`APPLIED_FIX: ${incident.fix}`);
  if (incident.similar_incidents?.length)
    lines.push(`SIMILAR_INCIDENTS: ${incident.similar_incidents.join(', ')}`);

  if (analysis.type === 'fix_summary') {
    if (analysis.root_cause && analysis.root_cause !== incident.root_cause)
      lines.push(`ANALYSIS_ROOT_CAUSE: ${analysis.root_cause}`);
    if (analysis.applied_fix) lines.push(`ANALYSIS_APPLIED_FIX: ${analysis.applied_fix}`);
    if (analysis.resolution_notes) lines.push(`RESOLUTION_NOTES: ${analysis.resolution_notes}`);
    if (analysis.resolved_at) lines.push(`RESOLVED_AT: ${analysis.resolved_at}`);
  }

  const depPath = analysis.dependency_path ?? [];
  const anomalous = analysis.anomalous_components ?? {};
  const metrics = analysis.component_metrics ?? {};

  if (depPath.length > 0) {
    lines.push(`DEPENDENCY_PATH: ${depPath.join(' → ')}`);
    lines.push(`ORIGIN_COMPONENT: ${depPath[0]}`);
    lines.push(`ENDPOINT_COMPONENT: ${depPath[depPath.length - 1]}`);
  }

  const anomEntries = Object.entries(anomalous);
  if (anomEntries.length > 0) {
    lines.push('ANOMALOUS_COMPONENTS:');
    anomEntries.forEach(([comp, issues]) => {
      const m = metrics[comp];
      const mStr = m ? ` (cpu=${(m.cpu ?? 0).toFixed(1)}, err%=${(m.error_rate ?? 0).toFixed(1)})` : '';
      lines.push(`  ${comp}${mStr}: ${(issues as string[]).join(', ')}`);
    });
  } else if (depPath.length > 0) {
    lines.push('ANOMALOUS_COMPONENTS: none');
  }

  if (analysis.type === 'incident_rca' || analysis.type === 'cautionary_rca') {
    if (analysis.root_cause_candidates?.length) {
      const top = analysis.root_cause_candidates[0];
      lines.push(`TOP_ROOT_CAUSE: ${top.root_cause} (${top.confidence}%) → ${top.suggested_fixes?.[0] ?? '—'}`);
      if (analysis.root_cause_candidates.length > 1) {
        analysis.root_cause_candidates.slice(1).forEach((c, i) =>
          lines.push(`ALT_ROOT_CAUSE_${i + 2}: ${c.root_cause} (${c.confidence}%)`)
        );
      }
    }
    if (analysis.suggested_fix) lines.push(`SUGGESTED_FIX: ${analysis.suggested_fix}`);
    if (analysis.reasoning) lines.push(`REASONING: ${analysis.reasoning}`);
  }

  if (analysis.type === 'cautionary_rca') {
    if (analysis.caution_level) lines.push(`CAUTION_LEVEL: ${analysis.caution_level.toUpperCase()}`);
    if (analysis.applied_fix) lines.push(`APPLIED_FIX: ${analysis.applied_fix}`);
    if (analysis.post_fix_incidents?.length)
      lines.push(`POST_FIX_INCIDENTS: ${analysis.post_fix_incidents.slice(0, 3).map((i) => `${i.incident_id}(${i.root_cause})`).join(', ')}`);
    if (analysis.path_alerts?.length)
      lines.push(`OPEN_ALERTS_ON_PATH: ${analysis.path_alerts.slice(0, 3).map((a) => `${a.title} on ${a.entity_id}`).join('; ')}`);
    if (analysis.recommendations?.length)
      lines.push(`RECOMMENDATIONS: ${analysis.recommendations.join('; ')}`);
  }

  if (analysis.llm_analysis) lines.push(`AI_ANALYSIS: ${analysis.llm_analysis}`);

  const baseContext = analysis.chat_context ?? lines.join('\n');

  if (!changeRequests?.tickets?.length) return baseContext;

  const crLines: string[] = ['CHANGE_REQUESTS:'];
  changeRequests.tickets.slice(0, 3).forEach((ticket) => {
    const jira = ticket.jira_key ? ` (JIRA: ${ticket.jira_key})` : '';
    crLines.push(`  TICKET: ${ticket.incident_id}${jira} | ${ticket.service} | ${ticket.incident_state} | ROOT_CAUSE: ${ticket.root_cause} | FIX: ${ticket.fix}`);
    ticket.versions.forEach((v) => {
      const comment = v.comment.length > 120 ? v.comment.slice(0, 120) + '…' : v.comment;
      crLines.push(`    v${v.version} [${v.status}] ${v.timestamp.slice(0, 10)} by ${v.changed_by}: ${comment}`);
      if (v.fixes_applied.length > 0) {
        const fixes = v.fixes_applied.slice(0, 2).map((f) => (f.length > 80 ? f.slice(0, 80) + '…' : f));
        crLines.push(`      FIXES_APPLIED: ${fixes.join('; ')}`);
      }
      if (v.issues_arised.length > 0) {
        const issues = v.issues_arised.slice(0, 2).map((i) => (i.length > 80 ? i.slice(0, 80) + '…' : i));
        crLines.push(`      ISSUES_ARISED: ${issues.join('; ')}`);
      }
    });
  });

  return `${baseContext}\n${crLines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Analysis section (rendered inside the popup)
// ---------------------------------------------------------------------------

function AnalysisSection({ analysis, loading }: {
  analysis: IncidentClickAnalysis | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-xs text-slate-500 dark:text-slate-400">
        <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        Running analysis…
      </div>
    );
  }
  if (!analysis) return null;

  const depPath = analysis.dependency_path ?? [];
  const metrics = analysis.component_metrics ?? {};
  const anomalous = analysis.anomalous_components ?? {};

  // ── Closed / fix_summary ─────────────────────────────────────────────────
  if (analysis.type === 'fix_summary') {
    return (
      <div className="space-y-4 text-xs">
        <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">Fixes Applied</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg">
            <p className="text-slate-500 dark:text-slate-400 mb-1">Root Cause</p>
            <p className="font-semibold text-red-700 dark:text-red-400">{analysis.root_cause}</p>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg">
            <p className="text-slate-500 dark:text-slate-400 mb-1">Fix Applied</p>
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">{analysis.applied_fix}</p>
          </div>
        </div>

        <div className="flex gap-6">
          {analysis.duration_minutes != null && (
            <p><span className="text-slate-500 dark:text-slate-400">Duration: </span><span className="font-medium">{analysis.duration_minutes} min</span></p>
          )}
          {analysis.resolved_at && (
            <p><span className="text-slate-500 dark:text-slate-400">Resolved: </span><span className="font-medium">{new Date(analysis.resolved_at).toLocaleString()}</span></p>
          )}
        </div>

        {(analysis.impacted_components ?? []).length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Impacted Components</p>
            <div className="flex flex-wrap gap-1">
              {(analysis.impacted_components ?? []).map((c) => (
                <span key={c} className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-mono">{c}</span>
              ))}
            </div>
          </div>
        )}

        {analysis.resolution_notes && (
          <p className="italic text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            {analysis.resolution_notes}
          </p>
        )}

        {(analysis.change_records ?? []).length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Related Change Records</p>
            {(analysis.change_records ?? []).map((cr) => (
              <div key={cr.id} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
                <span className="font-mono text-blue-700 dark:text-blue-400">{cr.id}</span>
                <span className="text-slate-600 dark:text-slate-300 truncate mx-2">{cr.title}</span>
                <span className={`text-[10px] font-medium ${cr.risk === 'high' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {cr.risk} risk
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Resolved: cautionary RCA ─────────────────────────────────────────────
  if (analysis.type === 'cautionary_rca') {
    return (
      <div className="space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">Cautionary Analysis</p>
          <CautionBadge level={analysis.caution_level} />
        </div>

        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg">
          <p className="text-slate-500 dark:text-slate-400 mb-0.5">Applied Fix</p>
          <p className="font-semibold text-emerald-700 dark:text-emerald-400">{analysis.applied_fix}</p>
        </div>

        {depPath.length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Dependency Path</p>
            <div className="flex flex-wrap items-center gap-1">
              {depPath.map((node, i) => (
                <span key={node} className="flex items-center gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${anomalous[node]
                    ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800'
                    : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                    }`}>{node}</span>
                  {i < depPath.length - 1 && <span className="text-slate-400 text-[10px]">→</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {Object.keys(metrics).length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Component Metrics</p>
            <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
              {Object.entries(metrics).map(([comp, m]) => (
                <ComponentMetricRow key={comp} name={comp} metrics={m} anomalies={anomalous[comp]} />
              ))}
            </div>
          </div>
        )}

        {(analysis.post_fix_incidents ?? []).length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Post-Fix Incidents on Shared Components</p>
            <div className="space-y-1">
              {(analysis.post_fix_incidents ?? []).map((pf) => (
                <div key={pf.incident_id} className="flex items-center gap-3 py-1.5 px-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg">
                  <span className="font-mono text-blue-700 dark:text-blue-400 shrink-0">{pf.incident_id}</span>
                  <span className="text-slate-600 dark:text-slate-300 truncate">{pf.root_cause}</span>
                  <span className="text-slate-400 dark:text-slate-500 shrink-0">{pf.service}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(analysis.path_alerts ?? []).length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Open Alerts on Dependency Path</p>
            {(analysis.path_alerts ?? []).map((a, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <span className="text-amber-600 dark:text-amber-400 font-medium">{a.title}</span>
                <span className="text-slate-400 dark:text-slate-500 font-mono text-[10px]">{a.entity_id}</span>
              </div>
            ))}
          </div>
        )}

        <div className="p-3 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg">
          <p className="text-slate-500 dark:text-slate-400 mb-1.5">Reasoning</p>
          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{analysis.reasoning}</p>
        </div>

        {(analysis.recommendations ?? []).length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Recommendations</p>
            <ul className="space-y-1">
              {(analysis.recommendations ?? []).map((r, i) => (
                <li key={i} className="flex gap-2 text-slate-700 dark:text-slate-300">
                  <span className="text-blue-500 shrink-0 mt-0.5">•</span>{r}
                </li>
              ))}
            </ul>
          </div>
        )}

        <LLMAnalysisBlock content={analysis.llm_analysis} model={analysis.llm_model} error={analysis.llm_error} />
      </div>
    );
  }

  // ── Open / In Progress: live RCA ─────────────────────────────────────────
  if (analysis.type === 'incident_rca') {
    const candidates = analysis.root_cause_candidates ?? [];
    return (
      <div className="space-y-4 text-xs">
        <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">RCA Analysis</p>

        {depPath.length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Dependency Path</p>
            <div className="flex flex-wrap items-center gap-1">
              {depPath.map((node, i) => (
                <span key={node} className="flex items-center gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${anomalous[node]
                    ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800'
                    : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                    }`}>{node}</span>
                  {i < depPath.length - 1 && <span className="text-slate-400 text-[10px]">→</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {Object.keys(metrics).length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Component Metrics</p>
            <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
              {Object.entries(metrics).map(([comp, m]) => (
                <ComponentMetricRow key={comp} name={comp} metrics={m} anomalies={anomalous[comp]} />
              ))}
            </div>
          </div>
        )}

        {candidates.length > 0 && (
          <div>
            <p className="text-slate-500 dark:text-slate-400 mb-1.5">Root Cause Candidates</p>
            <div className="space-y-2">
              {candidates.map((c, i) => (
                <div key={i} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-800 dark:text-white">{c.root_cause}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${c.confidence >= 75 ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                      : c.confidence >= 50 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}>{c.confidence}% confidence</span>
                  </div>
                  {c.suggested_fixes?.[0] && (
                    <p className="text-emerald-700 dark:text-emerald-400">→ {c.suggested_fixes[0]}</p>
                  )}
                  <p className="text-slate-400 dark:text-slate-500 mt-0.5 text-[10px]">{c.matching_incident_count} matching historical incident(s)</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {analysis.suggested_fix && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg">
            <p className="text-slate-500 dark:text-slate-400 mb-0.5">Suggested Fix</p>
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">{analysis.suggested_fix}</p>
          </div>
        )}

        <div className="p-3 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg">
          <p className="text-slate-500 dark:text-slate-400 mb-1.5">Reasoning</p>
          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{analysis.reasoning}</p>
        </div>

        <LLMAnalysisBlock content={analysis.llm_analysis} model={analysis.llm_model} error={analysis.llm_error} />
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Version status badge
// ---------------------------------------------------------------------------

const VERSION_STATUS_CFG: Record<string, string> = {
  Open: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800',
  'In Progress': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800',
  'In Review': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
  Resolved: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
  Done: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600',
  Closed: 'bg-slate-200 text-slate-600 border-slate-300 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600',
};

type TicketVersion = {
  version: number;
  status: string;
  timestamp: string;
  changed_by: string;
  comment: string;
  priority: string;
  assignee: string | null;
  fixes_applied: string[];
  issues_arised: string[];
};

type TicketFlow = {
  incident_id: string;
  jira_key: string | null;
  jira_id: string | null;
  summary: string;
  incident_state: string;
  service: string;
  severity: string;
  root_cause: string;
  fix: string;
  impacted_components: string[];
  versions: TicketVersion[];
};

// ---------------------------------------------------------------------------
// Change Requests slide-over modal
// ---------------------------------------------------------------------------

function ChangeRequestsModal({ incidentId, onClose }: { incidentId: string; onClose: () => void }) {
  const [tickets, setTickets] = useState<TicketFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getIncidentChangeRequests(incidentId)
      .then((r) => setTickets(r.tickets))
      .catch((e) => setError(e?.message ?? 'Failed to load change requests'))
      .finally(() => setLoading(false));
  }, [incidentId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="fixed inset-0 z-[60] flex" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Slide-over panel — right side */}
      <div className="relative ml-auto z-10 w-full max-w-xl h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0 bg-gradient-to-r from-violet-50 to-blue-50 dark:from-violet-950/30 dark:to-blue-950/30">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white">Change Request History</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{incidentId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close change requests"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
              <span className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              Loading change requests…
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && tickets.length === 0 && (
            <div className="text-center py-10 text-xs text-slate-500 dark:text-slate-400">
              No change request history found for this incident.
            </div>
          )}

          {tickets.map((ticket, ti) => (
            <div key={`${ticket.incident_id}-${ti}`} className="space-y-3">
              {/* Ticket header */}
              <div className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {ticket.jira_key && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded">
                        {ticket.jira_key}
                      </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${severityClass(ticket.severity)}`}>
                      {ticket.severity}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{ticket.service}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">{ticket.summary}</p>
                  {isResolved(ticket.incident_state) && (
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                      <span>Root cause: <span className="text-red-600 dark:text-red-400 font-medium">{ticket.root_cause}</span></span>
                      <span>Fix: <span className="text-emerald-600 dark:text-emerald-400 font-medium">{ticket.fix}</span></span>
                    </div>
                  )}
                </div>
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${VERSION_STATUS_CFG[ticket.incident_state] ?? VERSION_STATUS_CFG['Done']
                  }`}>{ticket.incident_state}</span>
              </div>

              {/* Version timeline */}
              <div className="relative pl-5 space-y-0">
                {/* Vertical line */}
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-700" />

                {ticket.versions.map((v) => {
                  const key = `${ticket.incident_id}-${ti}-v${v.version}`;
                  const isOpen = expanded[key];
                  const statusCls = VERSION_STATUS_CFG[v.status] ?? VERSION_STATUS_CFG['Done'];
                  const hasFixes = v.fixes_applied.length > 0;
                  const hasIssues = v.issues_arised.length > 0;

                  return (
                    <div key={key} className="relative">
                      {/* Timeline dot */}
                      <div className="absolute -left-5 top-3 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-900 bg-slate-300 dark:bg-slate-600 flex items-center justify-center">
                        <div className={`w-1.5 h-1.5 rounded-full ${v.status === 'Resolved' || v.status === 'Done' || v.status === 'Closed'
                            ? 'bg-emerald-500'
                            : v.status === 'In Progress' || v.status === 'In Review'
                              ? 'bg-blue-500'
                              : 'bg-red-400'
                          }`} />
                      </div>

                      <div className="mb-3 ml-1">
                        {/* Version row (always visible, clickable) */}
                        <button
                          onClick={() => toggle(key)}
                          className="w-full text-left flex items-start gap-2 group"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">v{v.version}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusCls}`}>{v.status}</span>
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                {new Date(v.timestamp).toLocaleString()}
                              </span>
                              {v.assignee && (
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
                                  → {v.assignee}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-snug line-clamp-2">{v.comment}</p>
                          </div>
                          <span className="shrink-0 mt-1 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors">
                            <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </span>
                        </button>

                        {/* Expanded detail */}
                        {isOpen && (
                          <div className="mt-2 ml-0 space-y-2">
                            {hasFixes && (
                              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg">
                                <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 mb-1.5 flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Fixes Applied
                                </p>
                                <ul className="space-y-1">
                                  {v.fixes_applied.map((fix, fi) => (
                                    <li key={fi} className="flex gap-1.5 text-[11px] text-emerald-800 dark:text-emerald-300">
                                      <span className="shrink-0 mt-0.5 text-emerald-500">•</span>{fix}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {hasIssues && (
                              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg">
                                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-1.5 flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Issues Arised
                                </p>
                                <ul className="space-y-1">
                                  {v.issues_arised.map((iss, ii) => (
                                    <li key={ii} className="flex gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                                      <span className="shrink-0 mt-0.5 text-amber-500">⚠</span>{iss}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {!hasFixes && !hasIssues && (
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 italic pl-1">No fixes or issues recorded at this stage.</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Incident popup modal
// ---------------------------------------------------------------------------

function IncidentPopup({ incident, analysis, analysisLoading, analysisError, changeRequests, onClose }: {
  incident: Incident;
  analysis: IncidentClickAnalysis | null;
  analysisLoading: boolean;
  analysisError: string | null;
  changeRequests: { tickets: TicketFlow[] } | null;
  onClose: () => void;
}) {
  const [crOpen, setCrOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (crOpen) setCrOpen(false); else onClose(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, crOpen]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${severityClass(incident.severity)}`}>
                {incident.severity}
              </span>
              <StateBadge state={incident.state} />
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{incident.incident_id}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">{incident.title}</h2>
              <button
                id="btn-change-requests"
                onClick={(e) => { e.stopPropagation(); setCrOpen(true); }}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-violet-100 hover:bg-violet-200 dark:bg-violet-950/50 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 transition-all hover:shadow-sm active:scale-95"
                aria-label="View change request history"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Change Requests
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {/* Basic incident info */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <p><span className="text-slate-500 dark:text-slate-400">Service: </span><span className="text-slate-900 dark:text-white font-medium">{incident.service}</span></p>
            <p><span className="text-slate-500 dark:text-slate-400">Team: </span><span className="text-slate-900 dark:text-white font-medium">{incident.owner_team}</span></p>
            <p><span className="text-slate-500 dark:text-slate-400">Environment: </span><span className="text-slate-900 dark:text-white font-medium">{incident.environment} / {incident.region}</span></p>
            <p><span className="text-slate-500 dark:text-slate-400">Duration: </span><span className="text-slate-900 dark:text-white font-medium">{incident.duration_minutes} min</span></p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">Alerts</p>
              <TagList items={incident.alerts} color="red" />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">Symptoms</p>
              <TagList items={incident.symptoms} color="yellow" />
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">Impacted Components</p>
            <TagList items={incident.impacted_components} />
          </div>

          {incident.similar_incidents && incident.similar_incidents.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">Similar incidents: </span>
              {incident.similar_incidents.join(', ')}
            </p>
          )}

          <div className="border-t border-slate-200 dark:border-slate-700" />

          {/* Analysis error */}
          {analysisError && !analysisLoading && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
              Analysis failed: {analysisError}
            </div>
          )}

          <AnalysisSection analysis={analysis} loading={analysisLoading} />

          {/* Chat — only once analysis has loaded */}
          {!analysisLoading && analysis && (
            <ReportChat
              reportContext={buildIncidentContext(incident, analysis, changeRequests)}
              reportType={analysis.type}
              subtitle="Scoped to Incidents"
              entityName={`Incident ${incident.incident_id}`}
              suggestedQuestions={['Summarize this incident', 'What is the root cause?', 'How can I resolve this?']}
            />
          )}
        </div>
      </div>

      {/* Change Requests slide-over */}
      {crOpen && (
        <ChangeRequestsModal
          incidentId={incident.incident_id}
          onClose={() => setCrOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100;

export default function IncidentExplorer() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [analysis, setAnalysis] = useState<IncidentClickAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [changeRequests, setChangeRequests] = useState<{ tickets: TicketFlow[] } | null>(null);
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
      active: isActiveFilter || undefined,
    })
      .then((r) => {
        let displayIncidents = r.incidents;
        let displayTotal = r.total;

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

  // Handle ?id= deep-link: open popup for the given incident
  useEffect(() => {
    const id = searchParams.get('id');
<<<<<<< HEAD
    if (!id) return;

    getIncident(id)
      .then((inc) => {
        setSelected(inc);
        setAnalysisError(null);
        setAnalysisLoading(true);
        setChangeRequests(null);
        getIncidentClickAnalysis(inc.incident_id)
          .then(setAnalysis)
          .catch((err) => setAnalysisError(err?.message ?? 'Analysis failed'))
          .finally(() => setAnalysisLoading(false));
        getIncidentChangeRequests(inc.incident_id)
          .then((r) => setChangeRequests({ tickets: r.tickets }))
          .catch(() => setChangeRequests(null));
      })
      .catch((err) => setAnalysisError(err?.message ?? 'Failed to load incident'));
=======
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
>>>>>>> 71f249567e7ce494955f7773eb51e7c27d40fd13
  }, [searchParams]);

  const handleRowClick = (inc: Incident) => {
    setSelected(inc);
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisLoading(true);
    setChangeRequests(null);
    getIncidentClickAnalysis(inc.incident_id)
      .then(setAnalysis)
      .catch((err) => setAnalysisError(err?.message ?? 'Analysis failed'))
      .finally(() => setAnalysisLoading(false));
    getIncidentChangeRequests(inc.incident_id)
      .then((r) => setChangeRequests({ tickets: r.tickets }))
      .catch(() => setChangeRequests(null));
  };

  const handleClose = () => {
    setSelected(null);
    setAnalysis(null);
    setAnalysisError(null);
    setChangeRequests(null);
  };

  const hasMore = incidents.length < total;
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
      <PageHeader
        title="Incident Explorer"
        description="Browse incidents across all stages — open, in-progress, and resolved"
      />

      {/* Search / filter bar */}
      <div className="flex gap-4 mb-4">
        <input
          placeholder="Search incidents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearchClick()}
          className={`flex-1 ${inputClass}`}
        />
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputClass}>
          <option value="">All severities</option>
          {['P1', 'P2', 'P3', 'P4'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={handleSearchClick} className={btnPrimary}>Search</button>
      </div>

      {/* Results summary */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Showing <span className="font-semibold text-slate-900 dark:text-white">{incidents.length}</span> of{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{total}</span> incidents
            {totalPages > 1 && (
              <span className="ml-2 text-slate-400">(page {currentPage} of {totalPages})</span>
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

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="pb-2 pr-3">ID</th>
              <th className="pb-2 pr-3">Title</th>
              <th className="pb-2 pr-3">Service</th>
              <th className="pb-2 pr-3">Severity</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2 pr-3">Root Cause</th>
              <th className="pb-2">Fix</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500">Loading…</td></tr>
            ) : incidents.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500">No incidents found</td></tr>
            ) : incidents.map((inc) => (
              <tr
                key={inc.incident_id}
                onClick={() => handleRowClick(inc)}
                className={`border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${selected?.incident_id === inc.incident_id ? 'bg-blue-50 dark:bg-blue-950/30' : ''
                  }`}
              >
                <td className="py-2.5 pr-3 font-mono text-xs text-blue-700 dark:text-blue-400">{inc.incident_id}</td>
                <td className="py-2.5 pr-3 text-slate-900 dark:text-white max-w-[200px] truncate">{inc.title}</td>
                <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400 text-xs">{inc.service}</td>
                <td className="py-2.5 pr-3">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityClass(inc.severity)}`}>{inc.severity}</span>
                </td>
                <td className="py-2.5 pr-3"><StateBadge state={inc.state} /></td>
                <td className="py-2.5 pr-3 text-xs">
                  {isResolved(inc.state)
                    ? <span className="text-slate-700 dark:text-slate-300">{inc.root_cause}</span>
                    : <span className="text-slate-400 dark:text-slate-500 italic">Investigating…</span>}
                </td>
                <td className="py-2.5 text-xs">
                  {isResolved(inc.state)
                    ? <span className="text-slate-500 dark:text-slate-400">{inc.fix}</span>
                    : <span className="text-slate-400 dark:text-slate-500 italic">Pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom load-more / all-loaded footer */}
      {!loading && incidents.length > 0 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {incidents.length} of {total} incidents loaded
          </p>
          {hasMore ? (
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
          ) : total > PAGE_SIZE ? (
            <p className="text-xs text-green-600 dark:text-green-400 font-medium">✓ All incidents loaded</p>
          ) : null}
        </div>
      )}

      {/* Incident detail popup */}
      {selected && (
        <IncidentPopup
          incident={selected}
          analysis={analysis}
          analysisLoading={analysisLoading}
          analysisError={analysisError}
          changeRequests={changeRequests}
          onClose={handleClose}
        />
      )}
    </div>
  );
}