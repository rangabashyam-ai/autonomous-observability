/**
 * InvestigationWorkflow.tsx
 *
 * Premium dark-glass UI for the Autonomous Investigation Workflow page.
 *
 * Dependencies:
 *   npm install framer-motion --save
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import { SERVICES } from '../constants/services';
import {
  copilotChat,
  startInvestigation,
  advanceInvestigation,
  approveInvestigation,
  executeInvestigation,
} from '../api/client';
import type { CopilotContextPayload, CopilotResponse } from '../ai/types';
import type { Investigation, InvestigationStep } from '../types/intelligence';

/* ─── Preset scenarios ──────────────────────────────────────────────────── */
const PRESETS = [
  {
    alerts: ['CPU Saturation', 'API Error Spike'],
    symptoms: ['Latency Increase', 'Retry Storm'],
    service: 'payment-authorization',
    icon: '💳',
    color: 'from-violet-500 to-purple-700',
    glowColor: 'shadow-violet-500/25',
  },
  {
    alerts: ['Queue Buildup Alert', 'CPU Saturation'],
    symptoms: ['Queue Buildup', 'Latency Increase'],
    service: 'settlement-processing',
    icon: '⚙️',
    color: 'from-blue-500 to-cyan-600',
    glowColor: 'shadow-blue-500/25',
  },
  {
    alerts: ['Packet Loss'],
    symptoms: ['Timeout Increase', 'Connection Refused'],
    service: 'api-gateway-services',
    icon: '🌐',
    color: 'from-emerald-500 to-teal-600',
    glowColor: 'shadow-emerald-500/25',
  },
];

/* ─── Step status helpers ────────────────────────────────────────────────── */
const statusConfig = {
  completed: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
    ring: 'border-emerald-400',
    bg: 'bg-emerald-500/20',
    text: 'text-emerald-400',
    row: 'bg-emerald-500/5 border-emerald-500/10',
  },
  in_progress: {
    icon: (
      <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse block" />
    ),
    ring: 'border-blue-400',
    bg: 'bg-blue-500/20',
    text: 'text-blue-400',
    row: 'bg-blue-500/10 border-blue-500/30',
  },
  pending: {
    icon: <span className="w-2 h-2 rounded-full bg-slate-500 dark:bg-slate-600 block" />,
    ring: 'border-border',
    bg: 'bg-card/90 dark:bg-slate-700/30',
    text: 'text-text-secondary',
    row: 'bg-transparent border-transparent',
  },
};

function StepRow({ step, index, onClick }: { step: InvestigationStep; index: number; onClick?: () => void }) {
  const cfg = statusConfig[step.status as keyof typeof statusConfig] ?? statusConfig.pending;
  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: step.status === 'pending' ? 0.4 : 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm transition-all ${cfg.row} ${onClick ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800' : ''}`}
    >
      <div className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center ${cfg.ring} ${cfg.bg} ${cfg.text}`}>
        {cfg.icon}
      </div>
      <span className={`font-medium ${step.status === 'pending' ? 'text-text-secondary' : 'text-text-primary'}`}>
        {step.label}
      </span>
      {step.status === 'in_progress' && (
        <span className="ml-auto text-xs text-blue-400 font-semibold tracking-wide animate-pulse">
          RUNNING…
        </span>
      )}
      {step.status === 'completed' && step.completed_at && (
        <span className="ml-auto text-[10px] text-text-secondary">
          {new Date(step.completed_at).toLocaleTimeString()}
        </span>
      )}
    </motion.div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <motion.button
      onClick={copy}
      whileTap={{ scale: 0.9 }}
      className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card/80 hover:bg-card-hover border border-border text-xs text-text-secondary transition-all"
    >
      <AnimatePresence mode="wait">
        {copied ? (
          <motion.span key="ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-emerald-400">
            ✓ Copied
          </motion.span>
        ) : (
          <motion.span key="cp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            📋 Copy
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function GlassCard({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      onClick={onClick}
      className={`rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-5 shadow-xl ${className} ${onClick ? 'cursor-pointer' : ''}`}
    >
      {children}
    </motion.div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-emerald-400' : value >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="mt-2 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className={`h-full rounded-full ${color}`}
      />
    </div>
  );
}

async function generateWorkflowAiRecommendations(investigation: Investigation): Promise<CopilotResponse> {
  const completed = investigation.steps.filter((s) => s.status === 'completed').map((s) => s.label);
  const pending = investigation.steps.filter((s) => s.status === 'pending').map((s) => s.label);
  const context: CopilotContextPayload = {
    context_scope: 'strict',
    page_type: 'workflow',
    selected_entity: investigation.id,
    entity_data: {
      investigation_id: investigation.id,
      workflow_state: investigation.status,
      current_step: investigation.current_step,
    },
    related_metrics: {},
    related_alerts: [],
    related_incidents: [],
    dependency_data: {},
    analysis_results: { rca: investigation.rca_result, blast: investigation.blast_result },
    investigation_results: {
      workflow_state: investigation.status,
      completed_steps: completed,
      pending_steps: pending,
      recommended_action: investigation.recommended_fix,
      approval_required: investigation.status === 'awaiting_approval',
      current_step: investigation.current_step,
    },
    user_question:
      'Generate one concise remediation recommendation based on this investigation workflow, including root cause and blast radius context.',
  };

  return copilotChat(context, [
    {
      role: 'user',
      content:
        'Provide a single AI-generated remediation recommendation for this investigation workflow. Use the analysis and workflow context to keep it actionable and concrete.',
    },
  ]);
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function InvestigationWorkflow() {
  const [inv, setInv] = useState<Investigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const [aiResponse, setAiResponse] = useState<CopilotResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [leftFixExpanded, setLeftFixExpanded] = useState(false);

  const completedCount = inv ? inv.steps.filter((s) => s.status === 'completed').length : 0;
  const totalCount = inv ? inv.steps.length : 0;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Custom investigation state
  const [showCustom, setShowCustom] = useState(false);
  const [customDesc, setCustomDesc] = useState('');
  const [customSvc, setCustomSvc] = useState('');
  const [fetchedInvId, setFetchedInvId] = useState<string | null>(null);

  const recommendFixStep = useMemo(
    () => inv?.steps.find((s) => s.label.toLowerCase().includes('recommend')),
    [inv?.steps]
  );
  const showLeftRecommendedFix = !!recommendFixStep && recommendFixStep.status !== 'pending';
  const isRecommendFixActive = !!recommendFixStep && (recommendFixStep.status === 'in_progress' || inv?.current_step?.toLowerCase().includes('recommend'));

  useEffect(() => {
    if (showLeftRecommendedFix) {
      setLeftFixExpanded(true);
    }
  }, [showLeftRecommendedFix]);

  const start = async (preset: { alerts: string[]; symptoms: string[]; service: string }, idx: number) => {
    setActivePreset(idx);
    setShowCustom(false);
    setLoading(true);
    // Reset AI states immediately when starting a new scenario
    setAiResponse(null);
    setAiLoading(true);
    setAiUnavailable(false);
    setFetchedInvId(null);
    try {
      const result = await startInvestigation(preset);
      setInv(result);
      let current = result;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 400));
        current = await advanceInvestigation(current.id);
        setInv({ ...current });
        if (current.current_step === 'awaiting_human_approval') break;
      }
    } finally {
      setLoading(false);
    }
  };

  const approve = async () => {
    if (!inv) return;
    let updated = await approveInvestigation(inv.id);
    setInv(updated);
    updated = await executeInvestigation(inv.id);
    setInv(updated);
  };

  useEffect(() => {
    if (!inv) {
      setAiResponse(null);
      setAiUnavailable(false);
      setAiLoading(false);
      setFetchedInvId(null);
      return;
    }

    if (inv.id === fetchedInvId) {
      return;
    }

    let mounted = true;
    setAiLoading(true);
    setAiUnavailable(false);
    setAiResponse(null);
    setFetchedInvId(inv.id);

    generateWorkflowAiRecommendations(inv)
      .then((response) => {
        if (!mounted) return;

        const isFallbackError =
          response.model?.startsWith('error-') ||
          response.confidence === '0%' ||
          response.summary?.toLowerCase().includes('temporarily unavailable');

        if (isFallbackError) {
          setAiResponse(null);
          setAiUnavailable(true);
        } else {
          setAiResponse(response);
        }
      })
      .catch(() => {
        if (mounted) {
          setAiUnavailable(true);
          setAiResponse(null);
        }
      })
      .finally(() => {
        if (mounted) setAiLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [inv?.id, fetchedInvId]);

  const copilotContext = useMemo(() => {
    if (!inv) return null;
    const completed = inv.steps.filter((s) => s.status === 'completed').map((s) => s.label);
    const pending = inv.steps.filter((s) => s.status === 'pending').map((s) => s.label);
    return {
      pageType: 'workflow' as const,
      selectedEntity: inv.id,
      investigationResults: {
        workflow_state: inv.status,
        completed_steps: completed,
        pending_steps: pending,
        recommended_action: inv.recommended_fix,
        approval_required: inv.status === 'awaiting_approval',
        current_step: inv.current_step,
      },
      analysisResults: { rca: inv.rca_result, blast: inv.blast_result },
    };
  }, [inv]);

  const aiRecommendedFix = aiResponse?.summary
    ? aiResponse.summary
    : (aiUnavailable ? inv?.recommended_fix : undefined);

  const isShowingBaseline = !aiLoading && aiUnavailable;

  // Gate the Recommended Fix panel: only reveal it once all upstream analysis
  // steps (dependency path, RCA graph, root cause, blast radius, recommend fix)
  // have reached a completed state.
  const allAnalysisStepsComplete = useMemo(() => {
    if (!inv) return false;
    const keywords = ['dependency', 'rca', 'root cause', 'blast', 'recommend'];
    return keywords.every((kw) =>
      inv.steps.some((s) => s.label.toLowerCase().includes(kw) && s.status === 'completed')
    );
  }, [inv]);

  useRegisterCopilotContext(copilotContext);

  return (
    <div className="min-h-screen bg-background text-text-primary p-6 space-y-6">
      {/* ── Header ── */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔍</span>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
            Autonomous Investigation
          </h1>
        </div>
        <p className="text-sm text-text-secondary ml-9">
          AI-driven root cause analysis from issue detection to simulated remediation — no real changes made.
        </p>
      </div>

      {/* ── Preset cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {PRESETS.map((p, i) => (
          <motion.button
            key={i}
            onClick={() => start(p, i)}
            disabled={loading}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className={`relative overflow-hidden rounded-2xl p-5 text-left transition-all border shadow-lg ${activePreset === i
              ? `border-white/30 ${p.glowColor} shadow-xl`
              : 'border-border hover:border-border/80'
              } bg-card/80 backdrop-blur-sm hover:bg-card-hover disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {/* gradient background strip */}
            <div className={`absolute inset-0 opacity-10 bg-gradient-to-br ${p.color}`} />
            <span className="text-2xl block mb-2">{p.icon}</span>
            <p className="font-semibold text-sm text-text-primary capitalize">
              {p.service.replace(/-/g, ' ')}
            </p>
            <p className="text-[11px] text-text-secondary mt-1">
              {p.alerts.length} alert{p.alerts.length !== 1 ? 's' : ''} · {p.symptoms.length} symptom{p.symptoms.length !== 1 ? 's' : ''}
            </p>
            {activePreset === i && loading && (
              <div className={`absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r ${p.color} animate-pulse`} />
            )}
          </motion.button>
        ))}

        {/* Custom Scenario Card */}
        <motion.button
          onClick={() => {
            setActivePreset(3);
            setShowCustom(true);
            setInv(null);
          }}
          disabled={loading}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className={`relative overflow-hidden rounded-2xl p-5 text-left transition-all border shadow-lg ${activePreset === 3
            ? `border-white/30 shadow-slate-500/25 shadow-xl`
            : 'border-border hover:border-border/80'
            } bg-card/80 backdrop-blur-sm hover:bg-card-hover disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <div className={`absolute inset-0 opacity-10 bg-gradient-to-br from-slate-400 to-slate-600`} />
          <span className="text-2xl block mb-2">✏️</span>
          <p className="font-semibold text-sm text-text-primary capitalize">
            Custom Investigation
          </p>
          <p className="text-[11px] text-text-secondary mt-1">
            Define your own scenario
          </p>
        </motion.button>
      </div>

      {/* ── Custom Investigation Form ── */}
      <AnimatePresence>
        {showCustom && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <GlassCard className="border-slate-500/20 bg-slate-500/5 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">✏️</span>
                  <h3 className="font-semibold text-text-primary">Configure Custom Investigation</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowCustom(false);
                    if (activePreset === 3) setActivePreset(null);
                  }}
                  className="text-text-secondary hover:text-text-primary text-xs"
                >
                  Cancel
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary uppercase mb-1">
                    What would you like to investigate?
                  </label>
                  <textarea
                    value={customDesc}
                    onChange={(e) => setCustomDesc(e.target.value)}
                    placeholder="e.g. CPU Saturation, API Error Spike, Latency Increase"
                    rows={3}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-border bg-background/50 text-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder:text-text-secondary/60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary uppercase mb-1">
                    Target Service (Optional)
                  </label>
                  <select
                    value={customSvc}
                    onChange={(e) => setCustomSvc(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-border bg-background/50 text-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500"
                  >
                    <option value="">Select a service...</option>
                    {SERVICES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/-/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={!customDesc.trim() || loading}
                    onClick={async () => {
                      const parts = customDesc.split(',').map(s => s.trim()).filter(Boolean);
                      const alerts = parts.length > 0 ? [parts[0]] : [customDesc];
                      const symptoms = parts.length > 1 ? parts.slice(1) : [];

                      await start({
                        alerts,
                        symptoms,
                        service: customSvc || 'custom-service',
                      }, 3);
                    }}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-violet-500/20"
                  >
                    🚀 Launch Investigation
                  </motion.button>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Empty state ── */}
      <AnimatePresence>
        {!inv && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card/80 p-16 text-center"
          >
            <span className="text-5xl">🛰️</span>
            <p className="text-text-secondary text-sm">Select a scenario above to launch the AI investigation pipeline.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main investigation panel ── */}
      <AnimatePresence>
        {inv && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 lg:grid-cols-5 gap-5"
          >
            {/* ── Summary / Context Header ── */}
            <GlassCard className="lg:col-span-5 bg-gradient-to-r from-violet-500/10 to-indigo-500/10 border-indigo-500/20 !p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest block mb-1">
                  Active Investigation: {inv.id}
                </span>
                <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
                  <span>🔍</span>
                  {activePreset === 3 ? (
                    <span>Custom Scenario: <span className="text-indigo-300">{customDesc || inv.input.alerts.concat(inv.input.symptoms).join(', ')}</span></span>
                  ) : (
                    <span>Preset Scenario: <span className="text-violet-300 capitalize">{inv.input.service?.replace(/-/g, ' ')}</span></span>
                  )}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <div className="px-2.5 py-1 rounded-lg bg-card/60 border border-border text-text-secondary">
                  <span className="font-semibold text-text-primary">Service:</span> {inv.input.service || 'custom-service'}
                </div>
                <div className="px-2.5 py-1 rounded-lg bg-card/60 border border-border text-text-secondary">
                  <span className="font-semibold text-text-primary">Alerts:</span> {inv.input.alerts.join(', ')}
                </div>
                {inv.input.symptoms?.length > 0 && (
                  <div className="px-2.5 py-1 rounded-lg bg-card/60 border border-border text-text-secondary">
                    <span className="font-semibold text-text-primary">Symptoms:</span> {inv.input.symptoms.join(', ')}
                  </div>
                )}
              </div>
            </GlassCard>
            {/* ── Left: Step timeline (3 cols) ── */}
            <div className="lg:col-span-3 space-y-4">
              {/* Progress bar */}
              <GlassCard className="!p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Pipeline Progress</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${inv.status === 'awaiting_approval'
                    ? 'bg-amber-500/20 text-amber-400'
                    : inv.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-blue-500/20 text-blue-400'
                    }`}>
                    {inv.status.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.6 }}
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 via-blue-500 to-cyan-500"
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <p className="text-[11px] text-text-secondary">{completedCount} / {totalCount} steps done</p>
                  <p className="text-[11px] font-semibold text-text-primary">{progressPct}%</p>
                </div>
              </GlassCard>

              {/* Steps list */}
              <GlassCard>
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest mb-3">Investigation Steps</p>
                <div className="space-y-1.5">
                  {inv.steps.map((step, i) => {
                    const isRecommendStep = step.label.toLowerCase().includes('recommend');
                    return (
                      <div key={step.id} className="relative space-y-3">
                        <StepRow
                          step={step}
                          index={i}
                          onClick={isRecommendStep ? () => setLeftFixExpanded((prev) => !prev) : undefined}
                        />
                        {isRecommendStep && showLeftRecommendedFix && leftFixExpanded && (
                          <div className="absolute left-0 right-0 top-full z-20 mt-3">
                            <div className="rounded-2xl border border-blue-500/20 bg-slate-50 dark:bg-slate-950/90 p-4 shadow-xl shadow-blue-500/10 text-sm text-text-primary">
                              <p className="font-semibold">{aiRecommendedFix ?? inv.recommended_fix}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </GlassCard>

              {/* Approve button */}
              {inv.status === 'awaiting_approval' && (
                <motion.button
                  onClick={approve}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-500/20 transition-all"
                >
                  ✅ Approve &amp; Execute Simulated Remediation
                </motion.button>
              )}

              {/* Remediation result */}
              <AnimatePresence>
                {inv.remediation_result && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300 flex items-start gap-3"
                  >
                    <span className="text-xl">🎉</span>
                    <div>
                      <p className="font-semibold text-emerald-400 mb-0.5">Remediation Complete</p>
                      <p>{inv.remediation_result.message}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Right: Analysis cards (2 cols) ── */}
            <div className="lg:col-span-2 space-y-4">
              {/* Root Cause */}
              {inv.rca_result && inv.rca_result.root_cause_candidates[0] && (() => {
                const top = inv.rca_result.root_cause_candidates[0];
                return (
                  <GlassCard>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🎯</span>
                        <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Root Cause</p>
                      </div>
                      <CopyBtn text={`${top.root_cause} (Confidence: ${top.confidence}%)`} />
                    </div>
                    <p className="text-sm font-semibold text-text-primary leading-snug">{top.root_cause}</p>
                    <ConfidenceBar value={top.confidence} />
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-[11px] text-text-secondary">{top.matching_incident_count} matching incidents</p>
                      <p className={`text-sm font-bold ${top.confidence >= 80 ? 'text-emerald-400' : top.confidence >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {top.confidence}% confidence
                      </p>
                    </div>

                    {/* Other candidates */}
                    {inv.rca_result.root_cause_candidates.length > 1 && (
                      <div className="mt-4 pt-4 border-t border-border space-y-2">
                        <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">Other Candidates</p>
                        {inv.rca_result.root_cause_candidates.slice(1, 3).map((c, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-text-secondary truncate mr-2">{c.root_cause}</span>
                            <span className="flex-shrink-0 text-text-secondary font-medium">{c.confidence}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </GlassCard>
                );
              })()}

              {/* Recommended Fix — only shown after all analysis steps complete */}
              {allAnalysisStepsComplete && (
                <GlassCard className="border-emerald-500/20 bg-emerald-500/5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🔧</span>
                      <div>
                        <p className="text-xs font-semibold text-emerald-400 uppercase tracking-widest">AI Recommended Fix</p>
                        {aiLoading ? (
                          <p className="text-[10px] text-text-secondary">Generating AI recommendation…</p>
                        ) : isShowingBaseline ? (
                          <p className="text-[10px] text-text-secondary">Showing investigation fallback guidance</p>
                        ) : (
                          <p className="text-[10px] text-text-secondary">Powered by contextual investigation analysis</p>
                        )}
                      </div>
                    </div>
                    <CopyBtn text={aiRecommendedFix ?? inv.recommended_fix} />
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed">
                    {aiLoading
                      ? 'Generating AI recommendation…'
                      : aiRecommendedFix ?? inv?.recommended_fix}
                  </p>
                  {aiResponse?.confidence && !aiLoading && !aiUnavailable && (
                    <p className="text-[11px] text-text-secondary mt-3">AI confidence: {aiResponse.confidence}</p>
                  )}
                </GlassCard>
              )}

              {/* Blast Radius */}
              {inv.blast_result && (
                <GlassCard className="border-amber-500/20 bg-amber-500/5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">💥</span>
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-widest">Blast Radius</p>
                    </div>
                    <CopyBtn text={`${inv.blast_result.issue_scope} · ${inv.blast_result.severity_recommendation}`} />
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="rounded-xl bg-card/80 p-3">
                      <p className="text-[10px] text-text-secondary mb-1">Scope</p>
                      <p className="text-xs font-semibold text-text-primary capitalize">{inv.blast_result.issue_scope}</p>
                    </div>
                    <div className="rounded-xl bg-card/80 p-3">
                      <p className="text-[10px] text-text-secondary mb-1">Severity</p>
                      <p className="text-xs font-semibold text-amber-300">{inv.blast_result.severity_recommendation}</p>
                    </div>
                    <div className="rounded-xl bg-card/80 p-3">
                      <p className="text-[10px] text-text-secondary mb-1">Business Impact</p>
                      <p className="text-xs font-bold text-red-300">{inv.blast_result.business_impact_score}/10</p>
                    </div>
                    <div className="rounded-xl bg-card/80 p-3">
                      <p className="text-[10px] text-text-secondary mb-1">Est. Customers</p>
                      <p className="text-xs font-semibold text-text-primary">{inv.blast_result.impacted_customers_estimate.toLocaleString()}</p>
                    </div>
                  </div>

                  {inv.blast_result.currently_impacted_services.length > 0 && (
                    <div>
                      <p className="text-[10px] text-text-secondary uppercase tracking-widest mb-2">Impacted Services</p>
                      <div className="flex flex-wrap gap-1.5">
                        {inv.blast_result.currently_impacted_services.slice(0, 6).map((svc, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/20 text-amber-300">
                            {svc}
                          </span>
                        ))}
                        {inv.blast_result.currently_impacted_services.length > 6 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-card/80 text-text-secondary">
                            +{inv.blast_result.currently_impacted_services.length - 6} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </GlassCard>
              )}


            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
