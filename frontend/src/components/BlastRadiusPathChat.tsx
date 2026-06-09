import { useState, useRef, useEffect } from 'react';
import { Bot, Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { chatDependencyPath } from '../api/client';
import { mutedText } from './ui';

interface Props {
  service: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function BlastRadiusPathChat({ service }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Reset chat when the analyzed service changes
  useEffect(() => {
    setMessages([]);
  }, [service]);

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
      // Build a simple chat history payload for the backend if needed
      const historyPayload = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      
      const response = await chatDependencyPath(service, text, historyPayload);
      
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
        content: `Error checking path: ${err.message || 'Unknown error occurred'}`,
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

  const suggestedPrompts = [
    'Check this dependency path for errors',
    'Identify the root cause in the path',
    'How does failure propagate here?',
  ];

  return (
    <div className="flex flex-col bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden h-[300px] shadow-sm">
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-slate-900 dark:to-slate-900 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 dark:text-white">Path Diagnostics</h3>
            <p className="text-[9px] text-slate-500 dark:text-slate-400">Trace and diagnose downstream path anomalies</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className={`text-[9px] font-semibold uppercase tracking-wider ${mutedText} flex items-center gap-1`}>
              <Sparkles className="w-2.5 h-2.5" />
              Diagnose Path
            </p>
            <div className="flex flex-col gap-1">
              {suggestedPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSend(p)}
                  disabled={isLoading}
                  className="text-left text-[10px] px-2.5 py-1.5 rounded-lg border border-slate-250 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 hover:border-emerald-500 text-slate-750 dark:text-slate-200 transition-colors disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`text-xs leading-relaxed rounded-lg px-2.5 py-1.5 ${
              m.role === 'user'
                ? 'bg-emerald-600 text-white ml-4'
                : 'bg-slate-100 dark:bg-slate-900/60 text-slate-800 dark:text-slate-200 mr-2 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <p className="whitespace-pre-wrap text-[11px]">{m.content}</p>
          </div>
        ))}

        {isLoading && (
          <div className={`flex items-center gap-2 text-[10px] ${mutedText}`}>
            <Loader2 className="w-3 h-3 animate-spin" />
            Gemini is evaluating dependency path...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-2 border-t border-slate-200 dark:border-slate-700 flex gap-1.5 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Gemini to diagnose this path..."
          disabled={isLoading}
          className="flex-1 h-8 px-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="h-8 w-8 flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
          style={{ backgroundColor: '#059669' }}
        >
          <Send className="w-3 h-3" />
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-slate-850 dark:hover:text-white"
            title="Clear Chat"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </form>
    </div>
  );
}
