import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
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
  Cloud,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { Input } from './ui/input';
import { cn } from '../lib/cn';
import { useState, useEffect, useRef } from 'react';
import CopilotPanel from './copilot/CopilotPanel';
import { getOverview } from '../api/client';
import type { Overview } from '../types/intelligence';

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
  { to: '/integrations', label: 'Integrations', icon: Cloud },
  { to: '/admin', label: 'Settings', icon: Settings },
];

/* ─── NavItem ────────────────────────────────────────────────────────────── */

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  expanded,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  expanded: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={!expanded ? label : undefined}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 py-2 rounded-lg text-xs font-medium transition-all duration-150',
          expanded ? 'px-3' : 'justify-center px-2',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-card-hover'
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {expanded && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

/* ─── Layout ─────────────────────────────────────────────────────────────── */

export default function Layout() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sidebar expands on hover, collapses when mouse leaves
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  useEffect(() => {
    getOverview().then(setOverview).catch(console.error);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/copilot?q=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-background">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        className={cn(
          'fixed left-0 top-0 h-screen flex flex-col overflow-hidden z-40',
          'border-r border-border bg-card',
          'transition-[width] duration-200 ease-in-out',
          sidebarExpanded ? 'w-[220px]' : 'w-[60px]'
        )}
      >
        {/* Logo row */}
        <div className="h-[60px] border-b border-border flex items-center gap-2.5 px-3 shrink-0">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div
            className={cn(
              'min-w-0 transition-all duration-200',
              sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
            )}
          >
            <h1 className="text-sm font-semibold text-text-primary leading-tight whitespace-nowrap">
              Autonomous Ops
            </h1>
            <p className="text-[10px] text-text-secondary whitespace-nowrap">
              Enterprise Platform
            </p>
          </div>
        </div>

        {/* Nav — fills remaining height, scrolls independently */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {sidebarExpanded ? (
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/70">
              Dashboards
            </p>
          ) : (
            <div className="py-1.5" />
          )}

          {primaryNav.map((item) => (
            <NavItem key={item.to} {...item} expanded={sidebarExpanded} />
          ))}

          {sidebarExpanded ? (
            <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/70">
              Tools
            </p>
          ) : (
            <div className="pt-4" />
          )}

          {secondaryNav.map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              label={item.label}
              icon={item.icon}
              expanded={sidebarExpanded}
            />
          ))}
        </nav>

        {/* Footer — pinned to bottom, never grows */}
        <div className={cn('border-t border-border space-y-2 shrink-0', sidebarExpanded ? 'p-3' : 'p-2')}>
          <button
            onClick={toggleTheme}
            className={cn(
              'w-full flex items-center gap-2 py-2 text-xs font-medium rounded-lg border border-border bg-card-hover text-text-secondary hover:text-text-primary transition-colors',
              sidebarExpanded ? 'px-3 justify-center' : 'justify-center px-2'
            )}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5 shrink-0" />
                {sidebarExpanded && 'Light mode'}
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 shrink-0" />
                {sidebarExpanded && 'Dark mode'}
              </>
            )}
          </button>
          {sidebarExpanded && (
            <p className="text-[10px] text-text-secondary/60 text-center">
              Live cloud telemetry · v0.3
            </p>
          )}
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      {/* ml-[60px] always matches the collapsed sidebar width */}
      <div className="ml-[60px] flex flex-col min-h-screen">
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
            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className={cn(
                    'relative h-9 w-9 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors',
                    showNotifications && 'bg-card-hover text-text-primary border-primary/30'
                  )}
                  aria-label="Notifications"
                  aria-expanded={showNotifications}
                >
                  <Bell className="h-4 w-4" />
                  {overview &&
                    ((overview.summary.active_incidents ?? 0) > 0 ||
                      (overview.summary.open_alerts ?? 0) > 0) && (
                      <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-critical" />
                    )}
                </button>

                {showNotifications && (
                  <div
                    ref={dropdownRef}
                    className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border bg-card shadow-lg z-30 py-3 animate-in fade-in slide-in-from-top-2 duration-200"
                  >
                    <div className="px-4 pb-2.5 border-b border-border flex items-center justify-between">
                      <span className="text-xs font-semibold text-text-primary">
                        Active Alerts &amp; Incidents
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-critical/10 text-critical font-bold">
                        {(overview?.summary.active_incidents ?? 0) +
                          (overview?.summary.open_alerts ?? 0)}{' '}
                        Active
                      </span>
                    </div>
                    <div className="max-h-64 overflow-y-auto px-2 pt-2 divide-y divide-border/50">
                      {!overview ? (
                        <div className="py-6 text-center text-xs text-text-secondary">
                          Loading alerts...
                        </div>
                      ) : overview.recent_incidents.length === 0 &&
                        overview.open_alerts_preview.length === 0 ? (
                        <div className="py-6 text-center text-xs text-text-secondary">
                          No active alerts or incidents
                        </div>
                      ) : (
                        <>
                          {overview.recent_incidents.slice(0, 5).map((inc) => (
                            <div
                              key={inc.incident_id}
                              className="py-2.5 px-2 hover:bg-card-hover rounded-lg transition-colors group text-left"
                            >
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <span
                                  className={cn(
                                    'text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase shrink-0',
                                    inc.severity === 'critical' || inc.severity === 'P1'
                                      ? 'border-critical/30 bg-critical/10 text-critical'
                                      : 'border-warning/30 bg-warning/10 text-warning'
                                  )}
                                >
                                  {inc.severity}
                                </span>
                                <span className="text-[9px] text-text-secondary font-medium truncate">
                                  {inc.service}
                                </span>
                              </div>
                              <p className="text-xs font-semibold text-text-primary group-hover:text-primary transition-colors mb-2 line-clamp-2">
                                {inc.title}
                              </p>
                              <div className="flex gap-1.5">
                                <Link
                                  to={`/rca?id=${inc.incident_id}`}
                                  onClick={() => setShowNotifications(false)}
                                  className="text-[10px] font-bold px-2.5 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                >
                                  RCA
                                </Link>
                                <Link
                                  to={`/blast-radius?id=${inc.incident_id}`}
                                  onClick={() => setShowNotifications(false)}
                                  className="text-[10px] font-semibold px-2.5 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors"
                                >
                                  Blast Radius
                                </Link>
                              </div>
                            </div>
                          ))}

                          {overview.open_alerts_preview.slice(0, 5).map((alert, idx) => (
                            <div
                              key={`alert-${alert.title}-${idx}`}
                              className="py-2.5 px-2 hover:bg-card-hover rounded-lg transition-colors group text-left"
                            >
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <span
                                  className={cn(
                                    'text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase shrink-0',
                                    alert.severity === 'critical'
                                      ? 'border-critical/30 bg-critical/10 text-critical'
                                      : 'border-warning/30 bg-warning/10 text-warning'
                                  )}
                                >
                                  {alert.severity}
                                </span>
                                <span className="text-[9px] text-text-secondary font-medium truncate">
                                  {alert.entity_id}
                                </span>
                              </div>
                              <p className="text-xs font-semibold text-text-primary group-hover:text-primary transition-colors mb-2 line-clamp-2">
                                {alert.title}
                              </p>
                              <div className="flex gap-1.5">
                                <Link
                                  to="/early-detection"
                                  onClick={() => setShowNotifications(false)}
                                  className="text-[10px] font-semibold px-2.5 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors"
                                >
                                  View Alert Details
                                </Link>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                    <div className="border-t border-border mt-2 pt-2.5 px-4 text-center">
                      <Link
                        to="/incidents"
                        onClick={() => setShowNotifications(false)}
                        className="text-[10px] font-semibold text-primary hover:underline"
                      >
                        View all incidents →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
              <div className="h-5 w-px bg-border shrink-0" />
              <div className="flex items-center gap-2 shrink-0">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                  OP
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-medium text-text-primary leading-tight">Ops Admin</p>
                  <p className="text-[10px] text-text-secondary leading-none mt-0.5">
                    Platform Team
                  </p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-text-secondary hidden sm:block shrink-0" />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>

      <CopilotPanel />
    </div>
  );
}