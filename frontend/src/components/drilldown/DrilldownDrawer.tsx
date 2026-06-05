import { X, ExternalLink, AlertTriangle, TrendingUp, Activity, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

interface DrilldownDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  type: 'service' | 'infrastructure' | 'api' | 'incident' | 'node';
  health?: 'healthy' | 'warning' | 'critical';
  children: ReactNode;
  actions?: ReactNode;
}

function getHealthBadge(health?: string) {
  if (!health) return null;
  
  const styles = {
    healthy: 'bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/40',
    warning: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40',
    critical: 'bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40',
  };

  const icons = {
    healthy: '✓',
    warning: '!',
    critical: '✕',
  };

  return (
    <span className={`text-xs px-2 py-1 rounded border font-medium uppercase ${styles[health as keyof typeof styles]}`}>
      {icons[health as keyof typeof icons]} {health}
    </span>
  );
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'service':
      return <Activity className="w-5 h-5" />;
    case 'infrastructure':
      return <Zap className="w-5 h-5" />;
    case 'api':
      return <TrendingUp className="w-5 h-5" />;
    case 'incident':
      return <AlertTriangle className="w-5 h-5" />;
    default:
      return <Activity className="w-5 h-5" />;
  }
}

export default function DrilldownDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  type,
  health,
  children,
  actions,
}: DrilldownDrawerProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full md:w-2/3 lg:w-1/2 xl:w-2/5 bg-white dark:bg-slate-900 shadow-2xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 p-6 z-10">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg text-blue-600 dark:text-blue-400">
                {getTypeIcon(type)}
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2>
                {subtitle && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            {health && getHealthBadge(health)}
            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {type}
            </span>
          </div>

          {actions && (
            <div className="mt-4 flex gap-2">
              {actions}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          {children}
        </div>
      </div>
    </>
  );
}

export function DrilldownSection({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        {icon && <div className="text-slate-600 dark:text-slate-400">{icon}</div>}
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide">
          {title}
        </h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

export function DrilldownMetricCard({ label, value, unit, trend, status }: {
  label: string;
  value: number | string;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  status?: 'good' | 'warning' | 'critical';
}) {
  const statusColors = {
    good: 'text-green-600 dark:text-green-400',
    warning: 'text-amber-600 dark:text-amber-400',
    critical: 'text-red-600 dark:text-red-400',
  };

  const trendIcons = {
    up: '↗',
    down: '↘',
    stable: '→',
  };

  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
      <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className={`text-2xl font-bold ${status ? statusColors[status] : 'text-slate-900 dark:text-white'}`}>
          {value}{unit}
        </p>
        {trend && (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {trendIcons[trend]}
          </span>
        )}
      </div>
    </div>
  );
}

export function DrilldownButton({ onClick, children, variant = 'primary' }: {
  onClick: () => void;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  };

  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

export function DrilldownLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a
      href={to}
      className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
    >
      {children}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

// Made with Bob
