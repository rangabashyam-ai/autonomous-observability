import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Trash2, Loader2, ChevronDown, ChevronUp, Sparkles, CheckCircle, AlertCircle, Lightbulb } from 'lucide-react';
import { copilotChat } from '../../api/client';
import type { CopilotContextPayload, CopilotResponse } from '../../ai/types';
import { cn } from '../../lib/cn';

interface InlineChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  response?: CopilotResponse;
}

interface InlineCopilotProps {
  /** Page-type identifier sent to the backend agent router */
  pageType: string;
  /** The entity or module this chatbot is scoped to */
  selectedEntity: string;
  /** Context data specific to the module */
  entityData: Record<string, unknown>;
  /** Related metrics to pass as context */
  relatedMetrics?: Record<string, unknown>;
  /** Related alerts */
  relatedAlerts?: unknown[];
  /** Related incidents */
  relatedIncidents?: unknown[];
  /** Suggested questions for the user */
  suggestedQuestions?: string[];
  /** Title shown in the chatbot header */
  title?: string;
  /** Subtitle for the header */
  subtitle?: string;
  /** Custom class name */
  className?: string;
  /** Controlled expansion state */
  isExpanded?: boolean;
  /** Callback triggered when the header is clicked */
  onToggle?: () => void;
  /** Whether to show a Live badge in the header */
  showLiveBadge?: boolean;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function InlineCopilot({
  pageType,
  selectedEntity,
  entityData,
  relatedMetrics = {},
  relatedAlerts = [],
  relatedIncidents = [],
  suggestedQuestions = [],
  title = 'AI Assistant',
  subtitle,
  className,
  isExpanded: controlledExpanded,
  onToggle,
  showLiveBadge,
}: InlineCopilotProps) {
  const [messages, setMessages] = useState<InlineChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [internalExpanded, setInternalExpanded] = useState(true);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const toggleExpanded = onToggle || (() => setInternalExpanded((prev) => !prev));
  const [lastResponse, setLastResponse] = useState<CopilotResponse | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    setMessages([]);
    setLastResponse(null);
  }, [selectedEntity]);

  const buildPayload = (question: string): CopilotContextPayload => ({
    context_scope: 'strict',
    page_type: pageType as any,
    selected_entity: selectedEntity,
    entity_data: entityData,
    related_metrics: relatedMetrics,
    related_alerts: relatedAlerts,
    related_incidents: relatedIncidents,
    dependency_data: {},
    analysis_results: {},
    investigation_results: {},
    user_question: question,
  });

  const sendMessage = async (question: string) => {
    if (!question.trim() || isLoading) return;

    const userMsg: InlineChatMessage = {
      id: newId(),
      role: 'user',
      content: question.trim(),
      timestamp: new Date().toISOString(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const context = buildPayload(question.trim());
      const apiMessages = updatedMessages.slice(0, -1).map((m) => {
        if (m.role === 'assistant' && m.response) {
          const res = m.response;
          let fullContent = m.content;
          if (res.findings && res.findings.length > 0) {
            fullContent += `\n\nFindings:\n` + res.findings.map((f) => `- ${f}`).join('\n');
          }
          if (res.evidence && res.evidence.length > 0) {
            fullContent += `\n\nEvidence:\n` + res.evidence.map((e) => `- ${e}`).join('\n');
          }
          if (res.recommended_actions && res.recommended_actions.length > 0) {
            fullContent += `\n\nRecommended Actions:\n` + res.recommended_actions.map((a) => `- ${a}`).join('\n');
          }
          if (res.confidence) {
            fullContent += `\n\nConfidence: ${res.confidence}`;
          }
          return { role: m.role, content: fullContent };
        }
        return { role: m.role, content: m.content };
      });

      const response = await copilotChat(context, apiMessages);

      const assistantMsg: InlineChatMessage = {
        id: newId(),
        role: 'assistant',
        content: response.summary,
        timestamp: response.timestamp ?? new Date().toISOString(),
        response,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setLastResponse(response);
    } catch (err) {
      const errorMsg: InlineChatMessage = {
        id: newId(),
        role: 'assistant',
        content: 'Unable to reach the AI service. Please check the backend connection and try again.',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      console.error('InlineCopilot error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const clearConversation = () => {
    setMessages([]);
    setLastResponse(null);
  };

  return (
    <div className={cn(
      'rounded-xl border border-border bg-card shadow-sm overflow-hidden',
      className
    )}>
      {/* Header */}
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shadow-sm shrink-0">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            <p className="text-[10px] text-text-secondary">
              {subtitle ?? `Scoped to ${selectedEntity}`}
              {lastResponse?.model && (
                <span className="ml-1 text-primary/60">
                  · {lastResponse.model.split('/').pop()}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showLiveBadge && (
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
              Live
            </span>
          )}
          {messages.length > 0 && !showLiveBadge && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {messages.filter((m) => m.role === 'assistant').length} responses
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-text-secondary" />
          ) : (
            <ChevronDown className="h-4 w-4 text-text-secondary" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border">
          {/* Messages area */}
          <div ref={scrollContainerRef} className="max-h-[360px] overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-6 space-y-3">
                <Sparkles className="h-10 w-10 text-primary/40 mx-auto" />
                <p className="text-xs text-text-secondary">
                  Ask anything about <span className="font-semibold text-text-primary">{selectedEntity}</span>
                </p>
                <p className="text-[10px] text-text-secondary/60">
                  Powered by Groq · Context-scoped AI analysis
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm shadow-sm',
                  msg.role === 'user'
                    ? 'bg-primary text-white rounded-br-md'
                    : 'bg-card border border-border rounded-bl-md'
                )}>
                  {msg.role === 'assistant' && msg.response?.model && msg.response.model.startsWith('error-') ? (
                    <div className="p-0.5 text-red-600 dark:text-red-400 text-xs flex items-start gap-2 font-medium leading-relaxed">
                      <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block mb-0.5">
                          {msg.response.model === 'error-unconfigured' && 'API Key Unconfigured'}
                          {msg.response.model === 'error-unauthorized' && 'Authentication Failed'}
                          {msg.response.model === 'error-ratelimit' && 'Rate Limit Exceeded'}
                          {msg.response.model === 'error-contextlimit' && 'Context Length Exceeded'}
                          {msg.response.model === 'error-payment' && 'Insufficient Balance'}
                          {!['error-unconfigured', 'error-unauthorized', 'error-ratelimit', 'error-contextlimit', 'error-payment'].includes(msg.response.model) && 'AI Service Offline'}
                        </span>
                        <p className="text-[11px] opacity-90 leading-normal">{msg.content.replace(/^⚠️ /, '')}</p>
                      </div>
                    </div>
                  ) : (
                    <p className={cn(
                      'text-xs leading-relaxed',
                      msg.role === 'user' ? 'text-white' : 'text-text-primary'
                    )}>
                      {msg.content}
                    </p>
                  )}

                  {/* Structured response details */}
                  {msg.role === 'assistant' && msg.response && !msg.response.model?.startsWith('error-') && (
                    <div className="mt-2.5 space-y-2 border-t border-border/40 pt-2.5">
                      {/* Findings */}
                      {msg.response.findings.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide mb-1">Findings</p>
                          <ul className="space-y-1">
                            {msg.response.findings.map((f, i) => (
                              <li key={i} className="flex items-start gap-1.5 text-[11px] text-text-primary">
                                <AlertCircle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                                {f}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Evidence */}
                      {msg.response.evidence.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide mb-1">Evidence</p>
                          <ul className="space-y-1">
                            {msg.response.evidence.map((e, i) => (
                              <li key={i} className="text-[11px] text-text-secondary flex items-start gap-1.5">
                                <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                                {e}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recommended Actions */}
                      {msg.response.recommended_actions.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide mb-1">Recommended Actions</p>
                          <ul className="space-y-1">
                            {msg.response.recommended_actions.map((a, i) => (
                              <li key={i} className="text-[11px] text-text-primary flex items-start gap-1.5">
                                <Lightbulb className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                                {a}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Confidence */}
                      {msg.response.confidence && (
                        <p className="text-[10px] text-text-secondary">
                          Confidence: <span className="font-semibold text-primary">{msg.response.confidence}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Analyzing with AI...
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Suggested questions */}
          {messages.length === 0 && suggestedQuestions.length > 0 && (
            <div className="px-4 pb-4 flex flex-wrap gap-2 justify-start">
              {suggestedQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  disabled={isLoading}
                  className="text-xs px-3.5 py-2 rounded-xl border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 text-left font-medium cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="px-4 py-3.5 border-t border-border bg-card flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask about ${selectedEntity}...`}
              disabled={isLoading}
              className="flex-1 h-10 px-4 text-xs rounded-xl border border-border bg-slate-50/50 dark:bg-slate-900/50 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="h-10 w-10 flex items-center justify-center rounded-xl bg-primary text-white hover:bg-primary/95 disabled:opacity-40 transition-all active:scale-95 shrink-0 shadow-sm cursor-pointer"
            >
              <Send className="h-4 w-4" />
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearConversation}
                className="h-10 w-10 flex items-center justify-center rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-card-hover transition-all active:scale-95 shrink-0 cursor-pointer"
                title="Clear conversation"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
