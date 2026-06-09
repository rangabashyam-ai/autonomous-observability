import { useMemo, useState } from 'react';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import {
  startInvestigation,
  advanceInvestigation,
  approveInvestigation,
  executeInvestigation,
} from '../api/client';
import type { Investigation } from '../types/intelligence';
import { PageHeader } from '../components/ui';

const PRESETS = [
  { alerts: ['CPU Saturation', 'API Error Spike'], symptoms: ['Latency Increase', 'Retry Storm'], service: 'payment-authorization' },
  { alerts: ['Queue Buildup Alert', 'CPU Saturation'], symptoms: ['Queue Buildup', 'Latency Increase'], service: 'settlement-processing' },
  { alerts: ['Packet Loss'], symptoms: ['Timeout Increase', 'Connection Refused'], service: 'api-gateway-services' },
];

export default function InvestigationWorkflow() {
  const [inv, setInv] = useState<Investigation | null>(null);
  const [loading, setLoading] = useState(false);

  const start = async (preset: typeof PRESETS[0]) => {
    setLoading(true);
    try {
      const result = await startInvestigation(preset);
      setInv(result);
      // Auto-advance through steps for demo
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

  const stepIcon = (status: string) => {
    if (status === 'completed') return '✓';
    if (status === 'in_progress') return '●';
    return '○';
  };

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
      analysisResults: {
        rca: inv.rca_result,
        blast: inv.blast_result,
      },
    };
  }, [inv]);

  useRegisterCopilotContext(copilotContext);

  return (
    <div>
      <PageHeader
        title="Autonomous Investigation Workflow"
        description="AI-driven investigation from issue detection to simulated remediation (no real changes)"
      />

      <div className="flex gap-3 mb-6">
        {PRESETS.map((p, i) => (
          <button
            key={i}
            onClick={() => start(p)}
            disabled={loading}
            className="px-4 py-2 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-600 rounded-lg hover:border-blue-500 disabled:opacity-50"
          >
            Start: {p.service.replace(/-/g, ' ')}
          </button>
        ))}
      </div>

      {!inv ? (
        <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
          Select a scenario to start an autonomous investigation
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Investigation {inv.id}</h3>
              <span className={`text-xs px-2 py-0.5 rounded ${
                inv.status === 'completed' ? 'bg-emerald-100 dark:bg-green-500/20 text-emerald-800 dark:text-green-400' :
                inv.status === 'awaiting_approval' ? 'bg-amber-100 dark:bg-yellow-500/20 text-amber-900 dark:text-yellow-400' :
                'bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-400'
              }`}>{inv.status}</span>
            </div>

            <div className="space-y-1">
              {inv.steps.map((step) => (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                    step.status === 'in_progress' ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-500/30' :
                    step.status === 'completed' ? 'bg-slate-100 dark:bg-slate-900/30' : 'opacity-40'
                  }`}
                >
                  <span className={`w-5 text-center ${step.status === 'completed' ? 'text-emerald-600 dark:text-green-400' : step.status === 'in_progress' ? 'text-blue-700 dark:text-blue-400' : 'text-slate-500 dark:text-slate-600'}`}>
                    {stepIcon(step.status)}
                  </span>
                  <span className="text-slate-700 dark:text-slate-300">{step.label}</span>
                </div>
              ))}
            </div>

            {inv.status === 'awaiting_approval' && (
              <button
                onClick={approve}
                className="mt-4 w-full py-2.5 bg-green-600 rounded-lg text-sm font-medium hover:bg-green-500"
              >
                Approve & Execute Remediation (Simulated)
              </button>
            )}

            {inv.remediation_result && (
              <div className="mt-4 p-3 bg-emerald-50 dark:bg-green-950/30 border border-emerald-200 dark:border-green-500/30 rounded-lg text-sm text-emerald-800 dark:text-green-300">
                {inv.remediation_result.message}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {inv.rca_result && inv.rca_result.root_cause_candidates[0] && (
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-xs text-slate-600 dark:text-slate-400 mb-1">Top Root Cause</h3>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{inv.rca_result.root_cause_candidates[0].root_cause}</p>
                <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{inv.rca_result.root_cause_candidates[0].confidence}%</p>
              </div>
            )}
            <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
              <h3 className="text-xs text-slate-600 dark:text-slate-400 mb-1">Recommended Fix</h3>
              <p className="text-sm text-emerald-800 dark:text-green-300">{inv.recommended_fix}</p>
            </div>
            {inv.blast_result && (
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-xs text-slate-600 dark:text-slate-400 mb-1">Blast Radius</h3>
                <p className="text-sm text-slate-900 dark:text-white">{inv.blast_result.issue_scope} · {inv.blast_result.severity_recommendation}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {inv.blast_result.currently_impacted_services.slice(0, 3).join(', ')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
