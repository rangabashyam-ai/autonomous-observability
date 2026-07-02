import {
  Activity,
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
  incidents: Activity,
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
    <aside className="w-56 shrink-0 sticky top-4 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
      <nav className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden" aria-label="Operations sections">
        <div className="px-3 py-2.5 border-b border-border bg-gradient-to-r from-primary/10 to-transparent">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            {perspective === 'service' ? 'Service Operations' : 'Platform Operations'}
          </p>
        </div>

        <div className="p-2 space-y-0.5">
          {overview && (
            <NavButton item={overview} activeId={activeId} onChange={onChange} />
          )}

          {rest.length > 0 && (
            <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/70">
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
}: {
  item: { id: string; label: string };
  activeId: string;
  onChange: (id: string) => void;
}) {
  const Icon = SECTION_ICONS[item.id] ?? Activity;
  const active = activeId === item.id;

  return (
    <button
      type="button"
      onClick={() => onChange(item.id)}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all',
        active
          ? 'bg-primary text-white shadow-sm'
          : 'text-text-secondary hover:text-text-primary hover:bg-card-hover'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-white' : 'text-primary/70')} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}
