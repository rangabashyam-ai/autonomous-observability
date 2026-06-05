import { cn } from '../../lib/cn';

type BadgeVariant = 'default' | 'success' | 'warning' | 'critical' | 'outline' | 'secondary';

const variants: Record<BadgeVariant, string> = {
  default: 'bg-primary/10 text-primary border-primary/20',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  critical: 'bg-critical/10 text-critical border-critical/20',
  outline: 'bg-transparent text-text-secondary border-border',
  secondary: 'bg-card-hover text-text-secondary border-border',
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = 'default', children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium leading-none',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function HealthBadge({ health }: { health: string }) {
  const h = health.toLowerCase();
  const variant: BadgeVariant =
    h === 'healthy' ? 'success' : h === 'warning' ? 'warning' : h === 'critical' ? 'critical' : 'secondary';
  const label = h === 'healthy' ? 'Healthy' : h === 'warning' ? 'Warning' : h === 'critical' ? 'Critical' : health;
  return <Badge variant={variant}>{label}</Badge>;
}
