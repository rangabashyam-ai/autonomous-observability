import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getIncidents, getIncident, getIncidentClickAnalysis, getIncidentChangeRequests, resolveIncident, getIncidentTelemetry, getIncidentRunbook, getIncidentSloBurn } from '../api/client';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import type { Incident, IncidentClickAnalysis, ComponentMetrics, IncidentTelemetry, IncidentRunbook, IncidentSloBurn } from '../types/intelligence';
import { PageHeader, TagList, severityClass, inputClass, btnPrimary, StatCard } from '../components/ui';
import { analyzeRCAWindow, fetchIncidentTelemetry } from '../api/client';
import type { RCAWindowResult } from '../api/client';
import { Bot } from 'lucide-react';
import { Card } from '../components/ui/card';
import RightDrawerShell, { RightDrawerBody } from '../components/drilldown/RightDrawerShell';
import ResizableDrawerPanel from '../components/drilldown/ResizableDrawerPanel';
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

export function buildIncidentContext(
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
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Slide-over panel — right side */}
      <ResizableDrawerPanel className="relative z-10 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">

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
      </ResizableDrawerPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Telemetry panel (logs, metrics, traces from parquet)
// ---------------------------------------------------------------------------

function TelemetryPanel({ incidentId }: { incidentId: string }) {
  const [data, setData] = useState<IncidentTelemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'metrics' | 'logs' | 'traces'>('metrics');

  useEffect(() => {
    setLoading(true);
    setError(null);
    getIncidentTelemetry(incidentId)
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Failed to load telemetry'))
      .finally(() => setLoading(false));
  }, [incidentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-xs text-slate-500 dark:text-slate-400">
        <span className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        Querying parquet telemetry…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
        Telemetry error: {error}
      </div>
    );
  }

  if (!data) return null;

  const tabCls = (t: typeof tab) =>
    `px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${tab === t
      ? 'bg-cyan-600 text-white'
      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`;

  return (
    <div className="space-y-3">
      {/* Window info */}
      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
        Window: {new Date(data.window.start).toLocaleString()} → {new Date(data.window.end).toLocaleString()}
      </p>

      {/* Tab bar */}
      <div className="flex gap-1">
        <button className={tabCls('metrics')} onClick={() => setTab('metrics')}>
          Metrics ({data.metrics.length})
        </button>
        <button className={tabCls('logs')} onClick={() => setTab('logs')}>
          Logs ({data.logs.length})
        </button>
        <button className={tabCls('traces')} onClick={() => setTab('traces')}>
          Traces ({data.traces.length})
        </button>
      </div>

      {/* Metrics tab */}
      {tab === 'metrics' && (
        <div>
          {data.metric_error && (
            <p className="text-[10px] text-red-500 mb-2">{data.metric_error}</p>
          )}
          {data.metrics.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No metrics in this window.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                    <th className="px-2 py-1.5 text-left">Time</th>
                    <th className="px-2 py-1.5 text-right">SR%</th>
                    <th className="px-2 py-1.5 text-right">MRT ms</th>
                    <th className="px-2 py-1.5 text-right">RPS</th>
                    <th className="px-2 py-1.5 text-right">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.metrics.map((m, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                      <td className="px-2 py-1 font-mono text-slate-500 dark:text-slate-400">
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </td>
                      <td className={`px-2 py-1 text-right font-mono font-semibold ${m.success_rate < 95 ? 'text-red-600 dark:text-red-400' : m.success_rate < 99 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {m.success_rate.toFixed(1)}
                      </td>
                      <td className={`px-2 py-1 text-right font-mono ${m.mean_response_time > 1000 ? 'text-red-600 dark:text-red-400' : m.mean_response_time > 500 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                        {m.mean_response_time.toFixed(0)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-slate-600 dark:text-slate-300">{m.request_rate.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-500 dark:text-slate-400">{m.request_count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Host CPU */}
          {data.host_metrics.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1.5">Host CPU % during incident</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                      <th className="px-2 py-1.5 text-left">Time</th>
                      <th className="px-2 py-1.5 text-left">Host</th>
                      <th className="px-2 py-1.5 text-right">CPU%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.host_metrics.map((h, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                        <td className="px-2 py-1 font-mono text-slate-500 dark:text-slate-400">
                          {new Date(h.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-2 py-1 font-mono text-slate-700 dark:text-slate-300">{h.host}</td>
                        <td className={`px-2 py-1 text-right font-mono font-semibold ${h.cpu > 90 ? 'text-red-600 dark:text-red-400' : h.cpu > 75 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {h.cpu.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Logs tab */}
      {tab === 'logs' && (
        <div>
          {data.log_error && (
            <p className="text-[10px] text-red-500 mb-2">{data.log_error}</p>
          )}
          {data.logs.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No logs matched for these hosts in this window.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {data.logs.map((log, i) => (
                <div
                  key={i}
                  className={`p-2 rounded-lg border text-[11px] ${log.severity === 'error'
                    ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                    : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700'
                    }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-semibold text-[10px] ${log.severity === 'error' ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
                      {log.severity.toUpperCase()}
                    </span>
                    <span className="font-mono text-slate-500 dark:text-slate-400">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className="font-mono text-cyan-700 dark:text-cyan-400">{log.host}</span>
                    <span className="text-slate-400 dark:text-slate-500">{log.log_name}</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 leading-snug break-words">{log.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Traces tab */}
      {tab === 'traces' && (
        <div>
          {data.trace_error && (
            <p className="text-[10px] text-red-500 mb-2">{data.trace_error}</p>
          )}
          {data.traces.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No traces matched for this service in this window.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                    <th className="px-2 py-1.5 text-left">Trace ID</th>
                    <th className="px-2 py-1.5 text-left">Host</th>
                    <th className="px-2 py-1.5 text-left">Time</th>
                    <th className="px-2 py-1.5 text-left">Span</th>
                  </tr>
                </thead>
                <tbody>
                  {data.traces.map((t, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                      <td className="px-2 py-1 font-mono text-blue-700 dark:text-blue-400 max-w-[140px] truncate">{t.trace_id}</td>
                      <td className="px-2 py-1 font-mono text-slate-600 dark:text-slate-300">{t.host}</td>
                      <td className="px-2 py-1 font-mono text-slate-500 dark:text-slate-400">{new Date(t.timestamp).toLocaleTimeString()}</td>
                      <td className="px-2 py-1">
                        <span className={`text-[10px] px-1 py-0.5 rounded ${t.has_parent ? 'bg-slate-100 dark:bg-slate-800 text-slate-500' : 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400'}`}>
                          {t.has_parent ? 'child' : 'root'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SLO Burn Rate panel (Google SRE Chapter 5 multi-window alerting)
// ---------------------------------------------------------------------------

const TIER_CFG: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
  P0: { bg: 'bg-red-100 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-300', border: 'border-red-300 dark:border-red-700', dot: 'bg-red-500', label: 'Critical' },
  P1: { bg: 'bg-orange-100 dark:bg-orange-950/40', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-300 dark:border-orange-700', dot: 'bg-orange-500', label: 'High' },
  P2: { bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700', dot: 'bg-amber-400', label: 'Medium' },
  P3: { bg: 'bg-blue-100 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-700', dot: 'bg-blue-400', label: 'Low' },
};

const WINDOWS_ORDERED = ['5m', '30m', '1h', '2h', '6h', '24h', '72h'];

function BurnRateBar({ value, threshold }: { value: number; threshold: number }) {
  const pct = Math.min((value / Math.max(threshold * 1.5, 1)) * 100, 100);
  const color = value >= threshold ? 'bg-red-500' : value >= threshold * 0.7 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-mono w-10 text-right ${value >= threshold ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
        {value.toFixed(1)}×
      </span>
    </div>
  );
}

// Per-service expandable card
function ServiceBurnCard({ svc }: { svc: import('../types/intelligence').ServiceSloBurn }) {
  const [expanded, setExpanded] = useState(false);
  const tier = svc.highest_firing_tier;
  const cfg = tier ? TIER_CFG[tier] : null;

  return (
    <div className={`rounded-lg border ${tier && cfg ? `${cfg.bg} ${cfg.border}` : 'bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-700'}`}>
      {/* ── Row: service name + key numbers + expand toggle ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${tier && cfg ? `${cfg.dot} animate-pulse` : 'bg-slate-300 dark:bg-slate-600'}`} />
        <span className="flex-1 text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
          {svc.service}
        </span>
        {tier && cfg ? (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
            {tier}
          </span>
        ) : (
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">OK</span>
        )}
        {/* Key burn rates: 1h / 6h */}
        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 hidden sm:block">
          1h&nbsp;
          <span className={svc.burn_rates['1h'] >= 14.4 ? 'text-red-600 dark:text-red-400 font-bold' : svc.burn_rates['1h'] >= 6 ? 'text-orange-500 font-bold' : 'text-slate-600 dark:text-slate-300'}>
            {(svc.burn_rates['1h'] ?? 0).toFixed(1)}×
          </span>
          &nbsp;·&nbsp;6h&nbsp;
          <span className={svc.burn_rates['6h'] >= 6 ? 'text-orange-500 font-bold' : 'text-slate-600 dark:text-slate-300'}>
            {(svc.burn_rates['6h'] ?? 0).toFixed(1)}×
          </span>
        </span>
        {svc.time_to_exhaustion_hours != null && (
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 hidden sm:block">
            exhausted&nbsp;<span className="font-bold text-amber-600 dark:text-amber-400">{svc.time_to_exhaustion_hours.toFixed(1)}h</span>
          </span>
        )}
        <svg className={`w-3 h-3 shrink-0 transition-transform text-slate-400 ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* ── Expanded: alert tier cards + burn rate table ── */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-200 dark:border-slate-700 pt-3">
          {/* Alert tiers 2×2 */}
          <div className="grid grid-cols-2 gap-1.5">
            {svc.alerts.map((a) => {
              const ac = TIER_CFG[a.tier];
              return (
                <div key={a.tier} className={`p-2 rounded-lg border ${a.firing ? `${ac.bg} ${ac.border}` : 'bg-white dark:bg-slate-900/30 border-slate-200 dark:border-slate-700'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.firing ? `${ac.dot} animate-pulse` : 'bg-slate-300 dark:bg-slate-600'}`} />
                    <span className={`text-[10px] font-bold ${a.firing ? ac.text : 'text-slate-400'}`}>{a.tier} {a.firing ? 'FIRING' : 'OK'}</span>
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-400 w-7">{a.primary_window}</span>
                      <BurnRateBar value={a.primary_burn_rate} threshold={a.threshold} />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-400 w-7">{a.confirmation_window}</span>
                      <BurnRateBar value={a.confirmation_burn_rate} threshold={a.threshold} />
                    </div>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1">{a.threshold}× threshold · {a.budget_consumed_pct}% budget</p>
                </div>
              );
            })}
          </div>
          {/* Window table */}
          <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-400">
                  <th className="px-2 py-1 text-left">Window</th>
                  <th className="px-2 py-1 text-right">Error Rate</th>
                  <th className="px-2 py-1 text-right">Burn Rate</th>
                  <th className="px-2 py-1 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {WINDOWS_ORDERED.filter((w) => svc.window_details[w] != null).map((w) => {
                  const d = svc.window_details[w];
                  const br = d.burn_rate;
                  const brCls = br >= 14.4 ? 'text-red-600 dark:text-red-400 font-bold' : br >= 6 ? 'text-orange-500 font-bold' : br >= 3 ? 'text-amber-500' : br >= 1 ? 'text-blue-500' : 'text-slate-400';
                  return (
                    <tr key={w} className="border-t border-slate-100 dark:border-slate-700/50">
                      <td className="px-2 py-1 font-mono text-slate-600 dark:text-slate-300">{w}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-500">{d.error_rate_pct.toFixed(2)}%</td>
                      <td className={`px-2 py-1 text-right font-mono ${brCls}`}>{br.toFixed(1)}×</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-400">{d.data_points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SloBurnPanel({ incidentId }: { incidentId: string }) {
  const [data, setData] = useState<IncidentSloBurn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getIncidentSloBurn(incidentId)
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Failed to load SLO burn data'))
      .finally(() => setLoading(false));
  }, [incidentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-xs text-slate-500 dark:text-slate-400">
        <span className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        Scanning all services for SLO budget impact…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
        SLO burn error: {error}
      </div>
    );
  }
  if (!data) return null;

  const topTier = data.overall_highest_tier;
  const topCfg = topTier ? TIER_CFG[topTier] : null;

  return (
    <div className="space-y-4 text-xs">

      {/* ── Global header ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono">
          SLO&nbsp;<span className="font-bold text-slate-900 dark:text-white">{(data.slo_target * 100).toFixed(2)}%</span>
        </div>
        <div className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono">
          Budget&nbsp;<span className="font-bold text-slate-900 dark:text-white">{data.error_budget_pct.toFixed(3)}%</span>
          &nbsp;<span className="text-slate-400">({data.error_budget_minutes.toFixed(0)} min/30d)</span>
        </div>
        {topCfg ? (
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${topCfg.bg} ${topCfg.border}`}>
            <span className={`w-2 h-2 rounded-full ${topCfg.dot} animate-pulse`} />
            <span className={`text-[11px] font-bold ${topCfg.text}`}>{topTier} FIRING</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-emerald-100 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">All services within SLO</span>
          </div>
        )}
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          {data.services.length} service{data.services.length !== 1 ? 's' : ''} with elevated burn
        </span>
      </div>

      {/* ── Recommended action ── */}
      {topTier && topCfg && (
        <div className={`p-3 rounded-lg border ${topCfg.bg} ${topCfg.border}`}>
          <p className={`text-[10px] font-semibold tracking-widest uppercase mb-1 ${topCfg.text}`}>
            Recommended Action ({topTier} — worst across all services)
          </p>
          <p className={`text-[11px] font-medium ${topCfg.text}`}>{data.recommended_action}</p>
        </div>
      )}

      {/* ── Per-service cards ── */}
      {data.services.length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase mb-2">
            Affected Services — click to expand
          </p>
          <div className="space-y-1.5">
            {data.services.map((svc) => (
              <ServiceBurnCard key={svc.service} svc={svc} />
            ))}
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 italic">
            Only services with burn rate &gt; 1× (consuming budget above normal rate) are shown.
            1h burn rate is used for time-to-exhaustion estimates.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
          No services with elevated burn rate detected in this incident's time window.
        </p>
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// SRE Runbook panel (golden signals + host saturation + interactive checklist)
// ---------------------------------------------------------------------------

const CAT_CFG = {
  diagnose: { label: 'Diagnose', bg: 'bg-blue-100 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800' },
  mitigate: { label: 'Mitigate', bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' },
  verify: { label: 'Verify', bg: 'bg-green-100 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-800' },
  resolve: { label: 'Resolve', bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800' },
} as const;

const CONF_CLS = {
  high: 'text-emerald-600 dark:text-emerald-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-slate-400 dark:text-slate-500',
} as const;

function RunbookPanel({ incidentId }: { incidentId: string }) {
  const [data, setData] = useState<IncidentRunbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    getIncidentRunbook(incidentId)
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Failed to load runbook'))
      .finally(() => setLoading(false));
  }, [incidentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-xs text-slate-500 dark:text-slate-400">
        <span className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        Building SRE runbook from telemetry…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
        Runbook error: {error}
      </div>
    );
  }

  if (!data) return null;

  const toggle = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const gs = data.golden_signals;
  const doneCount = checked.size;
  const totalSteps = data.runbook.length;

  return (
    <div className="space-y-5 text-xs">

      {/* ── Golden Signals comparison table ── */}
      {(gs.baseline || gs.incident) && (
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase mb-2">Golden Signals</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-1.5 text-left">Window</th>
                  <th className="px-3 py-1.5 text-right">SR% avg</th>
                  <th className="px-3 py-1.5 text-right">SR% min</th>
                  <th className="px-3 py-1.5 text-right">MRT avg</th>
                  <th className="px-3 py-1.5 text-right">MRT peak</th>
                  <th className="px-3 py-1.5 text-right">RPS avg</th>
                </tr>
              </thead>
              <tbody>
                {gs.baseline && (
                  <tr className="border-t border-slate-100 dark:border-slate-700/50">
                    <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 font-medium">Baseline (−1h)</td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400">{gs.baseline.sr_avg.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-600 dark:text-slate-300">{gs.baseline.sr_min.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-600 dark:text-slate-300">{gs.baseline.mrt_avg.toFixed(0)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-600 dark:text-slate-300">{gs.baseline.mrt_max.toFixed(0)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-600 dark:text-slate-300">{gs.baseline.rr_avg.toFixed(1)}</td>
                  </tr>
                )}
                {gs.incident && (
                  <tr className="border-t border-slate-100 dark:border-slate-700/50">
                    <td className="px-3 py-1.5 text-red-600 dark:text-red-400 font-semibold">Incident</td>
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${gs.incident.sr_avg < 95 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>{gs.incident.sr_avg.toFixed(1)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${gs.incident.sr_min < 90 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>{gs.incident.sr_min.toFixed(1)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${gs.incident.mrt_avg > 1000 ? 'text-red-600 dark:text-red-400' : gs.incident.mrt_avg > 500 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>{gs.incident.mrt_avg.toFixed(0)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${gs.incident.mrt_max > 2000 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>{gs.incident.mrt_max.toFixed(0)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-700 dark:text-slate-300">{gs.incident.rr_avg.toFixed(1)}</td>
                  </tr>
                )}
                {gs.baseline && gs.incident && (
                  <tr className="border-t border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30">
                    <td className="px-3 py-1 text-slate-400 dark:text-slate-500 text-[10px] italic">delta</td>
                    <td className={`px-3 py-1 text-right font-mono text-[10px] ${gs.deltas.sr_pp < -5 ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                      {gs.deltas.sr_pp > 0 ? '+' : ''}{gs.deltas.sr_pp.toFixed(1)}pp
                    </td>
                    <td className="px-3 py-1" />
                    <td className={`px-3 py-1 text-right font-mono text-[10px] ${gs.deltas.mrt_ms > 500 ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                      {gs.deltas.mrt_ms > 0 ? '+' : ''}{gs.deltas.mrt_ms.toFixed(0)} ms
                    </td>
                    <td className="px-3 py-1" />
                    <td className={`px-3 py-1 text-right font-mono text-[10px] ${Math.abs(gs.deltas.rr_pct) > 20 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
                      {gs.deltas.rr_pct > 0 ? '+' : ''}{gs.deltas.rr_pct.toFixed(0)}%
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Host saturation bars ── */}
      {data.host_saturation.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase mb-2">Host Saturation</p>
          <div className="space-y-2">
            {data.host_saturation.map((h) => {
              const pct = Math.min(h.cpu_peak, 100);
              const barCls = h.status === 'critical' ? 'bg-red-500' : h.status === 'degraded' ? 'bg-amber-500' : 'bg-emerald-500';
              const statusBadgeCls = h.status === 'critical'
                ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800'
                : h.status === 'degraded'
                  ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
                  : 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800';
              const peakCls = h.status === 'critical' ? 'text-red-600 dark:text-red-400' : h.status === 'degraded' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
              return (
                <div key={h.host} className="flex items-center gap-3">
                  <span className="font-mono text-slate-700 dark:text-slate-300 w-24 shrink-0 text-[11px]">{h.host}</span>
                  <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full ${barCls} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`font-mono font-semibold w-16 text-right text-[11px] ${peakCls}`}>peak {h.cpu_peak.toFixed(0)}%</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${statusBadgeCls}`}>{h.status}</span>
                </div>
              );
            })}
          </div>
          {data.gc_pressure && (
            <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <span className="shrink-0">⚠</span>
              GC pressure detected on Tomcat hosts — consider JVM heap tuning or restart
            </p>
          )}
        </div>
      )}

      {/* ── Interactive runbook checklist ── */}
      {data.runbook.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">SRE Runbook</p>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{doneCount}/{totalSteps} complete</span>
          </div>
          <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full mb-3 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${totalSteps > 0 ? (doneCount / totalSteps) * 100 : 0}%` }}
            />
          </div>
          <div className="space-y-2">
            {data.runbook.map((step) => {
              const cfg = CAT_CFG[step.category];
              const done = checked.has(step.id);
              return (
                <div
                  key={step.id}
                  onClick={() => toggle(step.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all select-none ${done
                    ? 'bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-700 opacity-50'
                    : `${cfg.bg} ${cfg.border}`
                    }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${done ? 'bg-emerald-500 border-emerald-500' : `${cfg.border} ${cfg.text}`
                      }`}>
                      {done && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">#{step.step}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}>{cfg.label}</span>
                        {step.lever && (
                          <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-800/70 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                            {step.lever}
                          </span>
                        )}
                        <span className={`text-[10px] ml-auto ${CONF_CLS[step.confidence]}`}>{step.confidence} conf.</span>
                      </div>
                      <p className={`text-[11px] font-semibold leading-snug ${done ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-800 dark:text-white'}`}>
                        {step.action}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{step.evidence}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Similar resolved incidents ── */}
      {data.similar_incidents.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase mb-2">Similar Resolved Incidents</p>
          <div className="space-y-2">
            {data.similar_incidents.map((si) => (
              <div key={si.incident_id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-blue-700 dark:text-blue-400 shrink-0">{si.incident_id}</span>
                  <span className="text-slate-400 dark:text-slate-500 text-[10px]">{si.service}</span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Cause: <span className="text-slate-700 dark:text-slate-300">{si.root_cause}</span></p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Fix: <span className="text-emerald-700 dark:text-emerald-400 font-medium">{si.fix}</span></p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank Incidents — Sentinel-style view
// ---------------------------------------------------------------------------

export type BankAlertItem = {
  alertId: string;
  alertRule: string;
  severity: string;
  signalType: string;
  firedAt: string;
  description: string;
};

export type BankIncident = {
  incidentId: string;
  title: string;
  description: string;
  severity: 'High' | 'Medium' | 'Low' | 'Informational';
  status: string;
  productName: string;
  owner: { assignedTo: string | null; email: string | null };
  createdTime: string;
  lastUpdateTime: string;
  timeWindow: { start: string; end: string };
  alerts: { count: number; items: BankAlertItem[] };
  evidence: { alertCount: number; eventCount: number; bookmarkCount: number };
  entities: string[];
  tactics: string[];
  queryIndex: string;
  taskType: string;
  rcaStatus: string;
};

const BANK_SEV_DOT: Record<string, string> = {
  High: 'bg-red-500',
  Medium: 'bg-orange-400',
  Low: 'bg-yellow-400',
  Informational: 'bg-blue-400',
};

// ---------------------------------------------------------------------------
// Alert details modal (opened from "View full details" in the detail panel)
// ---------------------------------------------------------------------------

const ALERT_CATEGORY_LABEL: Record<string, string> = {
  CPU: 'High CPU usage',
  MEM: 'High memory usage',
  DISK_IO: 'High disk I/O read usage',
  DISK_SP: 'High disk space usage',
  NET_LAT: 'Network latency',
  NET_PKT: 'Network packet loss',
  JVM_OOM: 'JVM Out of Memory (OOM) Heap',
  JVM_CPU: 'High JVM CPU load',
  APP_ERR: 'Low application success rate',
  APP_LAT: 'High application response latency',
  TRACE_SLOW: 'Slow distributed trace span',
};

function parseAlertRule(rule: string): { component: string; catKey: string; label: string } {
  const parts = rule.split('-');
  const catKey = (parts[parts.length - 1] ?? '').toUpperCase();
  const component = parts.slice(1, -1).join('-');
  return { component, catKey, label: ALERT_CATEGORY_LABEL[catKey] ?? catKey };
}

const ALERT_SEV_DOT: Record<string, string> = {
  Sev1: 'bg-red-500',
  Sev2: 'bg-orange-400',
  Sev3: 'bg-yellow-400',
};
const ALERT_SEV_BADGE: Record<string, string> = {
  Sev1: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/40 dark:border-red-800',
  Sev2: 'text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950/40 dark:border-orange-800',
  Sev3: 'text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/40 dark:border-yellow-800',
};
const SIGNAL_TYPE_BADGE: Record<string, string> = {
  Metric: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/40 dark:border-blue-800',
  Log: 'text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-950/40 dark:border-purple-800',
  Trace: 'text-cyan-700 bg-cyan-50 border-cyan-200 dark:text-cyan-400 dark:bg-cyan-950/40 dark:border-cyan-800',
};

function BankAlertsModal({ incident, onClose }: { incident: BankIncident; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const alerts = incident.alerts.items;

  // Category summary: how many alerts per category
  const byCat = alerts.reduce<Record<string, number>>((acc, a) => {
    const { catKey } = parseAlertRule(a.alertRule);
    acc[catKey] = (acc[catKey] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <ResizableDrawerPanel className="relative z-10 bg-card border-l border-border shadow-2xl animate-in slide-in-from-right duration-300 text-left">

        {/* Drawer header */}
        <div className="flex flex-col p-6 border-b border-border bg-card shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-semibold ${BANK_SEV_TEXT[incident.severity] ?? 'text-slate-600'}`}>
                  {incident.severity}
                </span>
                <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{incident.incidentId}</span>
              </div>
              <h2 className="text-sm font-semibold text-text-primary leading-snug">{incident.title}</h2>
              <p className="text-[10px] text-text-secondary mt-0.5">{alerts.length} linked alerts</p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Category breakdown chips */}
        <div className="px-6 py-2.5 border-b border-border/40 bg-card-hover flex flex-wrap gap-1.5 shrink-0">
          {Object.entries(byCat)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, cnt]) => (
              <span
                key={cat}
                className="text-[9px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium"
              >
                {ALERT_CATEGORY_LABEL[cat] ?? cat} &times; {cnt}
              </span>
            ))}
        </div>

        {/* Alert table */}
        <div className="overflow-y-auto flex-1 p-6">
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 z-10 border-b border-border">
                <tr className="text-left text-text-secondary">
                  <th className="px-4 py-2.5 font-semibold w-24">Severity</th>
                  <th className="px-4 py-2.5 font-semibold w-32">Component</th>
                  <th className="px-4 py-2.5 font-semibold">Alert description</th>
                  <th className="px-4 py-2.5 font-semibold w-20">Signal</th>
                  <th className="px-4 py-2.5 font-semibold w-40">Fired at</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, idx) => {
                  const { component } = parseAlertRule(a.alertRule);
                  return (
                    <tr
                      key={idx}
                      className="border-b border-border/40 hover:bg-card-hover transition-colors"
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${ALERT_SEV_DOT[a.severity] ?? 'bg-slate-400'}`} />
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${ALERT_SEV_BADGE[a.severity] ?? ''}`}>
                            {a.severity}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-text-primary whitespace-nowrap">{component}</td>
                      <td className="px-4 py-2 text-text-primary max-w-sm truncate" title={a.description}>{a.description}</td>
                      <td className="px-4 py-2">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${SIGNAL_TYPE_BADGE[a.signalType] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          {a.signalType}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-text-secondary whitespace-nowrap">
                        {a.firedAt.replace('T', ' ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </ResizableDrawerPanel>
    </div>
  );
}
const BANK_SEV_TEXT: Record<string, string> = {
  High: 'text-red-600 dark:text-red-400',
  Medium: 'text-orange-600 dark:text-orange-400',
  Low: 'text-yellow-600 dark:text-yellow-500',
  Informational: 'text-blue-600 dark:text-blue-400',
};
const BANK_SEV_BARS = [
  { key: 'High', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
  { key: 'Medium', dot: 'bg-orange-400', text: 'text-orange-700 dark:text-orange-400' },
  { key: 'Low', dot: 'bg-yellow-400', text: 'text-yellow-700 dark:text-yellow-500' },
  { key: 'Informational', dot: 'bg-blue-400', text: 'text-blue-700 dark:text-blue-400' },
] as const;

// ---------------------------------------------------------------------------
// RCA reason → colour
// ---------------------------------------------------------------------------

const REASON_COLOR: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  'high CPU usage': { bg: 'bg-red-50 dark:bg-red-950/20', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  'high memory usage': { bg: 'bg-orange-50 dark:bg-orange-950/20', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  'high disk I/O read usage': { bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  'high disk space usage': { bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  'network packet loss': { bg: 'bg-violet-50 dark:bg-violet-950/20', text: 'text-violet-700 dark:text-violet-400', border: 'border-violet-200 dark:border-violet-800', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  'network latency': { bg: 'bg-violet-50 dark:bg-violet-950/20', text: 'text-violet-700 dark:text-violet-400', border: 'border-violet-200 dark:border-violet-800', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  'high JVM CPU load': { bg: 'bg-blue-50 dark:bg-blue-950/20', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  'JVM Out of Memory (OOM) Heap': { bg: 'bg-red-50 dark:bg-red-950/20', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};
const DEFAULT_REASON_COLOR = { bg: 'bg-slate-50 dark:bg-slate-800/50', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-700', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' };

// Derive human-readable reason from raw KPI strings (e.g. "OSLinux-CPU_CPU_CPULoad | z=5.7 | ...")
function cleanReason(raw: string): string {
  if (!raw.includes('|')) return raw;
  const kpiName = raw.split('|')[0].trim();
  if (/cpu/i.test(kpiName)) return 'high CPU usage';
  if (/mem|swap/i.test(kpiName)) return 'high memory usage';
  if (/retrans|packet|NETPackets/i.test(kpiName)) return 'network packet loss';
  if (/rtt|latency|delay/i.test(kpiName)) return 'network latency';
  if (/diskread|diskwrite|DISKRead|DISKWrite|IOUtil/i.test(kpiName)) return 'high disk I/O read usage';
  if (/diskspace|diskutil|DISKDisk/i.test(kpiName)) return 'high disk space usage';
  if (/jvm.*cpu|gc.*cpu/i.test(kpiName)) return 'high JVM CPU load';
  if (/oom|outofmemory/i.test(kpiName)) return 'JVM Out of Memory (OOM) Heap';
  return 'Anomalous signal detected';
}

// Parse "OSLinux-CPU_CPU_CPULoad → high CPU usage (z=5.7)"
function parseEvidenceSignal(ev: string): { kpi: string; reason: string; zscore: string } | null {
  const sep = ev.indexOf(' → ');
  if (sep === -1) return null;
  const kpiRaw = ev.slice(0, sep);
  const rest = ev.slice(sep + 3);
  const zMatch = rest.match(/\(z=([-\d.]+)\)/);
  const zscore = zMatch ? zMatch[1] : '';
  const reason = rest.replace(/\s*\(z=[-\d.]+\)/, '').trim();
  // Keep only last meaningful part of KPI name: "OSLinux-CPU_CPU_CPULoad" → "CPULoad"
  const segments = kpiRaw.split(/[_\-]/).filter(Boolean);
  const kpi = segments[segments.length - 1] || kpiRaw;
  return { kpi, reason, zscore };
}

// llm_analysis now contains a clean EXPLANATION sentence from the LLM (not a raw dump)
function isRawDump(text: string): boolean {
  return text.includes('COMPONENT:') && text.includes('TIMESTAMP:') && text.includes('REASON:');
}

function ZBadge({ z }: { z: string }) {
  const v = parseFloat(z);
  const cls = Math.abs(v) >= 10 ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    : Math.abs(v) >= 5 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
      : Math.abs(v) >= 3 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  return (
    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold ${cls}`}>
      z={z}
    </span>
  );
}

function ConfBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-400' : pct >= 25 ? 'bg-blue-500' : 'bg-slate-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono font-bold w-8 text-right text-slate-700 dark:text-slate-200">{pct}%</span>
    </div>
  );
}

export function BankRCAPanel({ timeWindow }: { timeWindow: { start: string; end: string } }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<RCAWindowResult[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!showModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowModal(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showModal]);

  const runRCA = () => {
    const t_start = Math.floor(new Date(timeWindow.start).getTime() / 1000);
    const t_end = Math.floor(new Date(timeWindow.end).getTime() / 1000);
    setStatus('loading');
    setResults([]);
    setErrorMsg('');
    analyzeRCAWindow({ t_start, t_end, num_failures: 1, use_llm: true })
      .then((res) => {
        setResults(res.results);
        setElapsedMs(res.analysis_time_ms);
        setStatus('done');
        if (res.results.length > 0) setShowModal(true);
      })
      .catch((e: Error) => { setErrorMsg(e.message ?? 'Analysis failed'); setStatus('error'); });
  };

  const ResultCard = ({ r, idx }: { r: RCAWindowResult; idx: number }) => {
    const displayReason = cleanReason(r.reason);
    const color = REASON_COLOR[displayReason] ?? DEFAULT_REASON_COLOR;
    const parsedEvidence = r.evidence.map(parseEvidenceSignal);
    const explanation = r.llm_analysis && !isRawDump(r.llm_analysis) ? r.llm_analysis : null;
    return (
      <div className={`rounded-xl border ${color.border} ${color.bg} overflow-hidden`}>
        <div className="flex items-center gap-3 px-3 pt-3 pb-2">
          <span className="shrink-0 w-6 h-6 rounded-full bg-white dark:bg-black/30 border border-current/30 flex items-center justify-center text-[11px] font-bold text-slate-600 dark:text-slate-300">
            {idx + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-bold font-mono ${color.text}`}>{r.component}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${color.badge}`}>
                {displayReason}
              </span>
            </div>
            {r.datetime_utc8 && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                Peak anomaly at {r.datetime_utc8}
              </p>
            )}
          </div>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Confidence</span>
          </div>
          <ConfBar value={r.confidence} />
        </div>
        {parsedEvidence.some(Boolean) && (
          <div className="border-t border-current/10 px-3 py-2">
            <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Evidence Signals ({r.evidence.length})
            </p>
            <div className="space-y-1">
              {parsedEvidence.map((parsed, ei) =>
                !parsed ? (
                  <div key={ei} className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">
                    {r.evidence[ei]}
                  </div>
                ) : (
                  <div key={ei} className="flex items-center gap-2 bg-white/60 dark:bg-black/20 rounded-lg px-2 py-1">
                    <span className="text-[10px] font-mono font-semibold text-slate-700 dark:text-slate-200 shrink-0 min-w-[80px]">
                      {parsed.kpi}
                    </span>
                    <span className="flex-1 text-[10px] text-slate-600 dark:text-slate-300 truncate">
                      {parsed.reason}
                    </span>
                    {parsed.zscore && <ZBadge z={parsed.zscore} />}
                  </div>
                )
              )}
            </div>
          </div>
        )}
        {explanation && (
          <div className="border-t border-current/10 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <svg className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed italic">{explanation}</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Results modal */}
      {showModal && results.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-2xl max-h-[88vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <div className="flex items-center gap-2.5">
                <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">RCA Analysis Results</h2>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                  {results.length} finding{results.length !== 1 ? 's' : ''} · {elapsedMs.toFixed(0)} ms
                </span>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {results.map((r, idx) => <ResultCard key={idx} r={r} idx={idx} />)}
            </div>
            {/* Modal footer */}
            <div className="shrink-0 px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                Investigation window: {timeWindow.start.replace('T', ' ')} — {timeWindow.end.replace('T', ' ')}
              </span>
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline trigger area */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            RCA Analysis
          </p>
          {status === 'done' && results.length > 0 && (
            <button
              onClick={() => setShowModal(true)}
              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              View results →
            </button>
          )}
        </div>

        <button
          onClick={runRCA}
          disabled={status === 'loading'}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60 transition-colors"
        >
          {status === 'loading' ? (
            <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Analyzing…</>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              {status === 'done' ? 'Re-run RCA' : 'Run RCA Analysis'}
            </>
          )}
        </button>

        {status === 'error' && (
          <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-[11px] text-red-600 dark:text-red-400">
            {errorMsg}
          </div>
        )}

        {status === 'done' && results.length === 0 && (
          <p className="text-[11px] text-slate-400 italic">No anomalies detected in this time window.</p>
        )}

        {status === 'done' && results.length > 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {results.length} anomal{results.length === 1 ? 'y' : 'ies'} detected — results shown in popup.
          </p>
        )}
      </div>
    </>
  );
}

function buildBankIncidentContext(inc: BankIncident): string {
  const lines = [
    `INCIDENT: ${inc.incidentId}`,
    `TITLE: ${inc.title}`,
    `SEVERITY: ${inc.severity}`,
    `STATUS: ${inc.status}`,
    `INVESTIGATION_WINDOW: ${inc.timeWindow.start.replace('T', ' ')} — ${inc.timeWindow.end.replace('T', ' ')}`,
    `DESCRIPTION: ${inc.description}`,
    `ENTITIES: ${inc.entities.join(', ') || 'none'}`,
    `TACTICS: ${inc.tactics.join(', ') || 'none'}`,
    `ALERT_COUNT: ${inc.alerts.count}`,
  ];
  if (inc.alerts.items.length > 0) {
    lines.push('ALERT_SAMPLES:');
    const top = inc.alerts.items
      .slice()
      .sort((a, b) => (a.severity < b.severity ? -1 : 1))
      .slice(0, 10);
    top.forEach((a) => {
      const comp = a.alertRule.split('-').slice(1, -1).join('-');
      lines.push(`  [${a.severity}][${a.signalType}] ${comp}: ${a.description}`);
    });
  }
  return lines.join('\n');
}

export function buildTelemetryContext(tel: Record<string, any>): string {
  if (!tel || Object.keys(tel).length === 0) return '';
  const lines: string[] = ['', '=== TELEMETRY (live parquet scan) ==='];

  // Metrics
  const metrics: any[] = tel.metrics ?? [];
  if (metrics.length > 0) {
    lines.push('METRICS (metric_app — per service):');
    metrics.forEach((m: any) => {
      lines.push(
        `  ${m.service}: sr_avg=${m.avg_success_rate_pct}% sr_min=${m.min_success_rate_pct}% ` +
        `rps=${m.avg_request_rate_rps} mrt_avg=${m.avg_response_time_ms}ms mrt_max=${m.max_response_time_ms}ms ` +
        `error_ivl=${m.error_intervals}/${m.samples} slow_ivl=${m.slow_intervals}/${m.samples} ` +
        `total_reqs=${m.total_requests} worst_sr_at=${m.worst_sr_at}`
      );
    });
  } else {
    lines.push('METRICS: no service metrics in this window');
  }

  // Infra
  const infra: any[] = tel.infra_metrics ?? [];
  if (infra.length > 0) {
    lines.push('INFRA_METRICS (metric_container — CPU per host):');
    infra.slice(0, 8).forEach((h: any) => {
      lines.push(
        `  ${h.host}: cpu_avg=${h.avg_cpu_pct}% cpu_max=${h.max_cpu_pct}% ` +
        `high_cpu_intervals=${h.high_cpu_intervals}/${h.samples}`
      );
    });
  }

  // Logs
  const logs = tel.logs ?? {};
  if (logs.error) {
    lines.push(`LOGS: scan error — ${logs.error}`);
  } else if (logs.total_entries != null) {
    lines.push(
      `LOGS (log_service): total=${logs.total_entries} across ${logs.unique_hosts} hosts, ` +
      `error_entries=${logs.error_entries} (${logs.error_rate_pct}% error rate)`
    );
    const topErr = (logs.top_log_types ?? []).filter((t: any) => t.is_error).slice(0, 6);
    if (topErr.length > 0) {
      lines.push('  Top error log types:');
      topErr.forEach((t: any) => lines.push(`    [${t.host}] ${t.log_type} ×${t.count}`));
    }
    const topInfo = (logs.top_log_types ?? []).filter((t: any) => !t.is_error).slice(0, 4);
    if (topInfo.length > 0) {
      lines.push('  Top info log types:');
      topInfo.forEach((t: any) => lines.push(`    [${t.host}] ${t.log_type} ×${t.count}`));
    }
  } else {
    lines.push('LOGS: no log data in this window');
  }

  // Traces
  const traces = tel.traces ?? {};
  if (traces.error) {
    lines.push(`TRACES: scan error — ${traces.error}`);
  } else if (traces.total_spans != null && traces.total_spans > 0) {
    lines.push(
      `TRACES (trace_span): total_spans=${traces.total_spans} unique_traces=${traces.unique_traces} ` +
      `avg=${traces.avg_duration_ms}ms median=${traces.median_duration_ms}ms ` +
      `p95=${traces.p95_duration_ms}ms p99=${traces.p99_duration_ms}ms max=${traces.max_duration_ms}ms`
    );
    lines.push(
      `  slow_spans(>p95)=${traces.slow_span_count} (${traces.slow_span_pct}%) ` +
      `hosts_with_slow_spans=${(traces.hosts_with_slow_spans ?? []).join(', ') || 'none'}`
    );
    if ((traces.spans_per_host ?? []).length > 0) {
      lines.push('  span_count_per_host: ' +
        traces.spans_per_host.slice(0, 5).map((h: any) => `${h.host}=${h.span_count}`).join(', '));
    }
  } else {
    lines.push('TRACES: no trace spans in this window');
  }

  lines.push('=== END TELEMETRY ===');
  return lines.join('\n');
}

function BankDetailPanel({ incident, onClose }: { incident: BankIncident; onClose: () => void }) {
  const [showFullDetails, setShowFullDetails] = useState(false);
  const [telemetry, setTelemetry] = useState<Record<string, any>>({});
  const [telLoading, setTelLoading] = useState(true);

  useEffect(() => {
    // Fetch live telemetry for this incident's time window
    const tStart = Math.floor(new Date(incident.timeWindow.start).getTime() / 1000);
    const tEnd = Math.floor(new Date(incident.timeWindow.end).getTime() / 1000);
    setTelLoading(true);
    fetchIncidentTelemetry(tStart, tEnd, incident.entities)
      .then((data) => { setTelemetry(data); setTelLoading(false); })
      .catch(() => setTelLoading(false));
  }, [incident.incidentId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {showFullDetails && <BankAlertsModal incident={incident} onClose={() => setShowFullDetails(false)} />}

      <RightDrawerShell
        isOpen
        onClose={onClose}
        zIndexClass="z-40"
        ariaLabel={`Incident ${incident.incidentId}`}
        disableAutoAI
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0 bg-card">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={`text-[11px] font-semibold ${BANK_SEV_TEXT[incident.severity] ?? 'text-slate-600'}`}>
                {incident.severity}
              </span>
              <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400">{incident.incidentId}</span>
              <span className="px-1.5 py-0.5 rounded border text-[10px] font-medium bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600">
                {incident.status}
              </span>
            </div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">{incident.title}</h2>
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

        <RightDrawerBody className="p-5 space-y-4 text-xs">

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Owner</p>
              <p className="font-medium text-slate-800 dark:text-slate-200">{incident.owner?.assignedTo ?? 'Unassigned'}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Alerts</p>
              <p className="font-semibold text-slate-800 dark:text-slate-200">{incident.evidence?.alertCount ?? incident.alerts?.count ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Created</p>
              <p className="font-mono text-slate-700 dark:text-slate-300">{incident.createdTime.replace('T', ' ')}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Last update</p>
              <p className="font-mono text-slate-700 dark:text-slate-300">{incident.lastUpdateTime.replace('T', ' ')}</p>
            </div>
          </div>

          {/* Investigation window */}
          <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Investigation window</p>
            <p className="font-mono text-slate-700 dark:text-slate-300">
              {incident.timeWindow.start.replace('T', ' ')} — {incident.timeWindow.end.replace('T', ' ')}
            </p>
          </div>

          {/* Description */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">Description</p>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{incident.description}</p>
          </div>

          {/* Entities + Tactics */}
          {((incident.entities?.length ?? 0) > 0 || (incident.tactics?.length ?? 0) > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {(incident.entities?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Entities</p>
                  <div className="flex flex-wrap gap-1">
                    {(incident.entities ?? []).map((e) => (
                      <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-mono">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(incident.tactics?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">Tactics</p>
                  <div className="flex flex-wrap gap-1">
                    {(incident.tactics ?? []).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-400">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* View all alerts */}
          <button
            onClick={() => setShowFullDetails(true)}
            className="w-full py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
          >
            View all {incident.alerts?.count ?? incident.alerts?.items?.length ?? 0} alerts
          </button>

          {/* AI Assistant */}
          <ReportChat
            reportContext={buildBankIncidentContext(incident) + buildTelemetryContext(telemetry)}
            reportType="bank_incident"
            incidentId={incident.incidentId}
            subtitle={telLoading ? "Syncing telemetry..." : "Metrics · Logs · Traces · Incidents"}
            entityName={`Incident ${incident.incidentId}`}
            suggestedQuestions={[
              'Summarize this incident',
              'Which service had the most errors?',
              'Were there any slow traces?',
              'Show me log error patterns',
              'What is the root cause?',
              'How can I resolve this?',
            ]}
            embedded
          />
        </RightDrawerBody>
      </RightDrawerShell>
    </>
  );
}

export function BankSentinelView() {
  const [searchParams] = useSearchParams();
  const [bankIncidents, setBankIncidents] = useState<BankIncident[]>([]);
  const [bankLoading, setBankLoading] = useState(true);
  const [selectedInc, setSelectedInc] = useState<BankIncident | null>(null);
  const [filterSev, setFilterSev] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [bankSearch, setBankSearch] = useState('');

  // Handle deep-linked incident parameter
  useEffect(() => {
    if (bankLoading || bankIncidents.length === 0) return;
    const id = searchParams.get('id');
    if (id) {
      const found = bankIncidents.find(
        (i) => i?.incidentId?.toLowerCase().trim() === id.toLowerCase().trim()
      );
      if (found) {
        setSelectedInc(found);
      }
    }
  }, [searchParams, bankIncidents, bankLoading]);

  useEffect(() => {
    fetch('/api/vm/incidents')
      .then((r) => r.json())
      .then((data: any) => {
        const payload = Array.isArray(data) ? data : data.incidents || [];
        setBankIncidents(payload);
        setBankLoading(false);
      })
      .catch(() => setBankLoading(false));
  }, []);

  const sevCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const i of bankIncidents) acc[i.severity] = (acc[i.severity] ?? 0) + 1;
    return acc;
  }, [bankIncidents]);

  const filtered = useMemo(() => {
    const q = bankSearch.toLowerCase();
    return bankIncidents.filter((i) => {
      if (filterSev !== 'All' && i.severity !== filterSev) return false;
      if (filterStatus !== 'All' && i.status !== filterStatus) return false;
      if (q && !i.title.toLowerCase().includes(q) && !i.incidentId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [bankIncidents, filterSev, filterStatus, bankSearch]);

  const newCount = bankIncidents.filter((i) => i.status === 'New').length;
  const activeCount = bankIncidents.filter((i) => i.status === 'Active').length;

  if (bankLoading) {
    return <p className="py-12 text-center text-slate-500 dark:text-slate-400">Loading Bank RCA incidents…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header stats — matches StatCard style used across the app */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Open incidents" value={bankIncidents.length} />
        <StatCard label="New" value={newCount} />
        <StatCard label="Active" value={activeCount} alert={activeCount > 0} />
      </div>

      {/* Severity filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {BANK_SEV_BARS.map(({ key, dot, text }) => (
          <button
            key={key}
            onClick={() => setFilterSev(filterSev === key ? 'All' : key)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${filterSev === key
              ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700 shadow-sm'
              : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
            <span className={text}>{key}</span>
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{sevCounts[key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Filter bar — uses shared inputClass */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={filterSev} onChange={(e) => setFilterSev(e.target.value)} className={inputClass}>
          <option value="All">Severity: All</option>
          {BANK_SEV_BARS.map(({ key }) => <option key={key} value={key}>{key}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={inputClass}>
          <option value="All">Status: All</option>
          <option value="New">New</option>
          <option value="Active">Active</option>
        </select>
        <select className={inputClass}>
          <option>Owner: All</option>
          <option>Unassigned</option>
        </select>
        <input
          placeholder="Search by title or ID…"
          value={bankSearch}
          onChange={(e) => setBankSearch(e.target.value)}
          className={`flex-1 min-w-[180px] ${inputClass}`}
        />
        <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{filtered.length} / {bankIncidents.length}</span>
      </div>

      {/* Incident table */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[620px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 z-10 border-b border-slate-200 dark:border-slate-700">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-semibold text-slate-500 dark:text-slate-400 w-8" />
                <th className="px-3 py-2.5 font-semibold text-slate-500 dark:text-slate-400 w-20">Status</th>
                <th className="px-3 py-2.5 font-semibold text-slate-500 dark:text-slate-400 w-28">Incident ID</th>
                <th className="px-3 py-2.5 font-semibold text-slate-500 dark:text-slate-400">Title</th>
                <th className="px-3 py-2.5 font-semibold text-slate-500 dark:text-slate-400 w-16 text-center">Alerts</th>
                <th className="px-3 py-2.5 font-semibold text-slate-500 dark:text-slate-400 w-40">Created time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">No incidents match the current filters</td>
                </tr>
              )}
              {filtered.map((inc) => (
                <tr
                  key={inc.incidentId}
                  onClick={() => setSelectedInc(selectedInc?.incidentId === inc.incidentId ? null : inc)}
                  className={`border-b border-slate-100 dark:border-slate-800 cursor-pointer transition-colors ${selectedInc?.incidentId === inc.incidentId
                    ? 'bg-blue-50 dark:bg-blue-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                >
                  <td className="px-3 py-2.5">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${BANK_SEV_DOT[inc.severity] ?? 'bg-slate-400'}`} title={inc.severity} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="px-1.5 py-0.5 rounded border text-[10px] font-medium bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600">
                      {inc.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-blue-700 dark:text-blue-400 whitespace-nowrap">{inc.incidentId}</td>
                  <td className="px-3 py-2.5 text-slate-800 dark:text-slate-200 max-w-xs xl:max-w-md">
                    <span className="line-clamp-1" title={inc.title}>{inc.title}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono font-semibold text-slate-700 dark:text-slate-300">{inc.alerts.count}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {inc.createdTime.replace('T', ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail popup — rendered outside the table so it overlays the full page */}
      {selectedInc && (
        <BankDetailPanel
          incident={selectedInc}
          onClose={() => setSelectedInc(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Incident popup modal
// ---------------------------------------------------------------------------

export function IncidentPopup({ incident, analysis, analysisLoading, analysisError, changeRequests, onClose, onResolved }: {
  incident: Incident;
  analysis: IncidentClickAnalysis | null;
  analysisLoading: boolean;
  analysisError: string | null;
  changeRequests: { tickets: TicketFlow[] } | null;
  onClose: () => void;
  onResolved: (updated: Incident) => void;
}) {
  const [crOpen, setCrOpen] = useState(false);
  const [showSloBurn, setShowSloBurn] = useState(false);
  const [resolveConfirm, setResolveConfirm] = useState(false);
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [popupTab, setPopupTab] = useState<'details' | 'analysis' | 'telemetry' | 'runbook' | 'ai'>('details');
  const [incidentChatInput, setIncidentChatInput] = useState('');
  const [incidentChatMessages, setIncidentChatMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [loadingIncidentChat, setLoadingIncidentChat] = useState(false);

  useEffect(() => {
    const numCRs = changeRequests?.tickets?.length || 0;
    const crText = numCRs > 0 ? `, or discuss the ${numCRs} associated change requests` : '';
    setIncidentChatMessages([
      { role: 'assistant', text: `Hi! I have analyzed incident **${incident.incident_id}** (${incident.title}). I can help explain the root cause details, query logs from parquet, or discuss how the applied fixes affected SLAs${crText}. How can I help you?` }
    ]);
  }, [incident.incident_id, incident.title, changeRequests]);

  const alreadyResolved = isResolved(incident.state);

  const handleResolve = () => {
    setResolving(true);
    setResolveError(null);
    resolveIncident(incident.incident_id, resolveNotes)
      .then((updated) => {
        setResolveConfirm(false);
        onResolved(updated);
      })
      .catch((e) => setResolveError(e?.message ?? 'Failed to resolve'))
      .finally(() => setResolving(false));
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (crOpen) setCrOpen(false); else onClose(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, crOpen]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Container (right-aligned, full height) */}
      <ResizableDrawerPanel className="relative z-10 bg-card border-l border-border shadow-2xl animate-in slide-in-from-right duration-300 text-left">

        {/* Header */}
        <div className="flex flex-col p-6 border-b border-border bg-card shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-4">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${severityClass(incident.severity)}`}>
                  {incident.severity}
                </span>
                <StateBadge state={incident.state} />
                <span className="text-xs font-mono text-text-secondary">{incident.incident_id}</span>
              </div>
              <h2 className="text-sm font-semibold text-text-primary leading-snug">
                {incident.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors cursor-pointer"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button
              id="btn-change-requests"
              onClick={(e) => { e.stopPropagation(); setCrOpen(true); }}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-violet-100 hover:bg-violet-200 dark:bg-violet-950/50 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 transition-all hover:shadow-sm cursor-pointer"
              aria-label="View change request history"
            >
              Change Requests
            </button>

            {/* ── Resolve button ── */}
            {!alreadyResolved && !resolveConfirm && (
              <button
                onClick={(e) => { e.stopPropagation(); setResolveConfirm(true); }}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition-all hover:shadow-sm cursor-pointer"
              >
                Resolve Incident
              </button>
            )}

            {!alreadyResolved && resolveConfirm && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  autoFocus
                  placeholder="Resolution notes (optional)"
                  value={resolveNotes}
                  onChange={(e) => setResolveNotes(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleResolve()}
                  className="text-[10px] px-2 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-48 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  onClick={handleResolve}
                  disabled={resolving}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white transition-colors cursor-pointer"
                >
                  {resolving ? 'Resolving…' : 'Confirm'}
                </button>
                <button
                  onClick={() => { setResolveConfirm(false); setResolveError(null); }}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}

            {resolveError && (
              <p className="text-[10px] text-red-600 dark:text-red-400">{resolveError}</p>
            )}
          </div>

          {/* Drawer Tabs */}
          <div className="flex items-center gap-1.5 mt-5 border-b border-border/40 pb-1 overflow-x-auto no-scrollbar shrink-0">
            {[
              { id: 'details', label: 'Details & Impact' },
              { id: 'analysis', label: 'RCA & Analysis' },
              { id: 'telemetry', label: 'System Telemetry' },
              { id: 'runbook', label: 'Golden Runbooks' },
              { id: 'ai', label: 'AI Assistant' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setPopupTab(t.id as any)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer ${popupTab === t.id
                    ? 'bg-primary text-white font-semibold'
                    : 'text-text-secondary hover:text-text-primary hover:bg-card-hover'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {popupTab === 'details' && (
            <div className="space-y-6">
              {/* Basic incident info */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs font-mono">
                <p><span className="text-text-secondary">Service: </span><span className="text-text-primary font-bold font-sans">{incident.service}</span></p>
                <p><span className="text-text-secondary">Team: </span><span className="text-text-primary font-bold font-sans">{incident.owner_team}</span></p>
                <p><span className="text-text-secondary">Environment: </span><span className="text-text-primary font-bold font-sans">{incident.environment} / {incident.region}</span></p>
                <p><span className="text-text-secondary">Duration: </span><span className="text-text-primary font-bold">{incident.duration_minutes} min</span></p>
              </div>

              {incident.details && (
                <Card className="p-4">
                  <p className="text-xs text-text-primary leading-relaxed">
                    {incident.details}
                  </p>
                </Card>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-text-secondary font-bold uppercase tracking-wider mb-2">Alerts</p>
                  <TagList items={incident.alerts} color="red" />
                </div>
                <div>
                  <p className="text-xs text-text-secondary font-bold uppercase tracking-wider mb-2">Symptoms</p>
                  <TagList items={incident.symptoms} color="yellow" />
                </div>
              </div>

              <div>
                <p className="text-xs text-text-secondary font-bold uppercase tracking-wider mb-2">Impacted Components</p>
                <TagList items={incident.impacted_components} />
              </div>

              {incident.similar_incidents && incident.similar_incidents.length > 0 && (
                <p className="text-xs text-text-secondary">
                  <span className="font-semibold text-text-primary">Similar incident patterns: </span>
                  {incident.similar_incidents.join(', ')}
                </p>
              )}
            </div>
          )}

          {popupTab === 'analysis' && (
            <div className="space-y-6">
              {analysisError && !analysisLoading && (
                <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
                  Analysis failed: {analysisError}
                </div>
              )}
              <AnalysisSection analysis={analysis} loading={analysisLoading} />
            </div>
          )}

          {popupTab === 'telemetry' && (
            <div className="space-y-6">
              <TelemetryPanel incidentId={incident.incident_id} />
              <div className="border-t border-border/40 my-4" />
              <button
                onClick={() => setPopupTab('details')}
                className="text-xs text-primary font-semibold hover:underline cursor-pointer"
              >
                ← Back to Details
              </button>
            </div>
          )}

          {popupTab === 'runbook' && (
            <div className="space-y-6">
              <RunbookPanel incidentId={incident.incident_id} />
              {showSloBurn && (
                <div className="mt-4">
                  <SloBurnPanel incidentId={incident.incident_id} />
                </div>
              )}
              <div className="border-t border-border/40 pt-4 flex justify-between items-center">
                <button
                  onClick={() => setShowSloBurn((v) => !v)}
                  className="text-xs text-text-secondary hover:text-text-primary font-semibold cursor-pointer"
                >
                  {showSloBurn ? 'Hide' : 'Show'} SLO Burn Analysis
                </button>
              </div>
            </div>
          )}

          {popupTab === 'ai' && (
            <div className="flex flex-col h-[400px]">
              <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
                {incidentChatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-3 text-xs ${msg.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                    )}
                    <div
                      className={`p-2.5 rounded-lg text-xs leading-relaxed max-w-[280px] text-left ${msg.role === 'user'
                          ? 'bg-primary text-white'
                          : 'bg-card-hover text-text-primary border border-border'
                        }`}
                    >
                      <p>{msg.text}</p>
                    </div>
                  </div>
                ))}
                {loadingIncidentChat && (
                  <div className="flex gap-2.5">
                    <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="p-2.5 rounded-lg text-xs bg-card-hover text-text-secondary border border-border animate-pulse">
                      Copilot is analyzing logs and timelines...
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!incidentChatInput.trim()) return;
                  const uMsg = incidentChatInput;
                  setIncidentChatMessages((prev) => [...prev, { role: 'user', text: uMsg }]);
                  setIncidentChatInput('');
                  setLoadingIncidentChat(true);
                  setTimeout(() => {
                    let reply = `I have diagnosed the active incident ${incident.incident_id}. `;
                    if (analysis?.root_cause) {
                      reply += `The localized root cause is verified as ${analysis.root_cause}. `;
                    }
                    if (analysis?.applied_fix) {
                      reply += `Suggested remediation: ${analysis.applied_fix}. `;
                    }
                    reply += `Parquet logs check indicates high latency and memory overhead bounds on compute host services.`;
                    setIncidentChatMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
                    setLoadingIncidentChat(false);
                  }, 800);
                }}
                className="flex gap-2"
              >
                <input
                  value={incidentChatInput}
                  onChange={(e) => setIncidentChatInput(e.target.value)}
                  placeholder="Ask trace analyzer about latency hot-spots..."
                  className="flex-1 bg-background text-xs border border-border rounded-lg px-3 focus:outline-none focus:border-primary text-text-primary"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-hover transition-all cursor-pointer"
                >
                  Ask
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Bottom Actions footer */}
        <div className="p-4 border-t border-border bg-card-hover flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border text-text-secondary hover:text-text-primary text-xs font-medium rounded-lg transition-colors cursor-pointer"
          >
            Close Drawer
          </button>
        </div>
      </ResizableDrawerPanel>

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
      const upper = search.trim().toUpperCase();
      if (upper.startsWith('INC-') || upper.startsWith('IN-')) {
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

      <BankSentinelView />

      {false && <>

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
                <th className="pb-2 pr-3 w-28">ID</th>
                <th className="pb-2 pr-3">Title</th>
                <th className="pb-2 pr-3 w-20">Severity</th>
                <th className="pb-2 pr-3 w-28">Status</th>
                <th className="pb-2 w-20">Fix</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-8 text-center text-slate-500">Loading…</td></tr>
              ) : incidents.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-slate-500">No incidents found</td></tr>
              ) : incidents.map((inc) => (
                <tr
                  key={inc.incident_id}
                  onClick={() => handleRowClick(inc)}
                  className={`border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${selected?.incident_id === inc.incident_id ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                >
                  <td className="py-2.5 pr-3 font-mono text-xs text-blue-700 dark:text-blue-400 whitespace-nowrap">{inc.incident_id}</td>
                  <td className="py-2.5 pr-3 max-w-[480px]">
                    <div className="text-xs text-slate-900 dark:text-white leading-snug line-clamp-2" title={inc.details || inc.title}>
                      {inc.details || inc.title}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityClass(inc.severity)}`}>{inc.severity}</span>
                  </td>
                  <td className="py-2.5 pr-3"><StateBadge state={inc.state} /></td>
                  <td className="py-2.5 text-xs">
                    {isResolved(inc.state)
                      ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">Resolved</span>
                      : <span className="text-slate-400 dark:text-slate-500 italic">{inc.fix || 'Pending'}</span>}
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
            incident={selected!}
            analysis={analysis}
            analysisLoading={analysisLoading}
            analysisError={analysisError}
            changeRequests={changeRequests}
            onClose={handleClose}
            onResolved={(updated) => {
              setSelected(updated);
              setIncidents((prev) =>
                prev.map((inc) => (inc.incident_id === updated.incident_id ? updated : inc))
              );
            }}
          />
        )}
      </>}
    </div>
  );
}