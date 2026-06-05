import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  Server,
  Bot,
  Map,
  AlertTriangle,
  Settings,
  Search,
  Bell,
  Sun,
  Moon,
  ChevronRight,
  Network,
  Shield,
  FileSearch,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { Input } from './ui/input';
import { cn } from '../lib/cn';
import { useState } from 'react';

const primaryNav = [
  { to: '/', label: 'Executive', icon: LayoutDashboard, end: true },
  { to: '/operations', label: 'Service Ops', icon: Activity, end: false },
  { to: '/platform', label: 'Platform', icon: Server, end: false },
  { to: '/copilot', label: 'AI Copilot', icon: Bot, end: false },
];

const secondaryNav = [
  { to: '/dependencies', label: 'Map', icon: Map },
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle },
  { to: '/rca', label: 'RCA', icon: FileSearch },
  { to: '/blast-radius', label: 'Blast Radius', icon: Network },
  { to: '/early-detection', label: 'Early Detection', icon: Shield },
  { to: '/investigation', label: 'Investigation', icon: Activity },
  { to: '/admin', label: 'Settings', icon: Settings },
];

function NavItem({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-card-hover'
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

export default function Layout() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/copilot?q=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-[220px] shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-text-primary leading-tight">Autonomous Ops</h1>
              <p className="text-[10px] text-text-secondary">Enterprise Platform</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/70">
            Dashboards
          </p>
          {primaryNav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}

          <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/70">
            Tools
          </p>
          {secondaryNav.map((item) => (
            <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} />
          ))}
        </nav>

        <div className="p-3 border-t border-border space-y-2">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-border bg-card-hover text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5" />
                Light mode
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" />
                Dark mode
              </>
            )}
          </button>
          <p className="text-[10px] text-text-secondary/60 text-center">Synthetic data · MVP</p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur-md px-6 py-3">
          <div className="flex items-center gap-4">
            <form onSubmit={handleSearch} className="flex-1 max-w-xl relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Global search — services, incidents, metrics..."
                className="pl-9 h-9 bg-background"
              />
            </form>
            <div className="flex items-center gap-2">
              <button
                className="relative h-9 w-9 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-critical" />
              </button>
              <div className="flex items-center gap-2 pl-2 border-l border-border">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
                  OP
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs font-medium text-text-primary">Ops Admin</p>
                  <p className="text-[10px] text-text-secondary">Platform Team</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-text-secondary hidden sm:block" />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
