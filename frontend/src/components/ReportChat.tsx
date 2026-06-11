import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Trash2, Loader2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { askReportChat } from '../api/client';
import { cn } from '../lib/cn';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ReportChatProps {
  reportContext: string;
  reportType: string;
  title?: string;
  subtitle?: string;
  entityName?: string;
  suggestedQuestions?: string[];
  className?: string;
}

export function ReportChat({
  reportContext,
  reportType,
  title = 'AI Assistant',
  subtitle,
  entityName = 'this report',
  suggestedQuestions = [],
  className,
}: ReportChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0 || loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  const send = async (overrideQuestion?: string) => {
    const question = (overrideQuestion ?? input).trim();
    if (!question || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: question };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await askReportChat({
        question,
        report_context: reportContext,
        report_type: reportType,
        history: messages.slice(-8),
      });
      let content: string;
      if (res.answer) {
        content = res.answer;
      } else if (res.error) {
        const e = res.error.toLowerCase();
        if (e.includes('429') || e.includes('rate limit') || e.includes('rate_limit')) {
          content = 'Rate limit reached — please wait a moment and try again.';
        } else if (e.includes('401') || e.includes('unauthorized') || e.includes('api key')) {
          content = 'Agent not configured — check the API key in your backend .env file.';
        } else if (e.includes('timed out') || e.includes('timeout')) {
          content = 'The agent timed out — please try again.';
        } else {
          content = `Agent error: ${res.error}`;
        }
      } else {
        content = 'The agent returned an empty response. Please try again.';
      }
      setMessages([...nextMessages, { role: 'assistant', content }]);
    } catch (err: any) {
      const msg = (err.message ?? '').toLowerCase().includes('timed out')
        ? 'The agent timed out — please try again.'
        : `Something went wrong: ${err.message}`;
      setMessages([...nextMessages, { role: 'assistant', content: msg }]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    setMessages([]);
  };

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden',
      'border-primary/20 bg-gradient-to-br from-primary/[0.03] to-indigo-500/[0.03]',
      'dark:from-primary/[0.06] dark:to-indigo-500/[0.06]',
      className
    )}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center shadow-sm">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            <p className="text-[10px] text-text-secondary">
              {subtitle ?? `Scoped to ${entityName}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
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
        <div className="border-t border-primary/10">
          {/* Messages area */}
          <div className="max-h-[360px] overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-4 space-y-3">
                <Sparkles className="h-8 w-8 text-primary/40 mx-auto" />
                <p className="text-xs text-text-secondary">
                  Ask anything about <span className="font-medium text-text-primary">{entityName}</span>
                </p>
                <p className="text-[10px] text-text-secondary/60">
                  Powered by GROQ · Context-scoped AI analysis
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm',
                  msg.role === 'user'
                    ? 'bg-primary text-white rounded-br-md'
                    : 'bg-card border border-border rounded-bl-md'
                )}>
                  <p className={cn(
                    'text-xs leading-relaxed',
                    msg.role === 'user' ? 'text-white' : 'text-text-primary'
                  )}>
                    {msg.content}
                  </p>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Analyzing with AI...
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Suggested questions */}
          {messages.length === 0 && suggestedQuestions.length > 0 && (
            <div className="px-4 pb-3 flex flex-wrap gap-1.5">
              {suggestedQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => send(q)}
                  disabled={loading}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 py-2.5 border-t border-primary/10 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={`Ask about ${entityName}...`}
              disabled={loading}
              className="flex-1 h-9 px-3 text-xs rounded-lg border border-border bg-background text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="h-9 w-9 flex items-center justify-center rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearConversation}
                className="h-9 w-9 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors"
                title="Clear conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

