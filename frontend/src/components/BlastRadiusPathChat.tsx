import { useState, useRef, useEffect } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { chatBlastRadius } from '../api/client';

interface Props {
  service: string;
  selection?: any;
  rootLabel?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// Markdown to HTML response formatter
function formatAIResponse(text: string): string {
  if (!text) return "";

  // Split by double line breaks to get paragraphs
  let paragraphs = text.split(/\n\n+/);
  
  paragraphs = paragraphs.map(p => {
    let line = p.trim();
    if (!line) return "";

    // Replace ## headings with styled uppercase headers
    if (line.startsWith("##")) {
      const headerText = line.replace(/^##+\s*/, "").trim();
      return `<div style="font-size: 12px; font-weight: 600; color: #6366f1; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 12px; margin-bottom: 6px;">${headerText}</div>`;
    }

    // Process sub-elements: strong, bullets, badges
    const lines = line.split('\n');
    const processedLines = lines.map(l => {
      let temp = l.trim();
      
      const isBullet = temp.startsWith('*') || temp.startsWith('+');
      if (isBullet) {
        temp = temp.replace(/^[\*\+]\s*/, "").trim();
      }

      // **text** -> strong tag with color #1a1a1a
      temp = temp.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #1a1a1a; font-weight: 700;">$1</strong>');

      // Badges
      temp = temp.replace(/\[CRITICAL\]/g, '<span style="display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 700; background-color: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; vertical-align: middle; margin: 0 2px;">CRITICAL</span>');
      temp = temp.replace(/\[WARNING\]/g, '<span style="display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 700; background-color: #ffedd5; color: #c2410c; border: 1px solid #fed7aa; vertical-align: middle; margin: 0 2px;">WARNING</span>');

      // Monospace tickets
      temp = temp.replace(/(INC-\d+)/g, '<code style="font-family: monospace; font-size: 10px; background-color: #eff6ff; color: #1d4ed8; padding: 2px 4px; border-radius: 4px; border: 1px solid #bfdbfe;">$1</code>');

      if (isBullet) {
        return `<li style="list-style-type: none; padding-left: 14px; position: relative; margin-bottom: 4px; color: #1f2937;"><span style="position: absolute; left: 0; color: #6366f1;">•</span>${temp}</li>`;
      }
      return temp;
    });

    const hasBullets = lines.some(l => l.trim().startsWith('*') || l.trim().startsWith('+'));
    if (hasBullets) {
      return `<ul style="margin: 4px 0; padding: 0;">${processedLines.join('')}</ul>`;
    }
    
    return `<p style="margin-bottom: 8px; margin-top: 4px; line-height: 1.5; color: #1f2937;">${processedLines.join('<br />')}</p>`;
  });

  return paragraphs.filter(Boolean).join('');
}

export default function BlastRadiusPathChat({ service, selection, rootLabel }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showContext, setShowContext] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    { label: "Explain Blast", value: "Explain this blast radius", icon: "🔍", accent: "blue" },
    { label: "Root Cause", value: "Identify the root cause", icon: "🎯", accent: "red" },
    { label: "Propagation", value: "Show impact propagation", icon: "📡", accent: "orange" },
    { label: "Affected Services", value: "List affected services", icon: "📋", accent: "blue" },
    { label: "Biz Impact", value: "Summarize business impact", icon: "💰", accent: "green" },
    { label: "Next Steps", value: "Recommend next investigation steps", icon: "🔧", accent: "purple" }
  ];

  const accentStyles: Record<string, string> = {
    blue: "border-l-blue-500 hover:bg-blue-50/20 dark:hover:bg-blue-950/20",
    red: "border-l-red-500 hover:bg-red-50/20 dark:hover:bg-red-950/20",
    orange: "border-l-orange-500 hover:bg-orange-50/20 dark:hover:bg-orange-950/20",
    green: "border-l-emerald-500 hover:bg-emerald-50/20 dark:hover:bg-emerald-950/20",
    purple: "border-l-purple-500 hover:bg-purple-50/20 dark:hover:bg-purple-950/20"
  };

  const circleStyles: Record<string, string> = {
    blue: "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400",
    red: "bg-red-50 dark:bg-red-950/40 text-red-650 dark:text-red-400",
    orange: "bg-orange-50 dark:bg-orange-955/30 text-orange-600 dark:text-orange-450",
    green: "bg-emerald-50 dark:bg-emerald-955/30 text-emerald-600 dark:text-emerald-450",
    purple: "bg-purple-50 dark:bg-purple-955/30 text-purple-600 dark:text-purple-400"
  };

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
    <div className="flex flex-col bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
      {/* HEADER SECTION */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/35 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-[#6366f1] to-[#3b82f6] flex items-center justify-center shadow-md shrink-0">
            <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6c0-3.313-2.687-6-6-6s-6 2.687-6 6a6 6 0 0 0 6 6Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 22a9.25 9.25 0 0 0 9.25-9.25c0-5.108-4.142-9.25-9.25-9.25S2.75 7.642 2.75 12.75A9.25 9.25 0 0 0 12 22Z" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">Blast Radius Investigation</h3>
            <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              <span>📍</span>
              <span className="truncate">Analyzing: {rootLabel || service} incident</span>
            </div>
          </div>
        </div>

        {/* Right Side status */}
        <div className="flex items-center gap-1.5 bg-emerald-500/10 dark:bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/20 text-emerald-600 dark:text-emerald-450 text-[10px] font-bold">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
          </span>
          <span>Live</span>
        </div>
      </div>

      {/* CONTEXT PILL */}
      {showContext && (
        <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-[#f0f0ff] border border-[#e0e0ff] text-indigo-950 flex items-center justify-between text-xs font-semibold shrink-0 shadow-xs">
          <div className="flex items-center gap-1.5 truncate">
            <span className="shrink-0">📍</span>
            <span className="truncate">{contextText}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowContext(false)}
            className="text-indigo-400 hover:text-indigo-700 font-bold text-sm shrink-0 px-1 ml-1"
            title="Dismiss Context"
          >
            ×
          </button>
        </div>
      )}

      {/* CHAT MESSAGES AREA */}
      <div className="flex-1 overflow-y-auto p-3 bg-[#f8f9fa] dark:bg-slate-950/20 rounded-t-2xl space-y-3 min-h-[200px] max-h-[350px] mt-2 border-t border-slate-100 dark:border-slate-800">
        {messages.length === 0 ? (
          <div className="space-y-2.5 pt-1">
            <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              Quick Actions
            </div>
            
            <div className="grid grid-cols-3 gap-2">
              {quickActionsList.map((act) => (
                <button
                  key={act.value}
                  type="button"
                  onClick={() => handleSend(act.value)}
                  disabled={isLoading}
                  className={`flex items-center gap-2 pl-2.5 pr-2 py-2 rounded-lg text-left border-l-4 bg-white dark:bg-slate-800 border-y border-r border-slate-200/80 dark:border-slate-700/60 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all duration-150 hover:shadow-xs hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 ${accentStyles[act.accent]}`}
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 font-bold ${circleStyles[act.accent]}`}>
                    {act.icon}
                  </div>
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {act.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="bg-[#6366f1] text-white rounded-2xl rounded-tr-xs px-3.5 py-2 max-w-[85%] text-xs font-semibold shadow-xs">
                    {m.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className="flex gap-2.5 items-start">
                {/* AI Avatar */}
                <div className="w-6 h-6 rounded-full bg-[#6366f1] text-white font-bold flex items-center justify-center text-[10px] shrink-0 shadow-xs">
                  AI
                </div>

                {/* AI message bubble */}
                <div className="flex-1 min-w-0 bg-white dark:bg-slate-800 border-l-[3px] border-l-[#6366f1] rounded-xl rounded-tl-xs p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-y border-r border-slate-100 dark:border-slate-700/40 relative">
                  <div className="absolute top-2 left-3.5 text-[9px] font-bold text-purple-500 uppercase tracking-wider">
                    AI
                  </div>
                  <div className="pt-2 text-xs">
                    <div dangerouslySetInnerHTML={{ __html: formatAIResponse(m.content) }} />
                  </div>
                  <div className="text-right text-[8px] text-slate-400 dark:text-slate-500 mt-1.5 font-medium">
                    just now
                  </div>
                </div>
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="flex gap-2.5 items-center text-xs text-slate-450 dark:text-slate-500 font-semibold p-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#6366f1]" />
            AI is analyzing blast radius...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* INPUT BAR */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-slate-200 dark:border-slate-700 bg-[#f1f5f9] dark:bg-slate-900/50 flex items-center gap-2 shrink-0">
        <div className="flex-1 flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#e2e8f0] dark:border-slate-650 bg-white dark:bg-slate-900 shadow-sm focus-within:ring-1 focus-within:ring-[#6366f1] transition-shadow">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this incident..."
            disabled={isLoading}
            className="flex-1 text-xs bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="h-8.5 w-8.5 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] text-white flex items-center justify-center disabled:opacity-40 transition-colors shadow-sm shrink-0"
          title="Send"
        >
          <svg className="w-4 h-4 text-white transform rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="h-8.5 w-8.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:text-slate-850 dark:hover:text-white flex items-center justify-center transition-colors shrink-0 shadow-sm"
            title="Clear Chat"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </form>
    </div>
  );
}
