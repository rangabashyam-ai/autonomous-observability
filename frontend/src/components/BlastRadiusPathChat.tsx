import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Trash2, Loader2, ChevronDown, ChevronUp, Sparkles, Search, Target, Network, Layers, TrendingUp, ArrowRight } from 'lucide-react';
import { chatBlastRadius } from '../api/client';

interface Props {
  service: string;
  selection?: any;
  rootLabel?: string;
  isExpanded?: boolean;
  onToggle?: () => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// Markdown to HTML response formatter
function formatAIResponse(text: string): string {
  if (!text) return "";

  const lines = text.split('\n');
  const htmlResult: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (inList) {
        htmlResult.push('</ul>');
        inList = false;
      }
      htmlResult.push('<div style="height: 6px;"></div>');
      continue;
    }

    // Replace ## headings with styled section labels in CSS
    if (trimmed.startsWith("##")) {
      if (inList) {
        htmlResult.push('</ul>');
        inList = false;
      }
      const headerText = trimmed.replace(/^##+\s*/, "").trim();
      htmlResult.push(`<div style="font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 0.8px; margin: 10px 0 4px 0;">${headerText}</div>`);
      continue;
    }

    // Check list item
    const isBullet = trimmed.startsWith('*') || trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.startsWith('•');
    const isNumbered = /^\d+\.\s*/.test(trimmed);

    let content = trimmed;
    if (isBullet) {
      content = trimmed.replace(/^[\*\+\-•]\s*/, "").trim();
    } else if (isNumbered) {
      content = trimmed.replace(/^\d+\.\s*/, "").trim();
    }

    // Process bold/italic markdown before rendering, replacing them with plain styled text without raw markdown characters
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #1f2937; font-weight: 700;">$1</strong>');
    content = content.replace(/\*(.*?)\*/g, '<em style="font-style: italic; color: #1f2937;">$1</em>');

    // Badges:
    // [CRITICAL] -> red badge
    content = content.replace(/\[CRITICAL\]/g, '<span style="display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 700; background-color: #ef4444; color: #ffffff; vertical-align: middle; margin: 0 2px;">CRITICAL</span>');
    // [WARNING] -> orange badge
    content = content.replace(/\[WARNING\]/g, '<span style="display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 700; background-color: #f59e0b; color: #ffffff; vertical-align: middle; margin: 0 2px;">WARNING</span>');
    // [AT RISK] -> orange badge
    content = content.replace(/\[AT RISK\]/g, '<span style="display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 700; background-color: #f59e0b; color: #ffffff; vertical-align: middle; margin: 0 2px;">AT RISK</span>');

    // Support dynamic inline confidence badges [number% confidence] or similar
    content = content.replace(/\[(\d+)% confidence\]/gi, '<span style="display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 700; background-color: #3b82f6; color: #ffffff; vertical-align: middle; margin: 0 2px;">$1% Confidence</span>');

    // Monospace tickets
    content = content.replace(/(INC-\d+)/g, '<code style="font-family: monospace; font-size: 10px; background-color: #eff6ff; color: #1d4ed8; padding: 2px 4px; border-radius: 4px; border: 1px solid #bfdbfe;">$1</code>');

    if (isBullet) {
      if (!inList) {
        htmlResult.push('<ul style="margin: 4px 0; padding: 0;">');
        inList = true;
      }
      htmlResult.push(`<li style="list-style-type: none; padding-left: 16px; position: relative; margin-bottom: 4px; color: #1f2937;"><span style="position: absolute; left: 0; color: #6366f1;">•</span>${content}</li>`);
    } else if (isNumbered) {
      if (!inList) {
        htmlResult.push('<ul style="margin: 4px 0; padding: 0;">');
        inList = true;
      }
      const num = trimmed.match(/^(\d+)\.\s*/)?.[1] || "1";
      htmlResult.push(`<li style="list-style-type: none; padding-left: 24px; position: relative; margin-bottom: 6px; color: #1f2937;"><span style="position: absolute; left: 0; top: 1px; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 9999px; background-color: #3b82f6; color: #ffffff; font-family: monospace; font-size: 9px; font-weight: 700;">${num}</span>${content}</li>`);
    } else {
      if (inList) {
        htmlResult.push('</ul>');
        inList = false;
      }
      htmlResult.push(`<p style="margin-bottom: 4px; margin-top: 4px; line-height: 1.5; color: #1f2937;">${content}</p>`);
    }
  }

  if (inList) {
    htmlResult.push('</ul>');
  }

  return htmlResult.join('');
}
export default function BlastRadiusPathChat({
  service,
  selection,
  rootLabel,
  isExpanded: controlledExpanded,
  onToggle,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showContext, setShowContext] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const toggleExpanded = onToggle || (() => setInternalExpanded((prev) => !prev));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Reset chat and show context pill on service change
  useEffect(() => {
    setMessages([]);
    setShowContext(true);
  }, [service]);

  // Show context pill on selection change
  useEffect(() => {
    setShowContext(true);
  }, [selection]);

  const handleSend = async (text: string) => {
    if (!text.trim() || isLoading) return;
    
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    };
    
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    
    try {
      const historyPayload = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      
      const response = await chatBlastRadius(service, text, historyPayload);
      
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: response.answer,
      };
      
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: Message = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: `Error investigating blast radius: ${err.message || 'Unknown error occurred'}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const q = input;
    setInput('');
    handleSend(q);
  };

  const quickActionsList = [
    { label: "Explain Blast", value: "Explain this blast radius", Icon: Search },
    { label: "Root Cause", value: "Identify the root cause", Icon: Target },
    { label: "Propagation", value: "Show impact propagation", Icon: Network },
    { label: "Affected Services", value: "List affected services", Icon: Layers },
    { label: "Biz Impact", value: "Summarize business impact", Icon: TrendingUp },
    { label: "Next Steps", value: "Recommend next investigation steps", Icon: ArrowRight }
  ];

  // Dynamic context text builder
  let contextText = `Analyzing: ${rootLabel || service} · P1 · 100/100 impact score`;
  if (selection) {
    if (selection.type === 'node') {
      contextText = `Analyzing: ${selection.detail.label} · ${selection.detail.health.toUpperCase()} · ${selection.detail.riskScore.toFixed(0)}% risk score`;
    } else if (selection.type === 'edge') {
      contextText = `Analyzing: ${selection.detail.sourceLabel} → ${selection.detail.targetLabel} path`;
    }
  }

  return (
    <div className="rounded-xl border overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.03] to-indigo-500/[0.03] dark:from-primary/[0.06] dark:to-indigo-500/[0.06] transition-all duration-300 ease-in-out shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-sm">
      {/* COLLAPSED STATE DESIGN / SUMMARY BAR */}
      <button 
        onClick={toggleExpanded}
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors select-none text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center shadow-sm shrink-0">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary">AI Assistant</h3>
            <p className="text-[10px] text-text-secondary truncate">
              Scoped to Blast Radius Investigation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 px-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-955/20 text-emerald-700 dark:text-emerald-450 border border-emerald-200 dark:border-emerald-900/50 flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              Live
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-text-secondary" />
          ) : (
            <ChevronDown className="h-4 w-4 text-text-secondary" />
          )}
        </div>
      </button>

      {/* EXPANDED CONTENT WRAPPER */}
      <div 
        className={`transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[50vh] border-t border-primary/10 overflow-y-auto' : 'max-h-0 overflow-hidden'
        }`}
      >
        <div className="p-4 space-y-3 rounded-b-lg">
          {/* CONTEXT PILL */}
          {showContext && (
            <div className="px-3 py-1.5 rounded-lg bg-[#f0f0ff] dark:bg-indigo-950/20 border border-[#e0e0ff] dark:border-indigo-900/30 text-indigo-950 dark:text-indigo-305 flex items-center justify-between text-xs font-semibold shrink-0 shadow-xs">
              <div className="flex items-center gap-1.5 truncate">
                <span className="shrink-0">📍</span>
                <span className="truncate">{contextText}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowContext(false)}
                className="text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-bold text-sm shrink-0 px-1 ml-1"
                title="Dismiss Context"
              >
                ×
              </button>
            </div>
          )}

          {/* CHAT MESSAGES AREA */}
          <div className="flex-1 overflow-y-auto p-3 bg-[#f8f9fa] dark:bg-slate-950/20 rounded-2xl space-y-3 min-h-[200px] max-h-[350px] border border-slate-100 dark:border-slate-800">
            {messages.length === 0 ? (
              <div className="text-center py-6 space-y-2 flex flex-col items-center justify-center h-full">
                <Sparkles className="h-8 w-8 text-primary/40 mx-auto animate-pulse" />
                <p className="text-xs text-text-secondary">
                  Ask anything about <span className="font-semibold text-text-primary">Blast Radius Investigation</span>
                </p>
                <p className="text-[10px] text-text-secondary/60">
                  Powered by Groq · Context-scoped AI analysis
                </p>
              </div>
            ) : (
              messages.map((m) => {
                if (m.role === 'user') {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="bg-primary text-white rounded-xl rounded-br-md px-3.5 py-2.5 max-w-[85%] text-xs leading-relaxed shadow-xs font-medium">
                        {m.content}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={m.id} className="flex gap-2.5 items-start">
                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center shadow-xs shrink-0">
                      <Bot className="h-3.5 w-3.5 text-white" />
                    </div>

                    <div className="flex-1 min-w-0 bg-card border border-border rounded-xl rounded-bl-md p-3.5 shadow-xs relative">
                      <div className="absolute top-2.5 left-3.5 text-[9px] font-bold text-primary uppercase tracking-wider">
                        AI
                      </div>
                      <div className="pt-2 text-xs text-text-primary leading-relaxed">
                        <div dangerouslySetInnerHTML={{ __html: formatAIResponse(m.content) }} />
                      </div>
                      <div className="text-right text-[8px] text-text-secondary mt-1.5 font-medium">
                        just now
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Analyzing blast radius...
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* QUICK ACTION BUTTONS */}
          <div className="shrink-0 pt-1 space-y-1.5">
            <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
              Quick Actions
            </div>
            <div className="grid grid-cols-3 gap-2">
              {quickActionsList.map((act) => {
                const IconComponent = act.Icon;
                return (
                  <button
                    key={act.value}
                    type="button"
                    onClick={() => handleSend(act.value)}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-left bg-card border border-border hover:border-primary/30 transition-all duration-150 hover:shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    <IconComponent className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-xs font-semibold text-text-primary truncate">
                      {act.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* INPUT BAR */}
          <form onSubmit={handleSubmit} className="px-3 py-2.5 border-t border-primary/10 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this incident..."
              disabled={isLoading}
              className="flex-1 h-9 px-3 text-xs rounded-lg border border-border bg-background text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="h-9 w-9 flex items-center justify-center rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
              title="Send"
            >
              <Send className="h-3.5 w-3.5" />
            </button>

            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="h-9 w-9 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors shrink-0"
                title="Clear conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
