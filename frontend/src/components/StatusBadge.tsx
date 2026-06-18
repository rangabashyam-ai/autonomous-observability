

interface StatusBadgeProps {
  status: string;
}

const statusMap: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'bg-emerald-100 dark:bg-emerald-900', text: 'text-emerald-800 dark:text-emerald-200' },
  awaiting_approval: { bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-800 dark:text-amber-200' },
  awaiting_human_approval: { bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-800 dark:text-amber-200' },
  in_progress: { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-800 dark:text-blue-200' },
  pending: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-800 dark:text-slate-200' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { bg, text } = statusMap[status] || statusMap['pending'];
  return (
    <span className={`px-2 py-0.5 rounded ${bg} ${text}`}>{status.replace('_', ' ')}</span>
  );
}
