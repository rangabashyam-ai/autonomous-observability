import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';

interface CollapsibleSectionProps {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}

export function CollapsibleSection({
  title,
  description,
  defaultOpen = true,
  children,
  className,
  actions,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={cn('space-y-3', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-left group"
        aria-expanded={open}
      >
        <div>
          <h2 className="text-sm font-semibold text-text-primary group-hover:text-primary transition-colors">
            {title}
          </h2>
          {description && <p className="text-xs text-text-secondary mt-0.5">{description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {actions}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-text-secondary transition-transform duration-200',
              open && 'rotate-180'
            )}
          />
        </div>
      </button>
      <div
        className={cn(
          'grid transition-all duration-200 ease-in-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </section>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">{title}</h1>
        {description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Grid12({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid grid-cols-12 gap-4', className)}>{children}</div>
  );
}
