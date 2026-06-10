import { motion } from 'framer-motion';
import type { InvestigationStep } from '../types/intelligence';

interface StepCardProps {
  step: InvestigationStep;
}

export default function StepCard({ step }: StepCardProps) {
  const icon =
    step.status === 'completed'
      ? '✓'
      : step.status === 'in_progress'
      ? '●'
      : '○';
  const statusColor =
    step.status === 'completed'
      ? 'text-emerald-600 dark:text-green-400'
      : step.status === 'in_progress'
      ? 'text-blue-700 dark:text-blue-400'
      : 'text-slate-500 dark:text-slate-600';

  return (
    <motion.div
      layout
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
        step.status === 'in_progress'
          ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-500/30'
          : step.status === 'completed'
          ? 'bg-slate-100 dark:bg-slate-900/30'
          : 'opacity-40'
      }`}
    >
      <span className={`w-5 text-center ${statusColor}`}>{icon}</span>
      <span className="text-slate-700 dark:text-slate-300">{step.label}</span>
    </motion.div>
  );
}
