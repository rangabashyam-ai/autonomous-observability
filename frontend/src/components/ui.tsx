/** Primary readable text (headings, values, titles) */
export const textPrimary = 'text-slate-900 dark:text-white';

/** Secondary body text */
export const textSecondary = 'text-slate-700 dark:text-slate-300';

/** Muted / helper / label text */
export const textMuted = 'text-slate-600 dark:text-slate-400';

/** Form labels */
export const textLabel = 'text-slate-600 dark:text-slate-400';

/** Links and interactive accents */
export const textLink = 'text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300';

/** Semantic status colors */
export const textDanger = 'text-red-700 dark:text-red-400';
export const textSuccess = 'text-emerald-700 dark:text-green-400';
export const textWarning = 'text-amber-700 dark:text-yellow-400';
export const textAccent = 'text-violet-700 dark:text-purple-400';
export const textInfo = 'text-sky-700 dark:text-blue-400';

export function severityClass(sev: string): string {
  if (sev === 'P1' || sev.startsWith('1')) return 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-400 border-red-300 dark:border-red-500/40';
  if (sev === 'P2' || sev.startsWith('2')) return 'bg-orange-100 dark:bg-orange-500/20 text-orange-800 dark:text-orange-400 border-orange-300 dark:border-orange-500/40';
  if (sev === 'P3' || sev.startsWith('3')) return 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-900 dark:text-yellow-400 border-yellow-300 dark:border-yellow-500/40';
  return 'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-400 border-slate-300 dark:border-slate-500/40';
}

export function confidenceColor(c: number): string {
  if (c >= 80) return 'bg-red-500';
  if (c >= 60) return 'bg-yellow-500';
  return 'bg-blue-500';
}

export function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && (
        <div className="flex justify-between text-xs mb-1">
          <span className={textMuted}>{label}</span>
          <span className={`${textPrimary} font-mono`}>{value}%</span>
        </div>
      )}
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${confidenceColor(value)} rounded-full transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function StatCard({ label, value, sub, alert }: { label: string; value: string | number; sub?: string; alert?: boolean }) {
  return (
    <div className={`p-4 rounded-xl border ${
      alert
        ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-500/30'
        : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
    }`}>
      <p className={`text-xs ${textMuted} mb-1`}>{label}</p>
      <p className={`text-2xl font-bold ${alert ? 'text-red-700 dark:text-red-400' : textPrimary}`}>{value}</p>
      {sub && <p className={`text-xs ${textMuted} mt-1`}>{sub}</p>}
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className={`text-xl font-semibold ${textPrimary}`}>{title}</h2>
      <p className={`text-sm ${textMuted} mt-1`}>{description}</p>
    </div>
  );
}

export function TagList({ items, color = 'blue' }: { items: string[]; color?: string }) {
  const cls =
    color === 'red'
      ? 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-transparent'
      : color === 'yellow'
        ? 'bg-amber-100 dark:bg-yellow-500/20 text-amber-900 dark:text-yellow-300 border border-amber-200 dark:border-transparent'
        : 'bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-transparent';
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className={`text-xs px-2 py-0.5 rounded ${cls}`}>{item}</span>
      ))}
    </div>
  );
}

export const inputClass =
  'px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500';

export const selectClass = inputClass;

export const panelClass = 'p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl';

export const graphContainer = 'bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden';

export const emptyState = `p-8 text-center ${textMuted} border border-dashed border-slate-300 dark:border-slate-700 rounded-xl`;

export const btnPrimary = 'px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50';

export const btnSecondary =
  'px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300';

export const sectionTitle = `text-sm font-semibold ${textPrimary}`;

export const mutedText = textMuted;

export const tableHeader = `text-left ${textMuted} border-b border-slate-200 dark:border-slate-700`;

export const tableRow = 'border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40';

export const tableCell = textSecondary;

export const tableCellMuted = textMuted;

export const tableCellLink = `font-mono text-xs ${textLink}`;

export const statusBadge = {
  success: 'bg-emerald-100 dark:bg-green-500/20 text-emerald-800 dark:text-green-400',
  warning: 'bg-amber-100 dark:bg-yellow-500/20 text-amber-900 dark:text-yellow-400',
  info: 'bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-400',
  danger: 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-400',
};
