import { useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { askCopilot, getOverview } from '../api/client';
import type { Overview } from '../types/intelligence';
import { PageHeader, Grid12 } from '../components/ui/layout-primitives';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/cn';
import {
  Bot,
  Send,
  Sparkles,
  Target,
  Zap,
  Network,
  ChevronRight,
  Play,
} from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  actions?: string[];
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  confidence: number;
  impact: string;
  action: string;
}

const SUGGESTIONS = [
  'Why is Payment Authorization slow?',
  'Which services are impacted?',
  'What is the likely root cause?',
  'What fix worked last time?',
];

export default function AIOperationsCopilot() {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Welcome to AI Operations Copilot. I can analyze incidents, predict impact, identify root causes, and recommend remediation actions. What would you like to investigate?',
    },
  ]);
  const [input, setInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedCase, setSelectedCase] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getOverview().then(setOverview).catch(console.error);
  }, []);

  useEffect(() => {
    if (initialQuery) send(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const cases = useMemo(() => {
    if (!overview) return [];
    return overview.recent_incidents.slice(0, 5).map((inc, i) => ({
      id: inc.incident_id,
      title: inc.title,
      service: inc.service,
      severity: inc.severity,
      active: i === selectedCase,
    }));
  }, [overview, selectedCase]);

  const recommendations: Recommendation[] = useMemo(() => {
    if (!overview) return [];
    return overview.early_detections.slice(0, 3).map((d) => ({
      id: d.pattern_id,
      title: d.recommended_actions[0] ?? 'Investigate anomaly',
      description: `Pattern detected on ${d.expected_impacted_service}. ETA ${d.estimated_time_to_incident_minutes} minutes.`,
      confidence: d.confidence,
      impact: d.expected_impacted_service,
      action: d.recommended_actions[1] ?? 'Run diagnostic checks',
    }));
  }, [overview]);

  const send = async (question: string) => {
    if (!question.trim() || loading) return;
    setMessages((m) => [...m, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      const res = await askCopilot(question);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.answer,
          sources: res.sources,
          actions: res.suggested_actions,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Unable to process your request. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const activeCase = overview?.recent_incidents[selectedCase];

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      <PageHeader
        title="AI Operations Copilot"
        description="Decision-making workspace for root cause analysis, impact assessment, and remediation"
      />

      <Grid12 className="flex-1 min-h-0">
        {/* Cases sidebar */}
        <div className="col-span-12 lg:col-span-2 flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden" padding={false}>
            <div className="p-4 border-b border-border">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Active Cases</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {cases.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCase(i)}
                  className={cn(
                    'w-full text-left p-3 rounded-lg transition-colors duration-150',
                    selectedCase === i
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-card-hover border border-transparent'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={c.severity.startsWith('P1') ? 'critical' : 'warning'}>{c.severity}</Badge>
                  </div>
                  <p className="text-xs text-text-primary line-clamp-2">{c.title}</p>
                  <p className="text-[10px] text-text-secondary mt-1">{c.service}</p>
                </button>
              ))}
              {cases.length === 0 && (
                <p className="text-xs text-text-secondary p-3">No active cases</p>
              )}
            </div>
          </Card>
        </div>

        {/* Chat workspace */}
        <div className="col-span-12 lg:col-span-5 flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden" padding={false}>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {msg.role === 'assistant' && (
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-primary text-white'
                        : 'bg-background border border-border text-text-primary'
                    )}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.sources && msg.sources.length > 0 && (
                      <p className="text-[10px] text-text-secondary mt-2 pt-2 border-t border-border">
                        Sources: {msg.sources.join(', ')}
                      </p>
                    )}
                    {msg.actions && msg.actions.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.actions.map((a) => (
                          <p key={a} className="text-[10px] text-primary flex items-center gap-1">
                            <ChevronRight className="h-3 w-3" /> {a}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex gap-3">
                  <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary animate-pulse" />
                  </div>
                  <p className="text-sm text-text-secondary animate-pulse">Analyzing operational data...</p>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="p-4 border-t border-border space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-[10px] px-2.5 py-1 rounded-full border border-border text-text-secondary hover:text-text-primary hover:border-primary/40 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send(input)}
                  placeholder="Analyze service degradation, root cause, impact..."
                  className="flex-1"
                />
                <Button onClick={() => send(input)} disabled={loading} size="md">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Insights panel */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-4 min-h-0 overflow-y-auto">
          {activeCase && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{activeCase.title}</CardTitle>
                  <p className="text-xs text-text-secondary mt-0.5">{activeCase.service} · {activeCase.incident_id}</p>
                </div>
                <Badge variant="critical">Active</Badge>
              </CardHeader>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <CardTitle>Root Cause Analysis</CardTitle>
              </div>
            </CardHeader>
            <p className="text-sm text-text-primary leading-relaxed">
              {activeCase?.root_cause ?? 'Select a case or ask the copilot to run RCA analysis on a specific service.'}
            </p>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-warning" />
                <CardTitle>Blast Radius</CardTitle>
              </div>
            </CardHeader>
            <div className="flex flex-wrap gap-2">
              {(overview?.recent_incidents[selectedCase]
                ? [overview.recent_incidents[selectedCase].service]
                : ['auth-service', 'payment-api', 'catalog-service']
              ).map((s) => (
                <Badge key={s} variant="outline">{s}</Badge>
              ))}
            </div>
            <p className="text-xs text-text-secondary mt-3">
              Downstream dependencies may be affected. Run full blast radius analysis for complete impact map.
            </p>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-warning" />
                <CardTitle>Predictions</CardTitle>
              </div>
            </CardHeader>
            {overview?.early_detections.slice(0, 2).map((d) => (
              <div key={d.pattern_id} className="mb-3 last:mb-0 p-3 rounded-lg border border-border bg-background">
                <p className="text-xs text-text-primary">{d.expected_impacted_service}</p>
                <p className="text-[10px] text-text-secondary mt-1">
                  {d.estimated_time_to_incident_minutes}min ETA · {d.confidence}% confidence
                </p>
              </div>
            )) ?? <p className="text-xs text-text-secondary">No active predictions</p>}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle>Recommended Actions</CardTitle>
              </div>
            </CardHeader>
            <div className="space-y-3">
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="p-3 rounded-lg border border-border bg-background hover:bg-card-hover transition-colors"
                >
                  <p className="text-sm font-medium text-text-primary">{rec.title}</p>
                  <p className="text-xs text-text-secondary mt-1">{rec.description}</p>
                  <div className="flex items-center justify-between mt-3 gap-2">
                    <div className="flex gap-3 text-[10px] text-text-secondary">
                      <span>Confidence: <strong className="text-text-primary">{rec.confidence}%</strong></span>
                      <span>Impact: <strong className="text-text-primary">{rec.impact}</strong></span>
                    </div>
                    <Button size="sm" variant="primary">
                      <Play className="h-3 w-3" />
                      Execute
                    </Button>
                  </div>
                </div>
              ))}
              {recommendations.length === 0 && (
                <p className="text-xs text-text-secondary">Ask the copilot for remediation recommendations</p>
              )}
            </div>
          </Card>
        </div>
      </Grid12>
    </div>
  );
}
