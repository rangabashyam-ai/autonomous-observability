import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { analyzeEarlyDetection, copilotChat } from '../api/client';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import type { CopilotResponse } from '../ai/types';
import type { EarlyDetection } from '../types/intelligence';
import { Sparkles, Bot, MessageSquare, ShieldAlert, Send, RefreshCw, AlertTriangle, Target, Zap, Clock, TrendingUp, ArrowRight } from 'lucide-react';
import { PageHeader } from '../components/ui';
import { Badge } from '../components/ui/badge';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import DrilldownDrawer, { DrilldownSection } from '../components/drilldown/DrilldownDrawer';
import { cn } from '../lib/cn';

/* Extended API shapes (backend returns richer payload than base types) */
interface MatchedAlertDetail {
  id: string;
  title: string;
  pattern_alert: string;
  entity_id: string;
  severity: string;
  minutes_ago: number;
  match_score: number;
  value?: number;
  threshold?: number;
  metric?: string;
}

interface ActiveCondition {
  title: string;
  count: number;
  severity: string;
  entities: string[];
}

interface ServiceRisk {
  service_id: string;
  service_name: string;
  risk_level: string;
  confidence: number;
  active_threats: number;
  eta_minutes: number;
  progression_stage: string;
}

interface DetectionExtended extends EarlyDetection {
  pattern_label?: string;
  risk_level?: string;
  progression_stage?: string;
  expected_impacted_service_id?: string;
  match_coverage?: { matched: number; total: number; percent: number; unmatched_alerts: string[] };
  matched_alerts_details?: MatchedAlertDetail[];
  propagation_paths?: Record<string, string[]>;
  correlated_changes?: {
    type: string;
    id: string;
    title: string;
    status: string;
    time: string;
    severity: string;
    hours_ago?: number;
  }[];
  severity_breakdown?: { critical: number; warning: number; info: number };
}

interface AlertFeedItem {
  id: string;
  title: string;
  severity: string;
  status: string;
  entity_id: string;
  description?: string;
  metric?: string;
  value?: number;
  threshold?: number;
  minutes_ago: number;
  remediation_hints: string[];
  linked_detection?: {
    pattern_id: string;
    service: string;
    confidence: number;
    eta_minutes: number;
  };
}

interface ClearancePlan {
  summary: string;
  priority_actions: string[];
  per_alert_actions: { alert_id: string; title: string; entity_id: string; actions: string[] }[];
  avoidance_steps: string[];
}

interface DetectionResponse {
  current_conditions: string[];
  active_conditions?: ActiveCondition[];
  active_alerts_feed?: AlertFeedItem[];
  critical_alerts_feed?: AlertFeedItem[];
  clearance_plan?: ClearancePlan;
  detections: DetectionExtended[];
  service_risk_summary?: ServiceRisk[];
  total_patterns_evaluated?: number;
  analysis_timestamp?: string;
  summary?: {
    active_alerts: number;
    critical_alerts: number;
    patterns_matched: number;
    imminent_threats: number;
    highest_risk_service: string | null;
    soonest_eta_minutes: number;
  };
}

type DrillPanel =
  | 'active-alerts'
  | 'patterns'
  | 'imminent'
  | 'eta'
  | 'service-risk-overview'
  | 'service-risk'
  | 'live-conditions'
  | 'ranked-threats'
  | 'ranked-threat';

interface DrillContext {
  panel: DrillPanel;
  serviceId?: string;
  conditionTitle?: string;
  patternId?: string;
}

interface AiChatEntry {
  role: 'user' | 'assistant';
  content: string;
  response?: CopilotResponse;
}

const STAGE_META: Record<string, { label: string; color: string; bg: string }> = {
  imminent: { label: 'Imminent', color: 'text-critical', bg: 'bg-critical/15 border-critical/30' },
  developing: { label: 'Developing', color: 'text-warning', bg: 'bg-warning/15 border-warning/30' },
  watch: { label: 'Watch', color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10 border-sky-500/25' },
  healthy: { label: 'Healthy', color: 'text-success', bg: 'bg-success/10 border-success/25' },
};

const RISK_VARIANT: Record<string, 'critical' | 'warning' | 'default' | 'success'> = {
  Critical: 'critical',
  High: 'critical',
  Medium: 'warning',
  Low: 'default',
  Healthy: 'success',
};

function riskBarColor(confidence: number): string {
  if (confidence >= 85) return 'bg-red-500';
  if (confidence >= 70) return 'bg-orange-500';
  if (confidence >= 50) return 'bg-amber-500';
  if (confidence >= 25) return 'bg-blue-500';
  return 'bg-emerald-500';
}

function severityBadge(sev: string) {
  const s = sev.toLowerCase();
  if (s === 'critical') return <Badge variant="critical">Critical</Badge>;
  if (s === 'warning') return <Badge variant="warning">Warning</Badge>;
  return <Badge variant="secondary">{sev}</Badge>;
}

function formatEta(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function alertsForService(
  serviceId: string,
  detections: DetectionExtended[],
  feed: AlertFeedItem[]
): AlertFeedItem[] {
  const det = detections.find((d) => d.expected_impacted_service_id === serviceId);
  const detEntities = new Set((det?.matched_alerts_details ?? []).map((a) => a.entity_id));
  const serviceSlug = serviceId.replace(/-/g, ' ').toLowerCase();
  return feed.filter((a) => {
    if (detEntities.has(a.entity_id)) return true;
    if (a.entity_id.includes(serviceId)) return true;
    if (a.description?.toLowerCase().includes(serviceSlug)) return true;
    if (a.linked_detection?.service.toLowerCase().includes(serviceSlug.split(' ')[0])) return true;
    return false;
  });
}

function formatApiError(message: string): { title: string; detail: string; hint?: string } {
  const lower = message.toLowerCase();
  if (lower.includes('502') || lower.includes('failed to fetch') || lower.includes('network')) {
    return {
      title: 'Backend API unavailable',
      detail: 'The frontend could not reach the API server on port 8000.',
      hint: 'Start the backend: cd backend && pip install -r requirements.txt && python -m uvicorn app.main:app --reload --port 8000',
    };
  }
  return { title: 'Failed to load detections', detail: message };
}

function ConfidenceRing({ value, size = 88, selectedDetection }: { value: number; size?: number; selectedDetection: DetectionExtended }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 85 ? '#ef4444' : value >= 70 ? '#f97316' : value >= 50 ? '#eab308' : '#3b82f6';

  const copilotContext = useMemo(() => {
    if (!selectedDetection) return null;
    return {
      pageType: 'prediction' as const,
      selectedEntity: selectedDetection.pattern_id,
      entityData: {
        prediction: selectedDetection.expected_impacted_service,
        confidence: selectedDetection.confidence,
        estimated_time_to_outage: `${selectedDetection.estimated_time_to_incident_minutes} minutes`,
        evidence: selectedDetection.matched_alerts,
        related_patterns: selectedDetection.expected_symptoms,
        occurrence_count: selectedDetection.occurrence_count_historical,
      },
      relatedAlerts: selectedDetection.matched_alerts,
      analysisResults: { ...selectedDetection } as Record<string, unknown>,
    };
  }, [selectedDetection]);

  useRegisterCopilotContext(copilotContext);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-slate-200 dark:text-slate-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-text-primary">{value}%</span>
        <span className="text-[10px] text-text-secondary">confidence</span>
      </div>
    </div>
  );
}

const METRIC_VALUE_COLORS = {
  default: 'text-text-primary',
  success: 'text-success',
  warning: 'text-warning',
  critical: 'text-critical',
} as const;

function ClickableMetricCard({
  label,
  value,
  sub,
  variant = 'default',
  onClick,
  active,
}: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: keyof typeof METRIC_VALUE_COLORS;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group text-left w-full rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-sm',
        'transition-all duration-200 hover:bg-card-hover hover:shadow-md hover:border-primary/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        active && 'ring-2 ring-primary/40 border-primary/40 bg-primary/5'
      )}
    >
      <p className="text-xs font-medium text-text-secondary mb-2 flex items-center justify-between">
        {label}
        <span className="text-[10px] text-primary opacity-70 group-hover:opacity-100">View →</span>
      </p>
      <p className={cn('text-3xl font-semibold tracking-tight', METRIC_VALUE_COLORS[variant])}>{value}</p>
      {sub && <p className="text-xs text-text-secondary mt-1.5">{sub}</p>}
    </button>
  );
}

function AiSuggestionsBlock({
  loading,
  response,
  fallbackPlan,
  chatHistory,
  suggestedQuestions,
  onAskAi,
  onAskQuestion,
}: {
  loading: boolean;
  response: CopilotResponse | null;
  fallbackPlan?: ClearancePlan;
  chatHistory: AiChatEntry[];
  suggestedQuestions: string[];
  onAskAi: () => void;
  onAskQuestion: (question: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const actions = response?.recommended_actions?.length
    ? response.recommended_actions
    : fallbackPlan?.priority_actions ?? [];
  const summary = response?.summary || fallbackPlan?.summary;
  const avoidance = fallbackPlan?.avoidance_steps ?? [];
  const hasChat = chatHistory.length > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setQuestion('');
    onAskQuestion(q);
  };

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-text-primary">AI Assistant</h4>
        </div>
        <button
          type="button"
          onClick={onAskAi}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
        >
          <Bot className={cn('h-3.5 w-3.5', loading && 'animate-pulse')} />
          {loading ? 'Analyzing…' : 'Auto-analyze'}
        </button>
      </div>

      {!hasChat && summary && <p className="text-sm text-text-secondary mb-3">{summary}</p>}
      {!hasChat && actions.length > 0 && (
        <ol className="space-y-2 mb-3">
          {actions.map((action, i) => (
            <li key={action} className="flex gap-2 text-sm text-text-primary">
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                {i + 1}
              </span>
              {action}
            </li>
          ))}
        </ol>
      )}

      {hasChat && (
        <div className="space-y-3 mb-3 max-h-56 overflow-y-auto pr-1">
          {chatHistory.map((entry, i) => (
            <div
              key={`${entry.role}-${i}`}
              className={cn(
                'rounded-lg px-3 py-2 text-sm',
                entry.role === 'user'
                  ? 'bg-card border border-border text-text-primary ml-4'
                  : 'bg-primary/10 text-text-secondary mr-4'
              )}
            >
              {entry.role === 'user' ? (
                <p className="flex items-start gap-2">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                  {entry.content}
                </p>
              ) : (
                <div>
                  <p className="font-medium text-text-primary mb-1 flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                    AI response
                  </p>
                  <p>{entry.response?.summary || entry.content}</p>
                  {entry.response?.recommended_actions && entry.response.recommended_actions.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {entry.response.recommended_actions.map((a) => (
                        <li key={a} className="flex gap-1.5">
                          <span className="text-success">→</span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <p className="text-xs text-text-secondary flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 animate-pulse text-primary" />
              Thinking…
            </p>
          )}
        </div>
      )}

      {!hasChat && response?.findings && response.findings.length > 0 && (
        <ul className="space-y-1 mb-3 text-xs text-text-secondary">
          {response.findings.map((f) => (
            <li key={f}>• {f}</li>
          ))}
        </ul>
      )}

      {!hasChat && avoidance.length > 0 && (
        <div className="pt-3 border-t border-primary/10 mb-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            Avoid incident formation
          </p>
          <ul className="space-y-1">
            {avoidance.map((step) => (
              <li key={step} className="text-xs text-text-secondary flex gap-2">
                <ShieldAlert className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                {step}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestedQuestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {suggestedQuestions.map((q) => (
            <button
              key={q}
              type="button"
              disabled={loading}
              onClick={() => onAskQuestion(q)}
              className="text-[11px] px-2.5 py-1 rounded-full border border-primary/25 bg-card text-text-secondary hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 pt-3 border-t border-primary/10">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about this context…"
          disabled={loading}
          className="flex-1 text-sm px-3 py-2 rounded-lg border border-border bg-card text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          aria-label="Send question"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>

      {response?.confidence && !hasChat && (
        <p className="text-[11px] text-text-secondary mt-2">AI confidence: {response.confidence}</p>
      )}
    </div>
  );
}

function AlertFeedRow({
  alert,
  onSelectDetection,
}: {
  alert: AlertFeedItem;
  onSelectDetection?: (patternId: string) => void;
}) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card-hover">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-medium text-text-primary text-sm">{alert.title}</p>
          <p className="text-xs text-text-secondary font-mono mt-0.5">{alert.entity_id}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {severityBadge(alert.severity)}
          <span className="text-[10px] text-text-secondary">{formatAge(alert.minutes_ago)}</span>
        </div>
      </div>
      {alert.metric && (
        <p className="text-xs text-text-secondary mb-2">
          {alert.metric}: <span className="text-text-primary font-mono">{alert.value}</span>
          {alert.threshold != null && (
            <span> / threshold {alert.threshold}</span>
          )}
        </p>
      )}
      {alert.linked_detection && (
        <button
          type="button"
          onClick={() => onSelectDetection?.(alert.linked_detection!.pattern_id)}
          className="text-xs text-primary hover:underline mb-2 block"
        >
          Linked pattern: {alert.linked_detection.service} ({alert.linked_detection.confidence}% · ETA {formatEta(alert.linked_detection.eta_minutes)})
        </button>
      )}
      <ul className="space-y-1 mt-2">
        {alert.remediation_hints.map((hint) => (
          <li key={hint} className="text-xs text-text-secondary flex gap-1.5">
            <span className="text-success">→</span>
            {hint}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PatternCoverageBar({ matched, total }: { matched: number; total: number }) {
  const pct = total > 0 ? (matched / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-text-secondary">Pattern coverage</span>
        <span className="font-mono text-text-primary">
          {matched}/{total} alerts ({Math.round(pct)}%)
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-2 flex-1 rounded-full transition-colors',
              i < matched ? 'bg-red-500' : 'bg-slate-200 dark:bg-slate-700'
            )}
          />
        ))}
      </div>
    </div>
  );
}

export default function EarlyDetectionDashboard() {
  const [data, setData] = useState<DetectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillContext | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<CopilotResponse | null>(null);
  const [aiChat, setAiChat] = useState<AiChatEntry[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    analyzeEarlyDetection()
      .then((r) => {
        const res = r as DetectionResponse;
        setData(res);
        if (res.detections.length > 0) {
          setSelectedId((prev) =>
            prev && res.detections.some((d) => d.pattern_id === prev)
              ? prev
              : res.detections[0].pattern_id
          );
        } else {
          setSelectedId(null);
        }
      })
      .catch((e) => {
        setData(null);
        setError(e instanceof Error ? e.message : 'Failed to load detections');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const detections = data?.detections ?? [];
  const selected = detections.find((d) => d.pattern_id === selectedId) ?? detections[0];
  const summary = data?.summary;
  const serviceRisks = data?.service_risk_summary ?? [];
  const activeConditions = data?.active_conditions ?? [];
  const alertsFeed = data?.active_alerts_feed ?? [];
  const criticalFeed = data?.critical_alerts_feed ?? [];
  const clearancePlan = data?.clearance_plan;
  const imminentDetections = detections.filter((d) => d.progression_stage === 'imminent');
  const soonestDetection = detections.length
    ? [...detections].sort((a, b) => a.estimated_time_to_incident_minutes - b.estimated_time_to_incident_minutes)[0]
    : null;

  const openDrill = useCallback((ctx: DrillContext) => {
    setDrill(ctx);
    setAiResponse(null);
    setAiChat([]);
    if (ctx.patternId) setSelectedId(ctx.patternId);
    if (ctx.panel === 'ranked-threat' && ctx.patternId) setSelectedId(ctx.patternId);
  }, []);

  const closeDrill = useCallback(() => {
    setDrill(null);
    setAiResponse(null);
    setAiChat([]);
  }, []);

  const jumpToDetection = useCallback((patternId: string) => {
    setSelectedId(patternId);
    closeDrill();
  }, [closeDrill]);

  const drillDetection = useMemo(() => {
    if (!drill?.patternId) return selected;
    return detections.find((d) => d.pattern_id === drill.patternId) ?? selected;
  }, [drill, detections, selected]);

  const drillService = useMemo(() => {
    if (!drill?.serviceId) return null;
    return serviceRisks.find((s) => s.service_id === drill.serviceId) ?? null;
  }, [drill, serviceRisks]);

  const drillCondition = useMemo(() => {
    if (!drill?.conditionTitle) return null;
    return activeConditions.find((c) => c.title === drill.conditionTitle) ?? null;
  }, [drill, activeConditions]);

  const serviceAlerts = useCallback(
    (serviceId: string) => alertsForService(serviceId, detections, alertsFeed),
    [alertsFeed, detections]
  );

  const conditionAlerts = useCallback(
    (title: string) => alertsFeed.filter((a) => a.title === title),
    [alertsFeed]
  );

  const buildDrillAiContext = useCallback(() => {
    if (!drill) return null;
    const panel = drill.panel;
    let entityData: Record<string, unknown> = { drilldown: panel };
    let relatedAlerts: unknown[] = [];
    let selectedEntity: string = panel;

    if (panel === 'active-alerts') {
      entityData = { drilldown: panel, critical_count: criticalFeed.length, total_active: alertsFeed.length };
      relatedAlerts = criticalFeed.length > 0 ? criticalFeed : alertsFeed.slice(0, 15);
    } else if (panel === 'patterns') {
      entityData = { drilldown: panel, count: detections.length };
      relatedAlerts = detections;
    } else if (panel === 'imminent') {
      entityData = { drilldown: panel, count: imminentDetections.length };
      relatedAlerts = imminentDetections;
    } else if (panel === 'eta' && soonestDetection) {
      entityData = {
        drilldown: panel,
        detection: soonestDetection,
        service: soonestDetection.expected_impacted_service,
        eta_minutes: soonestDetection.estimated_time_to_incident_minutes,
        confidence: soonestDetection.confidence,
        risk_level: soonestDetection.risk_level,
        progression_stage: soonestDetection.progression_stage,
        match_coverage: soonestDetection.match_coverage,
        matched_alerts_details: soonestDetection.matched_alerts_details,
        recommended_actions: soonestDetection.recommended_actions,
        evidence: soonestDetection.matched_alerts,
      };
      relatedAlerts = soonestDetection.matched_alerts_details?.length
        ? soonestDetection.matched_alerts_details
        : [soonestDetection];
      selectedEntity = soonestDetection.pattern_id;
    } else if (panel === 'service-risk-overview') {
      entityData = { drilldown: panel, services: serviceRisks };
      relatedAlerts = alertsFeed.slice(0, 20);
    } else if (panel === 'service-risk' && drillService) {
      const linkedDetection = detections.find((d) => d.expected_impacted_service_id === drill.serviceId);
      entityData = {
        drilldown: panel,
        service: drillService,
        detection: linkedDetection,
        prediction: drillService.service_name,
        confidence: linkedDetection?.confidence ?? drillService.confidence,
        eta_minutes: linkedDetection?.estimated_time_to_incident_minutes ?? drillService.eta_minutes,
        risk_level: linkedDetection?.risk_level ?? drillService.risk_level,
        progression_stage: linkedDetection?.progression_stage ?? drillService.progression_stage,
        match_coverage: linkedDetection?.match_coverage,
        matched_alerts_details: linkedDetection?.matched_alerts_details,
        recommended_actions: linkedDetection?.recommended_actions,
        evidence: linkedDetection?.matched_alerts,
      };
      relatedAlerts = serviceAlerts(drill.serviceId!);
      selectedEntity = drill.serviceId!;
    } else if (panel === 'live-conditions' && drill.conditionTitle && drillCondition) {
      entityData = { drilldown: panel, condition: drillCondition };
      relatedAlerts = conditionAlerts(drill.conditionTitle);
      selectedEntity = drill.conditionTitle;
    } else if (panel === 'live-conditions') {
      entityData = { drilldown: panel, conditions: activeConditions };
      relatedAlerts = alertsFeed.slice(0, 20);
    } else if (panel === 'ranked-threats') {
      entityData = { drilldown: panel, threat_count: detections.length };
      relatedAlerts = detections;
    } else if (panel === 'ranked-threat' && drillDetection) {
      entityData = {
        drilldown: panel,
        threat: drillDetection,
        prediction: drillDetection.expected_impacted_service,
        confidence: drillDetection.confidence,
        eta_minutes: drillDetection.estimated_time_to_incident_minutes,
        risk_level: drillDetection.risk_level,
        progression_stage: drillDetection.progression_stage,
        match_coverage: drillDetection.match_coverage,
        matched_alerts_details: drillDetection.matched_alerts_details,
        recommended_actions: drillDetection.recommended_actions,
        evidence: drillDetection.matched_alerts,
      };
      relatedAlerts = drillDetection.matched_alerts_details ?? [];
      selectedEntity = drillDetection.pattern_id;
    }

    return { entityData, relatedAlerts, selectedEntity };
  }, [
    drill,
    criticalFeed,
    alertsFeed,
    detections,
    imminentDetections,
    soonestDetection,
    serviceRisks,
    drillService,
    activeConditions,
    drillCondition,
    drillDetection,
    serviceAlerts,
    conditionAlerts,
  ]);

  const suggestedQuestions = useMemo((): string[] => {
    if (!drill) return [];
    const svc = drillService?.service_name;
    const threat = drillDetection?.expected_impacted_service;
    switch (drill.panel) {
      case 'active-alerts':
        return [
          'Which critical alert should we clear first?',
          'How do we prevent these from becoming an incident?',
          'Are any of these alerts correlated?',
        ];
      case 'service-risk':
        return [
          `Why is ${svc ?? 'this service'} at elevated risk?`,
          `What playbook should we run for ${svc ?? 'this service'}?`,
          'Can we safely defer any of these signals?',
        ];
      case 'service-risk-overview':
        return ['Which service needs attention first?', 'Compare risk across all services'];
      case 'live-conditions':
        return drillCondition
          ? [
              `What causes ${drillCondition.title} on these entities?`,
              `How urgent is ${drillCondition.title}?`,
              'What should on-call do right now?',
            ]
          : ['Which condition is most dangerous?', 'Summarize all live alert conditions'];
      case 'ranked-threat':
        return [
          `How do we stop the threat on ${threat ?? 'this service'}?`,
          'What is the fastest remediation path?',
          'What evidence should we collect first?',
        ];
      case 'ranked-threats':
        return ['Rank these threats by urgency', 'Which threat should we tackle first?'];
      case 'patterns':
        return ['Which pattern is closest to incident?', 'How do we break these precursor chains?'];
      case 'imminent':
        return ['What is the minimum action to avoid outage?', 'Who should we page?'];
      case 'eta':
        return ['We have limited time — what are the top 3 actions?', 'Can we buy more time safely?'];
      default:
        return [];
    }
  }, [drill, drillService, drillDetection, drillCondition]);

  const runAiQuery = useCallback(
    async (question: string, appendToChat = true) => {
      if (!data || !drill) return;
      const ctx = buildDrillAiContext();
      if (!ctx) return;

      setAiLoading(true);

      let historyForApi: { role: string; content: string }[] = [];
      if (appendToChat) {
        setAiChat((prev) => {
          historyForApi = [
            ...prev.map((m) => ({
              role: m.role,
              content: m.role === 'user' ? m.content : m.response?.summary ?? m.content,
            })),
            { role: 'user', content: question },
          ];
          return [...prev, { role: 'user', content: question }];
        });
      } else {
        historyForApi = [{ role: 'user', content: question }];
      }

      try {
        const res = await copilotChat(
          {
            context_scope: 'strict',
            page_type: 'prediction',
            selected_entity: ctx.selectedEntity,
            entity_data: ctx.entityData,
            related_metrics: summary ?? {},
            related_alerts: ctx.relatedAlerts,
            related_incidents: [],
            dependency_data: {},
            analysis_results: { detections, clearance_plan: clearancePlan },
            investigation_results: {},
            user_question: question,
          },
          historyForApi
        );
        setAiResponse(res);
        if (appendToChat) {
          setAiChat((prev) => [...prev, { role: 'assistant', content: res.summary, response: res }]);
        }
      } catch {
        const fallback: CopilotResponse = {
          summary: 'AI analysis unavailable. Use the rule-based recommendations below.',
          findings: [],
          evidence: [],
          recommended_actions: clearancePlan?.priority_actions ?? [],
          confidence: 'offline',
        };
        setAiResponse(fallback);
        if (appendToChat) {
          setAiChat((prev) => [...prev, { role: 'assistant', content: fallback.summary, response: fallback }]);
        }
      } finally {
        setAiLoading(false);
      }
    },
    [data, drill, buildDrillAiContext, summary, detections, clearancePlan]
  );

  const runAiAnalysis = useCallback(() => {
    if (!drill) return;
    const defaults: Record<DrillPanel, string> = {
      'active-alerts': 'How should we prioritize clearing these critical alerts to prevent incident formation?',
      patterns: 'What should we do now to prevent matched patterns from escalating?',
      imminent: 'What immediate actions should on-call take to avoid outage?',
      eta: `How do we intervene before the incident on ${soonestDetection?.expected_impacted_service}?`,
      'service-risk-overview': 'Which services are at highest risk and what should we do?',
      'service-risk': `How do we reduce risk on ${drillService?.service_name ?? 'this service'}?`,
      'live-conditions': drillCondition
        ? `How should we respond to ${drillCondition.title} across affected entities?`
        : 'Summarize live alert conditions and recommended responses.',
      'ranked-threats': 'Which ranked threat should we address first and why?',
      'ranked-threat': `How do we remediate the threat on ${drillDetection?.expected_impacted_service} before ETA expires?`,
    };
    runAiQuery(defaults[drill.panel], true);
  }, [drill, soonestDetection, drillService, drillCondition, drillDetection, runAiQuery]);

  const copilotContext = useMemo(() => {
    if (!selected) return null;
    return {
      pageType: 'prediction' as const,
      selectedEntity: selected.pattern_id,
      entityData: {
        prediction: selected.expected_impacted_service,
        confidence: selected.confidence,
        estimated_time_to_outage: `${selected.estimated_time_to_incident_minutes} minutes`,
        eta_minutes: selected.estimated_time_to_incident_minutes,
        evidence: selected.matched_alerts,
        matched_alerts_details: selected.matched_alerts_details,
        match_coverage: selected.match_coverage,
        recommended_actions: selected.recommended_actions,
        related_patterns: selected.expected_symptoms,
        occurrence_count: selected.occurrence_count_historical,
        risk_level: selected.risk_level,
        progression_stage: selected.progression_stage,
      },
      relatedAlerts: selected.matched_alerts,
      analysisResults: { ...selected } as Record<string, unknown>,
    };
  }, [selected]);

  useRegisterCopilotContext(copilotContext);

  const analyzedAt = data?.analysis_timestamp
    ? new Date(data.analysis_timestamp).toLocaleString()
    : null;

  const apiError = error ? formatApiError(error) : null;
  const hasData = data !== null;

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <PageHeader
          title="Early Failure Detection"
          description="Pattern-matched threat analysis across active alerts, dependencies, and recent changes"
        />
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {apiError && (
        <div className="p-5 rounded-xl border border-critical/30 bg-critical/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-critical shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-critical">{apiError.title}</p>
              <p className="text-sm text-critical/90 mt-1">{apiError.detail}</p>
              {apiError.hint && (
                <code className="block mt-3 text-xs text-critical/80 bg-critical/5 border border-critical/20 rounded-lg px-3 py-2 font-mono break-all">
                  {apiError.hint}
                </code>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Summary metrics */}
      {hasData && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ClickableMetricCard
          label="Active alerts"
          value={loading ? '—' : (summary?.active_alerts ?? 0)}
          sub={`${summary?.critical_alerts ?? 0} critical · click to inspect`}
          variant={(summary?.critical_alerts ?? 0) > 0 ? 'critical' : 'default'}
          onClick={() => openDrill({ panel: 'active-alerts' })}
          active={drill?.panel === 'active-alerts'}
        />
        <ClickableMetricCard
          label="Patterns matched"
          value={loading ? '—' : (summary?.patterns_matched ?? detections.length)}
          sub={`of ${data?.total_patterns_evaluated ?? 0} evaluated`}
          variant={(summary?.patterns_matched ?? 0) > 0 ? 'warning' : 'default'}
          onClick={() => openDrill({ panel: 'patterns' })}
          active={drill?.panel === 'patterns'}
        />
        <ClickableMetricCard
          label="Imminent threats"
          value={loading ? '—' : (summary?.imminent_threats ?? 0)}
          sub={summary?.highest_risk_service ?? 'No service at risk'}
          variant={(summary?.imminent_threats ?? 0) > 0 ? 'critical' : 'default'}
          onClick={() => openDrill({ panel: 'imminent' })}
          active={drill?.panel === 'imminent'}
        />
        <ClickableMetricCard
          label="Soonest ETA"
          value={loading ? '—' : formatEta(summary?.soonest_eta_minutes ?? 0)}
          sub="estimated to incident"
          variant={(summary?.soonest_eta_minutes ?? 0) > 0 && (summary?.soonest_eta_minutes ?? 999) < 60 ? 'critical' : 'default'}
          onClick={() => openDrill({ panel: 'eta' })}
          active={drill?.panel === 'eta'}
        />
      </div>
      )}

      {(loading || hasData) && !apiError && (
      <>
      {/* Service risk heatmap */}
      <Card>
        <CardHeader className="pb-3">
          <button
            type="button"
            onClick={() => openDrill({ panel: 'service-risk-overview' })}
            className="w-full text-left group"
          >
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Service Risk Overview
              <span className="text-[10px] font-normal text-primary ml-auto opacity-70 group-hover:opacity-100">
                View all →
              </span>
            </CardTitle>
          </button>
        </CardHeader>
        <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-lg bg-card-hover animate-pulse" />
              ))
            : serviceRisks.map((svc) => {
                const stage = STAGE_META[svc.progression_stage] ?? STAGE_META.watch;
                return (
                  <button
                    key={svc.service_id}
                    type="button"
                    onClick={() => openDrill({ panel: 'service-risk', serviceId: svc.service_id })}
                    className={cn(
                      'text-left p-3 rounded-lg border transition-all hover:shadow-sm hover:ring-1 hover:ring-primary/30 cursor-pointer',
                      stage.bg,
                      drill?.serviceId === svc.service_id && 'ring-2 ring-primary/50',
                      selected?.expected_impacted_service_id === svc.service_id &&
                        'ring-2 ring-primary/50'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {svc.service_name}
                      </span>
                      <Badge variant={RISK_VARIANT[svc.risk_level] ?? 'secondary'}>
                        {svc.risk_level}
                      </Badge>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-700/80 overflow-hidden mb-2">
                      <div
                        className={cn('h-full rounded-full transition-all', riskBarColor(svc.confidence))}
                        style={{ width: `${Math.max(svc.confidence, 4)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-text-secondary">
                      <span>{svc.active_threats} signal{svc.active_threats !== 1 ? 's' : ''}</span>
                      <span>{svc.eta_minutes > 0 ? `ETA ${formatEta(svc.eta_minutes)}` : 'Stable'}</span>
                    </div>
                  </button>
                );
              })}
        </div>
      </Card>

      {/* Active conditions strip */}
      <Card>
        <CardHeader className="pb-2">
          <button
            type="button"
            onClick={() => openDrill({ panel: 'live-conditions' })}
            className="w-full text-left group"
          >
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-warning" />
              Live Alert Conditions
              <span className="text-[10px] font-normal text-primary opacity-70 group-hover:opacity-100">
                View all →
              </span>
              {analyzedAt && (
                <span className="text-[11px] font-normal text-text-secondary ml-auto">
                  Analyzed {analyzedAt}
                </span>
              )}
            </CardTitle>
          </button>
        </CardHeader>
        <div className="px-5 pb-4">
          {loading ? (
            <div className="h-8 bg-card-hover rounded animate-pulse" />
          ) : activeConditions.length === 0 ? (
            <p className="text-sm text-text-secondary">No active alert conditions</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeConditions.map((c) => (
                <button
                  key={c.title}
                  type="button"
                  onClick={() => openDrill({ panel: 'live-conditions', conditionTitle: c.title })}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card-hover text-xs hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer"
                >
                  {severityBadge(c.severity)}
                  <span className="font-medium text-text-primary">{c.title}</span>
                  {c.count > 1 && (
                    <span className="text-text-secondary">×{c.count}</span>
                  )}
                  <span className="text-text-secondary hidden sm:inline">
                    · {c.entities.slice(0, 2).join(', ')}
                    {c.entities.length > 2 ? ` +${c.entities.length - 2}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Main threat panel */}
      {!loading && detections.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-dashed border-border">
          <ShieldAlert className="h-10 w-10 text-success mx-auto mb-3 opacity-70" />
          <p className="text-text-primary font-medium">No early failure patterns matched</p>
          <p className="text-sm text-text-secondary mt-1">
            Active alerts do not yet align with known incident precursors
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Threat list */}
          <div className="xl:col-span-4 space-y-2">
            <button
              type="button"
              onClick={() => openDrill({ panel: 'ranked-threats' })}
              className="text-xs font-semibold text-text-secondary uppercase tracking-wide px-1 hover:text-primary transition-colors flex items-center gap-1"
            >
              Ranked Threats ({detections.length})
              <span className="text-[10px] normal-case text-primary">· view all</span>
            </button>
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-xl bg-card-hover animate-pulse" />
                ))
              : detections.map((d) => {
                  const stage = STAGE_META[d.progression_stage ?? 'watch'] ?? STAGE_META.watch;
                  const isSelected = selected?.pattern_id === d.pattern_id;
                  return (
                    <button
                      key={d.pattern_id}
                      type="button"
                      onClick={() => openDrill({ panel: 'ranked-threat', patternId: d.pattern_id })}
                      className={cn(
                        'w-full text-left p-4 rounded-xl border transition-all cursor-pointer',
                        isSelected || drill?.patternId === d.pattern_id
                          ? 'border-primary/50 bg-primary/5 shadow-sm'
                          : 'border-border bg-card hover:bg-card-hover hover:border-primary/30'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={cn('text-[10px] font-semibold uppercase', stage.color)}>
                              {stage.label}
                            </span>
                            {d.risk_level && (
                              <Badge variant={RISK_VARIANT[d.risk_level] ?? 'secondary'}>
                                {d.risk_level}
                              </Badge>
                            )}
                          </div>
                          <p className="font-semibold text-text-primary truncate">
                            {d.expected_impacted_service}
                          </p>
                          <p className="text-xs text-text-secondary mt-0.5 truncate">
                            {d.pattern_label ?? d.matched_alerts.join(' + ')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-bold text-critical">{d.confidence}%</p>
                          <p className="text-[10px] text-text-secondary flex items-center justify-end gap-0.5">
                            <Clock className="h-3 w-3" />
                            {formatEta(d.estimated_time_to_incident_minutes)}
                          </p>
                        </div>
                      </div>
                      {d.match_coverage && (
                        <div className="mt-3 flex gap-1">
                          {Array.from({ length: d.match_coverage.total }).map((_, i) => (
                            <div
                              key={i}
                              className={cn(
                                'h-1 flex-1 rounded-full',
                                i < d.match_coverage!.matched ? 'bg-red-500' : 'bg-slate-200 dark:bg-slate-700'
                              )}
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
          </div>

          {/* Detail panel */}
          <div className="xl:col-span-8">
            {selected ? (
              <Card className="overflow-hidden">
                <div className="p-6 border-b border-border bg-gradient-to-r from-red-500/5 via-transparent to-transparent">
                  <div className="flex flex-col sm:flex-row gap-6">
                    <ConfidenceRing value={selected.confidence} selectedDetection={selected} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-critical" />
                        <span className="text-xs font-semibold text-critical uppercase tracking-wide">
                          Probable incident forming
                        </span>
                        {selected.risk_level && (
                          <Badge variant={RISK_VARIANT[selected.risk_level] ?? 'critical'}>
                            {selected.risk_level} risk
                          </Badge>
                        )}
                      </div>
                      <h2 className="text-xl font-bold text-text-primary">
                        {selected.expected_impacted_service}
                      </h2>
                      <p className="text-sm text-text-secondary mt-1">
                        {selected.pattern_label ?? selected.pattern_id}
                      </p>
                      <div className="flex flex-wrap gap-4 mt-4 text-sm">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Clock className="h-4 w-4" />
                          <span>
                            ETA{' '}
                            <strong className="text-text-primary">
                              {formatEta(selected.estimated_time_to_incident_minutes)}
                            </strong>
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <TrendingUp className="h-4 w-4" />
                          <span>
                            Seen{' '}
                            <strong className="text-text-primary">
                              {selected.occurrence_count_historical ?? 0}×
                            </strong>{' '}
                            historically
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {selected.match_coverage && (
                    <div className="mt-5">
                      <PatternCoverageBar
                        matched={selected.match_coverage.matched}
                        total={selected.match_coverage.total}
                      />
                      {selected.match_coverage.unmatched_alerts.length > 0 && (
                        <p className="text-xs text-text-secondary mt-2">
                          Still watching for:{' '}
                          {selected.match_coverage.unmatched_alerts.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-6 space-y-6">
                  {/* Matched alerts table */}
                  {selected.matched_alerts_details && selected.matched_alerts_details.length > 0 && (
                    <section>
                      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
                        Matched Active Alerts
                      </h4>
                      <div className="rounded-lg border border-border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-card-hover text-left text-xs text-text-secondary">
                              <th className="px-4 py-2 font-medium">Alert</th>
                              <th className="px-4 py-2 font-medium hidden sm:table-cell">Entity</th>
                              <th className="px-4 py-2 font-medium">Severity</th>
                              <th className="px-4 py-2 font-medium hidden md:table-cell">Age</th>
                              <th className="px-4 py-2 font-medium text-right">Match</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {selected.matched_alerts_details.map((a) => (
                              <tr key={a.id} className="hover:bg-card-hover/50">
                                <td className="px-4 py-2.5">
                                  <p className="font-medium text-text-primary">{a.title}</p>
                                  {a.pattern_alert !== a.title && (
                                    <p className="text-[11px] text-text-secondary">
                                      Pattern: {a.pattern_alert}
                                    </p>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-text-secondary hidden sm:table-cell font-mono text-xs">
                                  {a.entity_id}
                                </td>
                                <td className="px-4 py-2.5">{severityBadge(a.severity)}</td>
                                <td className="px-4 py-2.5 text-text-secondary hidden md:table-cell text-xs">
                                  {formatAge(a.minutes_ago)}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-xs text-text-primary">
                                  {a.match_score}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  {/* Propagation paths */}
                  {selected.propagation_paths &&
                    Object.keys(selected.propagation_paths).length > 0 && (
                      <section>
                        <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
                          Blast Propagation Paths
                        </h4>
                        <div className="space-y-2">
                          {Object.entries(selected.propagation_paths).map(([entity, path]) => (
                            <div
                              key={entity}
                              className="flex flex-wrap items-center gap-1.5 text-xs p-3 rounded-lg bg-card-hover border border-border"
                            >
                              <span className="font-mono text-text-primary">{entity}</span>
                              {path.map((node, i) => (
                                <span key={`${entity}-${i}`} className="flex items-center gap-1.5">
                                  <ArrowRight className="h-3 w-3 text-text-secondary" />
                                  <span className="font-mono text-text-secondary">{node}</span>
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                  {/* Expected symptoms + correlated changes */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <section>
                      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
                        Expected Next Symptoms
                      </h4>
                      <ul className="space-y-1.5">
                        {selected.expected_symptoms.map((s) => (
                          <li
                            key={s}
                            className="flex items-center gap-2 text-sm text-text-secondary"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </section>

                    {selected.correlated_changes && selected.correlated_changes.length > 0 && (
                      <section>
                        <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
                          Correlated Changes (24h)
                        </h4>
                        <ul className="space-y-2">
                          {selected.correlated_changes.map((c) => (
                            <li
                              key={c.id}
                              className="p-2.5 rounded-lg border border-border bg-card-hover text-sm"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-text-primary truncate">
                                  {c.title}
                                </span>
                                {severityBadge(c.severity)}
                              </div>
                              <p className="text-xs text-text-secondary mt-1">
                                {c.type.replace('_', ' ')} · {c.status}
                                {c.hours_ago != null && ` · ${c.hours_ago}h ago`}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t border-border">
                    <section>
                      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
                        Recommended Proactive Actions
                      </h4>
                      <ol className="space-y-2">
                        {selected.recommended_actions.map((a, i) => (
                          <li key={a} className="flex gap-2 text-sm text-text-secondary">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                              {i + 1}
                            </span>
                            {a}
                          </li>
                        ))}
                      </ol>
                    </section>
                    <section>
                      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
                        Evidence Collection Plan
                      </h4>
                      <ul className="space-y-1.5">
                        {selected.evidence_collection_plan.map((e) => (
                          <li key={e} className="text-sm text-text-secondary flex gap-2">
                            <span className="text-primary">•</span>
                            {e}
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>
                </div>
              </Card>
            ) : (
              <div className="h-full min-h-[320px] flex items-center justify-center rounded-xl border border-dashed border-border text-text-secondary text-sm">
                Select a threat to view details
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}

      <DrilldownDrawer
        isOpen={drill !== null}
        onClose={closeDrill}
        title={
          drill?.panel === 'active-alerts'
            ? `Active Alerts (${alertsFeed.length})`
            : drill?.panel === 'patterns'
              ? `Matched Patterns (${detections.length})`
              : drill?.panel === 'imminent'
                ? `Imminent Threats (${imminentDetections.length})`
                : drill?.panel === 'eta'
                  ? 'Soonest Predicted Incident'
                  : drill?.panel === 'service-risk-overview'
                    ? 'Service Risk Overview'
                    : drill?.panel === 'service-risk' && drillService
                      ? drillService.service_name
                      : drill?.panel === 'live-conditions' && drillCondition
                        ? `Condition: ${drillCondition.title}`
                        : drill?.panel === 'live-conditions'
                          ? 'Live Alert Conditions'
                          : drill?.panel === 'ranked-threats'
                            ? `Ranked Threats (${detections.length})`
                            : drill?.panel === 'ranked-threat' && drillDetection
                              ? drillDetection.expected_impacted_service
                              : 'Early Detection'
        }
        subtitle={
          drill?.panel === 'active-alerts'
            ? `${criticalFeed.length} critical signals requiring clearance`
            : drill?.panel === 'eta' && soonestDetection
              ? `${soonestDetection.expected_impacted_service} · ${formatEta(soonestDetection.estimated_time_to_incident_minutes)}`
              : drill?.panel === 'service-risk' && drillService
                ? `${drillService.risk_level} risk · ${drillService.active_threats} signals · ETA ${formatEta(drillService.eta_minutes)}`
                : drill?.panel === 'live-conditions' && drillCondition
                  ? `${drillCondition.count} occurrences on ${drillCondition.entities.join(', ')}`
                  : drill?.panel === 'ranked-threat' && drillDetection
                    ? `${drillDetection.confidence}% confidence · ETA ${formatEta(drillDetection.estimated_time_to_incident_minutes)}`
                    : undefined
        }
        type="incident"
        health={
          (drill?.panel === 'active-alerts' && criticalFeed.length > 0) ||
          (drill?.panel === 'imminent' && imminentDetections.length > 0) ||
          (drill?.panel === 'service-risk' && drillService && drillService.risk_level !== 'Healthy') ||
          (drill?.panel === 'ranked-threat' && drillDetection?.progression_stage === 'imminent')
            ? 'critical'
            : 'warning'
        }
        actions={
          <button
            type="button"
            onClick={runAiAnalysis}
            disabled={aiLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Sparkles className={cn('h-3.5 w-3.5', aiLoading && 'animate-pulse')} />
            {aiLoading ? 'AI analyzing…' : 'Auto-analyze'}
          </button>
        }
      >
        {drill && (
          <AiSuggestionsBlock
            loading={aiLoading}
            response={aiResponse}
            fallbackPlan={clearancePlan}
            chatHistory={aiChat}
            suggestedQuestions={suggestedQuestions}
            onAskAi={runAiAnalysis}
            onAskQuestion={(q) => runAiQuery(q, true)}
          />
        )}

        {drill?.panel === 'active-alerts' && (
          <>
            <DrilldownSection title="Critical signals" icon={<AlertTriangle className="h-4 w-4" />}>
              {criticalFeed.length === 0 ? (
                <p className="text-sm text-text-secondary">No critical alerts — showing all active signals below.</p>
              ) : (
                <div className="space-y-3">
                  {criticalFeed.map((alert) => (
                    <AlertFeedRow key={alert.id} alert={alert} onSelectDetection={jumpToDetection} />
                  ))}
                </div>
              )}
            </DrilldownSection>
            {alertsFeed.length > criticalFeed.length && (
              <DrilldownSection title="Warning & info signals">
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {alertsFeed
                    .filter((a) => a.severity !== 'critical')
                    .slice(0, 12)
                    .map((alert) => (
                      <AlertFeedRow key={alert.id} alert={alert} onSelectDetection={jumpToDetection} />
                    ))}
                </div>
              </DrilldownSection>
            )}
          </>
        )}

        {drill?.panel === 'patterns' && (
          <>
            <DrilldownSection title="Matched precursor patterns">
              <div className="space-y-3">
                {detections.map((d) => (
                  <button
                    key={d.pattern_id}
                    type="button"
                    onClick={() => jumpToDetection(d.pattern_id)}
                    className="w-full text-left p-3 rounded-lg border border-border bg-card-hover hover:border-primary/30 transition-colors"
                  >
                    <div className="flex justify-between gap-2 mb-1">
                      <span className="font-medium text-text-primary text-sm">{d.expected_impacted_service}</span>
                      <Badge variant={RISK_VARIANT[d.risk_level ?? 'Medium'] ?? 'warning'}>{d.confidence}%</Badge>
                    </div>
                    <p className="text-xs text-text-secondary">{d.pattern_label}</p>
                    <p className="text-xs text-text-secondary mt-1">
                      Coverage {d.match_coverage?.matched}/{d.match_coverage?.total} · ETA {formatEta(d.estimated_time_to_incident_minutes)}
                    </p>
                  </button>
                ))}
              </div>
            </DrilldownSection>
          </>
        )}

        {drill?.panel === 'imminent' && (
          <>
            <DrilldownSection title="Imminent incident precursors">
              {imminentDetections.length === 0 ? (
                <p className="text-sm text-text-secondary">No threats at imminent stage right now.</p>
              ) : (
                <div className="space-y-3">
                  {imminentDetections.map((d) => (
                    <div key={d.pattern_id} className="p-3 rounded-lg border border-critical/30 bg-critical/5">
                      <div className="flex justify-between mb-2">
                        <span className="font-semibold text-text-primary">{d.expected_impacted_service}</span>
                        <Badge variant="critical">ETA {formatEta(d.estimated_time_to_incident_minutes)}</Badge>
                      </div>
                      <ul className="space-y-1">
                        {d.recommended_actions.slice(0, 3).map((a) => (
                          <li key={a} className="text-xs text-text-secondary flex gap-1.5">
                            <span className="text-critical">→</span>
                            {a}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => jumpToDetection(d.pattern_id)}
                        className="text-xs text-primary hover:underline mt-2"
                      >
                        View full threat analysis
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </DrilldownSection>
          </>
        )}

        {drill?.panel === 'eta' && soonestDetection && (
          <>
            <DrilldownSection title="Highest urgency threat">
              <div className="p-4 rounded-lg border border-critical/30 bg-critical/5">
                <p className="text-lg font-bold text-text-primary">{soonestDetection.expected_impacted_service}</p>
                <p className="text-sm text-text-secondary mt-1">{soonestDetection.pattern_label}</p>
                <div className="flex gap-4 mt-3 text-sm">
                  <span className="text-critical font-semibold">
                    ETA {formatEta(soonestDetection.estimated_time_to_incident_minutes)}
                  </span>
                  <span className="text-text-secondary">{soonestDetection.confidence}% confidence</span>
                </div>
                {soonestDetection.match_coverage && (
                  <div className="mt-3">
                    <PatternCoverageBar
                      matched={soonestDetection.match_coverage.matched}
                      total={soonestDetection.match_coverage.total}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => jumpToDetection(soonestDetection.pattern_id)}
                  className="mt-3 text-sm text-primary hover:underline"
                >
                  Open threat detail panel
                </button>
              </div>
            </DrilldownSection>
            <DrilldownSection title="Immediate playbook">
              <ol className="space-y-2">
                {soonestDetection.recommended_actions.map((a, i) => (
                  <li key={a} className="flex gap-2 text-sm text-text-secondary">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    {a}
                  </li>
                ))}
              </ol>
            </DrilldownSection>
          </>
        )}

        {drill?.panel === 'service-risk-overview' && (
          <DrilldownSection title="All services" icon={<Target className="h-4 w-4" />}>
            <div className="space-y-2">
              {serviceRisks.map((svc) => {
                const stage = STAGE_META[svc.progression_stage] ?? STAGE_META.watch;
                return (
                  <button
                    key={svc.service_id}
                    type="button"
                    onClick={() => openDrill({ panel: 'service-risk', serviceId: svc.service_id })}
                    className={cn(
                      'w-full text-left p-3 rounded-lg border transition-colors hover:border-primary/30',
                      stage.bg
                    )}
                  >
                    <div className="flex justify-between gap-2 mb-1">
                      <span className="font-medium text-text-primary text-sm">{svc.service_name}</span>
                      <Badge variant={RISK_VARIANT[svc.risk_level] ?? 'secondary'}>{svc.risk_level}</Badge>
                    </div>
                    <div className="h-1 rounded-full bg-slate-200/80 dark:bg-slate-700/80 overflow-hidden mb-1">
                      <div className={cn('h-full rounded-full', riskBarColor(svc.confidence))} style={{ width: `${Math.max(svc.confidence, 4)}%` }} />
                    </div>
                    <p className="text-xs text-text-secondary">
                      {svc.active_threats} signals · {svc.eta_minutes > 0 ? `ETA ${formatEta(svc.eta_minutes)}` : 'Stable'}
                    </p>
                  </button>
                );
              })}
            </div>
          </DrilldownSection>
        )}

        {drill?.panel === 'service-risk' && drillService && drill.serviceId && (
          <>
            <DrilldownSection title="Service risk profile">
              <div className={cn('p-4 rounded-lg border', STAGE_META[drillService.progression_stage]?.bg ?? 'border-border')}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="text-lg font-bold text-text-primary">{drillService.service_name}</p>
                    <p className="text-xs text-text-secondary mt-1 capitalize">{drillService.progression_stage} stage</p>
                  </div>
                  <Badge variant={RISK_VARIANT[drillService.risk_level] ?? 'secondary'}>{drillService.risk_level}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center text-xs">
                  <div className="p-2 rounded-lg bg-card/80">
                    <p className="font-bold text-text-primary text-lg">{drillService.confidence}%</p>
                    <p className="text-text-secondary">Risk score</p>
                  </div>
                  <div className="p-2 rounded-lg bg-card/80">
                    <p className="font-bold text-text-primary text-lg">{drillService.active_threats}</p>
                    <p className="text-text-secondary">Signals</p>
                  </div>
                  <div className="p-2 rounded-lg bg-card/80">
                    <p className="font-bold text-text-primary text-lg">{formatEta(drillService.eta_minutes)}</p>
                    <p className="text-text-secondary">ETA</p>
                  </div>
                </div>
              </div>
            </DrilldownSection>
            {detections.find((d) => d.expected_impacted_service_id === drill.serviceId) && (
              <DrilldownSection title="Linked threat pattern">
                {(() => {
                  const d = detections.find((det) => det.expected_impacted_service_id === drill.serviceId)!;
                  return (
                    <button
                      type="button"
                      onClick={() => openDrill({ panel: 'ranked-threat', patternId: d.pattern_id })}
                      className="w-full text-left p-3 rounded-lg border border-border bg-card-hover hover:border-primary/30"
                    >
                      <p className="font-medium text-text-primary">{d.pattern_label}</p>
                      <p className="text-xs text-text-secondary mt-1">
                        {d.confidence}% · ETA {formatEta(d.estimated_time_to_incident_minutes)}
                      </p>
                    </button>
                  );
                })()}
              </DrilldownSection>
            )}
            <DrilldownSection title="Related active alerts">
              {serviceAlerts(drill.serviceId).length === 0 ? (
                <p className="text-sm text-text-secondary">No direct alerts on this service.</p>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {serviceAlerts(drill.serviceId).slice(0, 10).map((alert) => (
                    <AlertFeedRow key={alert.id} alert={alert} onSelectDetection={jumpToDetection} />
                  ))}
                </div>
              )}
            </DrilldownSection>
          </>
        )}

        {drill?.panel === 'live-conditions' && !drill.conditionTitle && (
          <DrilldownSection title="All conditions" icon={<Zap className="h-4 w-4" />}>
            <div className="flex flex-wrap gap-2 mb-4">
              {activeConditions.map((c) => (
                <button
                  key={c.title}
                  type="button"
                  onClick={() => openDrill({ panel: 'live-conditions', conditionTitle: c.title })}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card-hover hover:border-primary/40 text-xs"
                >
                  {severityBadge(c.severity)}
                  <span className="font-medium">{c.title}</span>
                  <span className="text-text-secondary">×{c.count}</span>
                </button>
              ))}
            </div>
          </DrilldownSection>
        )}

        {drill?.panel === 'live-conditions' && drill.conditionTitle && drillCondition && (
          <DrilldownSection title={`${drillCondition.title} occurrences`}>
            <p className="text-sm text-text-secondary mb-3">
              Affects: {drillCondition.entities.join(', ')}
            </p>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {conditionAlerts(drill.conditionTitle).map((alert) => (
                <AlertFeedRow key={alert.id} alert={alert} onSelectDetection={jumpToDetection} />
              ))}
            </div>
          </DrilldownSection>
        )}

        {drill?.panel === 'ranked-threats' && (
          <DrilldownSection title="All ranked threats">
            <div className="space-y-2">
              {detections.map((d, idx) => (
                <button
                  key={d.pattern_id}
                  type="button"
                  onClick={() => openDrill({ panel: 'ranked-threat', patternId: d.pattern_id })}
                  className="w-full text-left p-3 rounded-lg border border-border bg-card-hover hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-text-secondary">#{idx + 1}</span>
                    <span className="font-medium text-text-primary text-sm flex-1">{d.expected_impacted_service}</span>
                    <Badge variant={RISK_VARIANT[d.risk_level ?? 'Medium'] ?? 'warning'}>{d.confidence}%</Badge>
                  </div>
                  <p className="text-xs text-text-secondary pl-6">
                    {d.pattern_label} · ETA {formatEta(d.estimated_time_to_incident_minutes)}
                  </p>
                </button>
              ))}
            </div>
          </DrilldownSection>
        )}

        {drill?.panel === 'ranked-threat' && drillDetection && (
          <>
            <DrilldownSection title="Threat summary">
              <div className="p-4 rounded-lg border border-critical/20 bg-critical/5">
                <div className="flex flex-wrap gap-2 mb-2">
                  <Badge variant={RISK_VARIANT[drillDetection.risk_level ?? 'High'] ?? 'critical'}>
                    {drillDetection.risk_level}
                  </Badge>
                  <Badge variant="secondary">{drillDetection.progression_stage}</Badge>
                </div>
                <p className="font-bold text-text-primary">{drillDetection.expected_impacted_service}</p>
                <p className="text-sm text-text-secondary mt-1">{drillDetection.pattern_label}</p>
                {drillDetection.match_coverage && (
                  <div className="mt-3">
                    <PatternCoverageBar
                      matched={drillDetection.match_coverage.matched}
                      total={drillDetection.match_coverage.total}
                    />
                  </div>
                )}
              </div>
            </DrilldownSection>
            {drillDetection.matched_alerts_details && drillDetection.matched_alerts_details.length > 0 && (
              <DrilldownSection title="Matched alerts">
                <div className="space-y-2">
                  {drillDetection.matched_alerts_details.map((a) => (
                    <div key={a.id} className="flex justify-between items-center p-2 rounded-lg bg-card-hover text-sm">
                      <div>
                        <p className="font-medium text-text-primary">{a.title}</p>
                        <p className="text-xs text-text-secondary font-mono">{a.entity_id}</p>
                      </div>
                      {severityBadge(a.severity)}
                    </div>
                  ))}
                </div>
              </DrilldownSection>
            )}
            <DrilldownSection title="Recommended actions">
              <ol className="space-y-2">
                {drillDetection.recommended_actions.map((a, i) => (
                  <li key={a} className="flex gap-2 text-sm text-text-secondary">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    {a}
                  </li>
                ))}
              </ol>
            </DrilldownSection>
            <button
              type="button"
              onClick={() => jumpToDetection(drillDetection.pattern_id)}
              className="text-sm text-primary hover:underline"
            >
              Open in main detail panel →
            </button>
          </>
        )}
      </DrilldownDrawer>
    </div>
  );
}