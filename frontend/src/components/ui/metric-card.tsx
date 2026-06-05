import { cn } from '../../lib/cn';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number;
  variant?: 'default' | 'success' | 'warning' | 'critical';
  className?: string;
}

const valueColors = {
  default: 'text-text-primary',
  success: 'text-success',
  warning: 'text-warning',
  critical: 'text-critical',
};

export function MetricCard({ label, value, sub, trend, variant = 'default', className }: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-sm',
        'transition-colors duration-200 hover:bg-card-hover',
        className
      )}
    >
      <p className="text-xs font-medium text-text-secondary mb-2">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <p className={cn('text-3xl font-semibold tracking-tight', valueColors[variant])}>{value}</p>
        {trend !== undefined && (
          <span
            className={cn(
              'flex items-center gap-0.5 text-xs font-medium mb-1',
              trend >= 0 ? 'text-success' : 'text-critical'
            )}
          >
            {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      {sub && <p className="text-xs text-text-secondary mt-1.5">{sub}</p>}
    </div>
  );
}
