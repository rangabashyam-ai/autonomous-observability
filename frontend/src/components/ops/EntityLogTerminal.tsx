import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

export interface TerminalLogLine {
  timestamp: string;
  host: string;
  log_name: string;
  message: string;
  severity: 'info' | 'error';
}

interface EntityLogTerminalProps {
  logs: TerminalLogLine[];
  loading?: boolean;
  entityName: string;
  active: boolean;
}

function formatLogTimestamp(ts: string): string {
  try {
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return ts;
  }
}

function severityColor(severity: TerminalLogLine['severity']): string {
  return severity === 'error' ? 'text-red-400' : 'text-emerald-400';
}

export default function EntityLogTerminal({ logs, loading = false, entityName, active }: EntityLogTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [streamReady, setStreamReady] = useState(false);

  useEffect(() => {
    if (!active) return;
    setVisibleCount(0);
    setStreamReady(false);
  }, [active, entityName, logs]);

  useEffect(() => {
    if (!active || loading) return;

    const bootTimer = window.setTimeout(() => setStreamReady(true), 500);
    return () => window.clearTimeout(bootTimer);
  }, [active, loading, entityName]);

  useEffect(() => {
    if (!active || loading || !streamReady) return;
    if (logs.length === 0) {
      setVisibleCount(0);
      return;
    }

    setVisibleCount(0);
    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setVisibleCount(index);
      if (index >= logs.length) {
        window.clearInterval(interval);
      }
    }, 140);

    return () => window.clearInterval(interval);
  }, [active, loading, streamReady, logs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleCount, loading, streamReady]);

  const showBoot = active && (loading || !streamReady);
  const isStreaming = active && streamReady && !loading && logs.length > 0 && visibleCount < logs.length;
  const isEmpty = active && streamReady && !loading && logs.length === 0;

  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden bg-[#0a0e14] shadow-inner">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#121820] border-b border-slate-700/80">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/90" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
        <span className="text-[10px] text-slate-400 font-mono ml-2 truncate">
          {entityName} — live log tail
        </span>
        {(loading || isStreaming) && (
          <span className="ml-auto text-[10px] font-mono text-emerald-400/80 animate-pulse">streaming</span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="h-[min(420px,50vh)] overflow-y-auto p-4 font-mono text-[11px] leading-relaxed text-slate-300"
      >
        <p className="text-slate-500 mb-2">
          <span className="text-emerald-500">$</span> tail -f /var/log/{entityName}/*.log
        </p>

        {showBoot && (
          <div className="space-y-1">
            <p className="text-slate-500">Opening log stream…</p>
            <p className="text-emerald-400">
              Connecting to {entityName}
              <span className="inline-block w-2 h-3.5 ml-0.5 bg-emerald-400 animate-pulse align-middle" />
            </p>
          </div>
        )}

        {isEmpty && (
          <p className="text-slate-500 mt-2">No logs matched for this entity in the current window.</p>
        )}

        {!showBoot &&
          logs.slice(0, visibleCount).map((log, i) => (
            <div key={`${log.timestamp}-${log.log_name}-${i}`} className="mb-1 break-words">
              <span className="text-slate-500">{formatLogTimestamp(log.timestamp)}</span>
              {' '}
              <span className={cn('font-semibold', severityColor(log.severity))}>
                {log.severity.toUpperCase()}
              </span>
              {' '}
              <span className="text-sky-400">{log.host}</span>
              {' '}
              <span className="text-violet-400">{log.log_name}</span>
              {' '}
              <span className={log.severity === 'error' ? 'text-red-300' : 'text-slate-200'}>
                {log.message}
              </span>
            </div>
          ))}

        {!showBoot && !isEmpty && visibleCount >= logs.length && logs.length > 0 && (
          <p className="text-slate-600 mt-3 text-[10px]">— end of stream —</p>
        )}
      </div>
    </div>
  );
}
