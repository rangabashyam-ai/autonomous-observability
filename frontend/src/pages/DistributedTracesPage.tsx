import { useCallback, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart } from 'recharts';
import { Search, Eye, Clock, Layers, GitBranch } from 'lucide-react';
import { PageHeader, Grid12 } from '../components/ui/layout-primitives';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { MetricCard } from '../components/ui/metric-card';
import { Badge } from '../components/ui/badge';
import { DataTable } from '../components/ui/data-table';
import { Input } from '../components/ui/input';
import DrilldownDrawer, { DrilldownSection } from '../components/drilldown/DrilldownDrawer';
import { cn } from '../lib/cn';
import { getTraceById, type TraceSpan } from '../api/tracesApi';

const tooltipStyle = {
  contentStyle: {
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    fontSize: '11px',
    color: 'var(--color-text-primary)',
  },
};

function formatMs(ms: number) {
  return new Date(ms).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function shortId(id: string, len = 10) {
  if (!id) return '—';
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

function durationColor(ms: number) {
  if (ms >= 500) return 'text-critical';
  if (ms >= 150) return 'text-warning';
  return 'text-text-primary';
}

function statusVariant(status: string): 'success' | 'critical' | 'secondary' {
  const s = status.toUpperCase();
  if (s.includes('ERROR')) return 'critical';
  if (s.includes('OK')) return 'success';
  return 'secondary';
}

export default function DistributedTracesPage() {
  const [traceIdInput, setTraceIdInput] = useState('');
  const [queriedTraceId, setQueriedTraceId] = useState('');

  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [selected, setSelected] = useState<TraceSpan | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const runSearch = useCallback(async (traceId: string) => {
    const trimmed = traceId.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    setQueriedTraceId(trimmed);
    try {
      const result = await getTraceById(trimmed);
      setSpans(result);
    } catch (e: any) {
      setError(e.message || 'Failed to load trace');
      setSpans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(traceIdInput);
  };

  const sortedSpans = useMemo(
    () => [...spans].sort((a, b) => a.startTimeMs - b.startTimeMs),
    [spans]
  );

  const stats = useMemo(() => {
    if (spans.length === 0) {
      return { total: 0, uniqueServices: 0, totalDuration: 0, maxDuration: 0 };
    }
    const uniqueServices = new Set(spans.map((s) => s.service)).size;
    const totalDuration = spans.reduce((sum, s) => sum + s.durationMs, 0);
    const maxDuration = Math.max(...spans.map((s) => s.durationMs));
    return { total: spans.length, uniqueServices, totalDuration, maxDuration };
  }, [spans]);

  const waterfallData = useMemo(
    () =>
      sortedSpans.map((s) => ({
        name: `${s.service} · ${shortId(s.spanId, 8)}`,
        durationMs: s.durationMs,
      })),
    [sortedSpans]
  );

  const openDetail = useCallback((span: TraceSpan) => {
    setSelected(span);
    setDrawerOpen(true);
  }, []);

  return (
    <div>
      <PageHeader
        title="Distributed Traces"
        description="Look up a distributed trace by trace ID and inspect every span within it"
      />

      {/* ─── Trace ID lookup ─── */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Find a trace</CardTitle>
        </CardHeader>
        <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[280px]">
            <label className="block text-[10px] font-medium text-text-secondary mb-1">Trace ID</label>
            <Input
              placeholder="gw0120210323235959498544"
              value={traceIdInput}
              onChange={(e) => setTraceIdInput(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !traceIdInput.trim()}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
            Search
          </button>
        </form>

        {queriedTraceId && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge variant="default">trace_id: {queriedTraceId}</Badge>
          </div>
        )}
      </Card>

      {error && (
        <Card className="mb-4 border-critical/30">
          <p className="text-sm text-critical">{error}</p>
        </Card>
      )}

      {!searched ? (
        <Card>
          <div className="py-12 text-center text-sm text-text-secondary">
            Enter a trace ID above to browse its spans
          </div>
        </Card>
      ) : (
        <>
          {/* ─── Overview stats ─── */}
          <Grid12 className="mb-4">
            <div className="col-span-12 sm:col-span-6 lg:col-span-3">
              <MetricCard label="Spans in Trace" value={stats.total} />
            </div>
            <div className="col-span-12 sm:col-span-6 lg:col-span-3">
              <MetricCard label="Services Involved" value={stats.uniqueServices} />
            </div>
            <div className="col-span-12 sm:col-span-6 lg:col-span-3">
              <MetricCard label="Total Duration" value={`${stats.totalDuration} ms`} />
            </div>
            <div className="col-span-12 sm:col-span-6 lg:col-span-3">
              <MetricCard
                label="Slowest Span"
                value={`${stats.maxDuration} ms`}
                variant={stats.maxDuration >= 500 ? 'critical' : stats.maxDuration >= 150 ? 'warning' : 'default'}
              />
            </div>
          </Grid12>

          {/* ─── Waterfall / duration-per-span chart ─── */}
          <Card className="mb-4">
            <CardHeader>
              <div>
                <CardTitle>Span durations</CardTitle>
                <CardDescription>Per-span response time across the trace, in call order</CardDescription>
              </div>
            </CardHeader>
            {waterfallData.length === 0 ? (
              <div className="h-[160px] flex items-center justify-center text-sm text-text-secondary">
                {loading ? 'Loading trace…' : 'No spans found for this trace ID'}
              </div>
            ) : (
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={waterfallData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 9, fill: 'var(--color-text-secondary)' }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
                      axisLine={false}
                      tickLine={false}
                      label={{ value: 'ms', position: 'insideLeft', fontSize: 10, fill: 'var(--color-text-secondary)' }}
                    />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="durationMs" name="Duration (ms)" fill="#3B82F6" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* ─── Span table ─── */}
          <Card padding={false}>
            <div className="flex items-center justify-between p-5 pb-0">
              <div>
                <CardTitle>{sortedSpans.length} spans</CardTitle>
                <CardDescription>Click a span to inspect metadata and timings</CardDescription>
              </div>
            </div>
            <div className="p-5 pt-4">
              {sortedSpans.length === 0 ? (
                <div className="py-12 text-center text-sm text-text-secondary">
                  {loading ? 'Loading trace…' : 'No spans found for this trace ID'}
                </div>
              ) : (
                <DataTable
                  compact
                  data={sortedSpans}
                  onRowClick={openDetail}
                  columns={[
                    {
                      key: 'start',
                      header: 'Start time',
                      render: (s) => <span className="font-mono text-xs">{formatMs(s.startTimeMs)}</span>,
                    },
                    {
                      key: 'service',
                      header: 'Service',
                      render: (s) => <Badge variant="secondary">{s.service}</Badge>,
                    },
                    {
                      key: 'kind',
                      header: 'Span Kind',
                      render: (s) => <span className="text-[11px] text-text-secondary">{s.kind}</span>,
                    },
                    {
                      key: 'span',
                      header: 'Span ID',
                      render: (s) => (
                        <span className="font-mono text-[11px] text-text-secondary" title={s.spanId}>
                          {shortId(s.spanId, 14)}
                        </span>
                      ),
                    },
                    {
                      key: 'parent',
                      header: 'Parent Span ID',
                      render: (s) => (
                        <span className="font-mono text-[11px] text-text-secondary" title={s.parentSpanId ?? undefined}>
                          {s.parentSpanId ? shortId(s.parentSpanId, 14) : 'Root span'}
                        </span>
                      ),
                    },
                    {
                      key: 'response',
                      header: 'Response time',
                      render: (s) => (
                        <span className={cn('font-mono text-xs font-medium', durationColor(s.durationMs))}>{s.durationMs} ms</span>
                      ),
                    },
                    {
                      key: 'actions',
                      header: '',
                      render: () => <Eye className="h-3.5 w-3.5 text-text-secondary/60" />,
                    },
                  ]}
                />
              )}
            </div>
          </Card>
        </>
      )}

      {/* ─── Span detail drawer ─── */}
      <DrilldownDrawer
        isOpen={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelected(null); }}
        title={selected ? `${selected.service} span` : ''}
        subtitle={selected?.spanId}
        type="node"
      >
        {selected && (
          <div className="space-y-6">
            <DrilldownSection title="Metadata" icon={<Layers className="w-4 h-4" />}>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-0.5">Service</p>
                  <p className="font-mono text-text-primary">{selected.service}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-0.5">Trace ID</p>
                  <p className="font-mono text-primary break-all">{selected.traceId}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-0.5">Span ID</p>
                  <p className="font-mono text-text-primary break-all">{selected.spanId}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-0.5">Parent Span ID</p>
                  <p className="font-mono text-text-primary break-all">{selected.parentSpanId || 'Root span'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-0.5">Span Kind</p>
                  <p className="text-text-primary">{selected.kind}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-0.5">Status</p>
                  <Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>
                </div>
              </div>
            </DrilldownSection>

            <DrilldownSection title="Timings" icon={<Clock className="w-4 h-4" />}>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-0.5">Start time</p>
                  <p className="font-mono text-text-primary">{formatMs(selected.startTimeMs)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-0.5">End time</p>
                  <p className="font-mono text-text-primary">{formatMs(selected.endTimeMs)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-0.5">Response time</p>
                  <p className={cn('font-mono font-semibold', durationColor(selected.durationMs))}>{selected.durationMs} ms</p>
                </div>
              </div>
            </DrilldownSection>

            {Object.keys(selected.attributes).length > 0 && (
              <DrilldownSection title="Attributes" icon={<GitBranch className="w-4 h-4" />}>
                <div className="space-y-1.5">
                  {Object.entries(selected.attributes).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-background text-xs">
                      <span className="font-mono text-text-secondary">{key}</span>
                      <span className="font-mono text-text-primary truncate">{value}</span>
                    </div>
                  ))}
                </div>
              </DrilldownSection>
            )}
          </div>
        )}
      </DrilldownDrawer>
    </div>
  );
}
