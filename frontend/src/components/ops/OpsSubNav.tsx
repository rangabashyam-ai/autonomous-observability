import {
  Activity,
  AlertCircle,
  Box,
  Briefcase,
  Cloud,
  Container,
  Cpu,
  Database,
  GitBranch,
  Globe,
  HardDrive,
  LayoutDashboard,
  MessageSquare,
  Network,
  Server,
  Shield,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/cn';

interface OpsSubNavProps {
  items: { id: string; label: string }[];
  activeId: string;
  onChange: (id: string) => void;
  perspective?: 'service' | 'platform';
}

const SECTION_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  business_services: Briefcase,
  applications: Box,
  apis: Globe,
  workers: Workflow,
  batch_jobs: Cpu,
  pipelines: GitBranch,
  ai_services: Sparkles,
  dependencies: Network,
  transactions: Activity,
  traces: GitBranch,
  incidents: AlertCircle,
  slo_sla: Activity,
  deployments: GitBranch,
  security: Shield,
  cost: Briefcase,
  inventory: Server,
  compute: Cpu,
  containers: Container,
  cloud: Cloud,
  virtualization: Server,
  networking: Network,
  storage: HardDrive,
  runtime: Cpu,
  databases: Database,
  messaging: MessageSquare,
  data_platforms: Database,
  serverless: Cloud,
  capacity: Activity,
  platform_health: Activity,
};

export default function OpsSubNav({ items, activeId, onChange, perspective = 'service' }: OpsSubNavProps) {
  const overview = items.find((i) => i.id === 'overview');
  const rest = items.filter((i) => i.id !== 'overview');

  return (
    <aside className="w-52 shrink-0 sticky top-4 self-start max-h-[calc(100vh-6rem)] flex flex-col">
      <nav
        className="flex flex-col rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
        aria-label="Operations sections"
      >
        {/* Header strip */}
        <div className="px-4 pt-4 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
              <LayoutDashboard className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary leading-none">
              {perspective === 'service' ? 'Service Ops' : 'Platform Ops'}
            </p>
          </div>
        </div>

        {/* Scrollable nav items */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {overview && (
            <NavButton item={overview} activeId={activeId} onChange={onChange} isOverview />
          )}

          {rest.length > 0 && (
            <p className="px-3 pt-3 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-text-secondary/50">
              Sections
            </p>
          )}
          {rest.map((item) => (
            <NavButton key={item.id} item={item} activeId={activeId} onChange={onChange} />
          ))}
        </div>
      </nav>
    </aside>
  );
}

function NavButton({
  item,
  activeId,
  onChange,
  isOverview = false,
}: {
  item: { id: string; label: string };
  activeId: string;
  onChange: (id: string) => void;
  isOverview?: boolean;
}) {
  const Icon = SECTION_ICONS[item.id] ?? Activity;
  const active = activeId === item.id;

  return (
    <button
      type="button"
      onClick={() => onChange(item.id)}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150',
        active
          ? 'bg-primary text-white shadow-md shadow-primary/20'
          : 'text-text-secondary hover:text-text-primary hover:bg-card-hover',
        isOverview && !active && 'mb-1'
      )}
    >
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0 transition-colors',
          active ? 'text-white' : 'text-primary/60'
        )}
      />
      <span className="truncate leading-none">{item.label}</span>
      {active && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/70 shrink-0" />
      )}
    </button>
  );
}
