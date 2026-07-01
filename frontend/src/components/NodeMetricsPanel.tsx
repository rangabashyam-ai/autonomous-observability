import { useCallback, useEffect, useState } from 'react';
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, ReferenceLine, XAxis, YAxis,
} from 'recharts';
import type { GraphNode } from '../types/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface MetricPoint {
  ts: string;
  value: number | null;
  z_score?: number | null;
  is_anomaly?: boolean;
  state?: number;
  raw_count?: number;
}

interface MetricSeries {
  name: string;
  label: string;
  unit: string;
  metric_type: 'Gauge' | 'Counter' | 'Rate' | 'State' | 'HighWaterMark';
  anomaly_method: string;
  preprocessing: string | null;
  points: MetricPoint[];
  current_value: number | null;
  baseline_median: number | null;
  baseline_mad: number | null;
  max_z_score: number | null;
  anomaly_severity: 'normal' | 'warning' | 'critical';
  state_events?: { onsets: number[]; recoveries: number[] };
  hwm_break?: boolean;
  trend_slope?: number | null;
  threshold?: number;
}

interface NodeMetricsData {
  node_id: string;
  node_type: string;
  window_minutes: number;
  anchor_ts: string | null;
  data_available: boolean;
  metrics: MetricSeries[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const WINDOWS = [5, 10, 30, 60] as const;
type WindowVal = typeof WINDOWS[number];
const WINDOW_LABELS: Record<WindowVal, string> = { 5: '5m', 10: '10m', 30: '30m', 60: '1h' };

const SEV = {
  normal:   { ring: 'border-slate-200 dark:border-slate-700', badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300', text: 'text-emerald-600 dark:text-emerald-400', dot: '#10b981', label: 'Normal' },
  warning:  { ring: 'border-amber-300 dark:border-amber-700',  badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300',   text: 'text-amber-600 dark:text-amber-400',   dot: '#f59e0b', label: 'Warning' },
  critical: { ring: 'border-red-400 dark:border-red-700',      badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300',           text: 'text-red-600 dark:text-red-400',       dot: '#ef4444', label: 'Anomaly' },
};

const TYPE_META: Record<string, { color: string; badge: string; short: string }> = {
  Gauge:         { color: '#3b82f6', badge: 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300',     short: 'Gauge' },
  Rate:          { color: '#8b5cf6', badge: 'bg-violet-100 dark:bg-violet-900/60 text-violet-700 dark:text-violet-300', short: 'Rate' },
  Counter:       { color: '#6366f1', badge: 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300', short: 'Counter' },
  State:         { color: '#f97316', badge: 'bg-orange-100 dark:bg-orange-900/60 text-orange-700 dark:text-orange-300', short: 'State' },
  HighWaterMark: { color: '#14b8a6', badge: 'bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300',     short: 'HWM' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  } catch { return ts; }
}

function fmtVal(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined) return '—';
  if (unit === 'state') return v === 1 ? 'Incident' : 'Healthy';
  const num = Number(v);
  const str = num < 10 ? num.toFixed(2) : num.toFixed(1);
  if (unit === '%' || unit === 'ms') return `${str} ${unit}`;
  if (unit === 'req/s') return `${str} rps`;
  return `${str} ${unit}`;
}

// ── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ s }: { s: MetricSeries }) {
  const tm = TYPE_META[s.metric_type] ?? TYPE_META.Gauge;

  const color = s.anomaly_severity === 'critical' ? '#ef4444'
              : s.anomaly_severity === 'warning'  ? '#f59e0b'
              : tm.color;

  const gradId = `spk-${s.name.replace(/[^a-z0-9]/gi, '_')}`;

  if (s.metric_type === 'State') {
    const data = s.points.map(p => ({ ts: fmtTime(p.ts), state: p.state ?? 0, sr: p.value }));
    return (
      <ResponsiveContainer width="100%" height={72}>
        <AreaChart data={data} margin={{ top: 4, right: 2, left: -36, bottom: 0 }}>
          <defs>
            <linearGradient id={`${gradId}-s`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f97316" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="ts" tick={{ fontSize: 8, fill: '#6b7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis domain={[-0.05, 1.1]} ticks={[0, 1]} tick={{ fontSize: 8, fill: '#6b7280' }} axisLine={false} tickLine={false} />
          <ReferenceLine y={0.5} stroke="#475569" strokeDasharray="2 2" strokeWidth={1} />
          <Area type="stepAfter" dataKey="state" stroke="#f97316" strokeWidth={2} fill={`url(#${gradId}-s)`} dot={false} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 10, padding: '4px 8px' }}
            formatter={(v: any) => [v === 1 ? '⚠ INCIDENT' : '✓ Healthy', 'State']}
            labelFormatter={l => `${l} UTC`}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  const data = s.points.map(p => ({
    ts: fmtTime(p.ts),
    value: p.value,
    anom: p.is_anomaly ? p.value : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={72}>
      <AreaChart data={data} margin={{ top: 4, right: 2, left: -36, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="ts" tick={{ fontSize: 8, fill: '#6b7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 8, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <Area
          type="monotone" dataKey="value" stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={(props: any) => {
            const { cx, cy, payload } = props;
            if (!payload?.is_anomaly) return <g key={`e-${payload?.ts}`} />;
            return <circle key={`a-${payload?.ts}`} cx={cx} cy={cy} r={3.5} fill="#ef4444" stroke="#fff" strokeWidth={1} />;
          }}
        />
        {s.baseline_median !== null && (
          <ReferenceLine y={s.baseline_median} stroke="#475569" strokeDasharray="3 2" strokeWidth={1} label={{ value: 'baseline', position: 'insideTopRight', fontSize: 8, fill: '#64748b' }} />
        )}
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 10, padding: '4px 8px' }}
          formatter={(v: any, _name: any, item: any) => {
            const z = item?.payload?.anom !== null && item?.payload?.z_score ? ` (z=${item.payload.z_score})` : '';
            return [`${Number(v).toFixed(3)} ${s.unit}${z}`, s.label] as [string, string];
          }}
          labelFormatter={l => `${l} UTC`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({ s }: { s: MetricSeries }) {
  const tm = TYPE_META[s.metric_type] ?? TYPE_META.Gauge;
  const sv = SEV[s.anomaly_severity];

  return (
    <div className={`rounded-xl border-2 ${sv.ring} bg-white dark:bg-slate-900 p-3 shadow-sm`}>
      {/* header row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ${tm.badge}`}>
            {tm.short}
          </span>
          <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">{s.label}</span>
        </div>
        <span className={`shrink-0 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${sv.badge}`}>
          {sv.label}
        </span>
      </div>

      {/* anomaly method */}
      <p className="text-[9px] text-slate-400 dark:text-slate-500 mb-2 leading-tight">
        {s.preprocessing && <><span className="text-slate-500">{s.preprocessing}</span> → </>}
        {s.anomaly_method}
      </p>

      {/* chart */}
      <Sparkline s={s} />

      {/* stats */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2">
        <StatPill label="Now" value={fmtVal(s.current_value, s.unit)} bold />
        {s.baseline_median !== null && (
          <StatPill label="Baseline" value={fmtVal(s.baseline_median, s.unit)} />
        )}
        {s.max_z_score !== null && (
          <StatPill
            label="|Z|"
            value={Math.abs(s.max_z_score).toFixed(2)}
            color={sv.text}
          />
        )}
        {s.baseline_mad !== null && s.baseline_mad > 0 && (
          <StatPill label="MAD" value={fmtVal(s.baseline_mad, s.unit)} />
        )}
      </div>

      {/* HWM break indicator */}
      {s.metric_type === 'HighWaterMark' && s.hwm_break !== undefined && (
        <div className={`mt-2 text-[9px] font-semibold px-2 py-0.5 rounded inline-block ${s.hwm_break ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400' : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400'}`}>
          {s.hwm_break ? '↑ Monotone break detected' : '↔ Within baseline trend'}
        </div>
      )}

      {/* State events */}
      {s.metric_type === 'State' && s.state_events && (s.state_events.onsets.length > 0 || s.state_events.recoveries.length > 0) && (
        <div className="mt-2 flex gap-3 text-[9px]">
          {s.state_events.onsets.length > 0 && (
            <span className="text-red-500 font-semibold">⚡ {s.state_events.onsets.length} onset{s.state_events.onsets.length > 1 ? 's' : ''}</span>
          )}
          {s.state_events.recoveries.length > 0 && (
            <span className="text-emerald-500 font-semibold">✓ {s.state_events.recoveries.length} recovery</span>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <span className="text-[10px] text-slate-500 dark:text-slate-400">
      {label}:{' '}
      <span className={`font-mono ${bold ? 'font-semibold text-slate-800 dark:text-slate-200' : ''} ${color || ''}`}>
        {value}
      </span>
    </span>
  );
}

// ── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ metrics }: { metrics: MetricSeries[] }) {
  const counts = { critical: 0, warning: 0, normal: 0 };
  metrics.forEach(m => counts[m.anomaly_severity]++);
  const total = metrics.length;
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-1 px-5 py-2 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] shrink-0">
      <span className="text-slate-500 mr-1">{total} signals:</span>
      {counts.critical > 0 && <Chip color="bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400">{counts.critical} anomaly</Chip>}
      {counts.warning > 0  && <Chip color="bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400">{counts.warning} warning</Chip>}
      {counts.normal > 0   && <Chip color="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400">{counts.normal} normal</Chip>}
    </div>
  );
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return <span className={`px-1.5 py-0.5 rounded-full font-semibold ${color}`}>{children}</span>;
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 animate-pulse bg-white dark:bg-slate-900">
          <div className="flex justify-between mb-2">
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-24" />
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-12" />
          </div>
          <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded w-3/4 mb-2" />
          <div className="h-[72px] bg-slate-100 dark:bg-slate-800 rounded mb-2" />
          <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export default function NodeMetricsPanel({ node, onClose }: Props) {
  const [windowM, setWindowM] = useState<WindowVal>(30);
  const [data, setData]       = useState<NodeMetricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async (id: string, w: WindowVal) => {
    setLoading(true);
    setError(null);
    try {
      const BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? '/api';
      const res  = await fetch(`${BASE}/monitoring/node-metrics/${encodeURIComponent(id)}?window=${w}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(node.id, windowM); }, [node.id, windowM, load]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const hasAnomaly = data?.metrics.some(m => m.anomaly_severity !== 'normal') ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal card */}
      <div className="relative bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">

      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">{node.label}</h3>
            {hasAnomaly && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 font-bold uppercase animate-pulse">
                Anomaly
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5 capitalize">
            {node.type} &middot; {node.layer} &middot; Metrics
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 ml-3 shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-xl leading-none"
        >
          ✕
        </button>
      </div>

      {/* Window selector */}
      <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <span className="text-[9px] text-slate-500 font-medium uppercase tracking-wide mr-1">Window</span>
        {WINDOWS.map(w => (
          <button
            key={w}
            onClick={() => setWindowM(w)}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${
              windowM === w
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {WINDOW_LABELS[w]}
          </button>
        ))}
        {data?.anchor_ts && (
          <span className="ml-auto text-[9px] text-slate-400 tabular-nums">
            ↳ {fmtTime(data.anchor_ts)} UTC
          </span>
        )}
      </div>

      {/* Summary bar */}
      {!loading && data?.data_available && <SummaryBar metrics={data.metrics} />}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && <Skeleton />}

        {!loading && error && (
          <div className="m-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400">
            ⚠ {error}
          </div>
        )}

        {!loading && !error && data && !data.data_available && (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 dark:text-slate-500 gap-2">
            <span className="text-3xl">📭</span>
            <span className="text-sm">No telemetry for <strong className="text-slate-600 dark:text-slate-300">{node.label}</strong></span>
            <span className="text-xs text-slate-400">in the last {windowM} min of available data</span>
          </div>
        )}

        {!loading && !error && data?.data_available && (
          <div className="p-4 grid grid-cols-2 gap-3">
            {data.metrics.map(m => <MetricCard key={m.name} s={m} />)}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
