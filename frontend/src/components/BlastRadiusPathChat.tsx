import { useState, useRef, useEffect } from 'react';
import { Bot, Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { chatBlastRadius } from '../api/client';
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

  const suggestedPrompts = [
    'Explain this blast radius',
    'Identify the root cause',
    'Show impact propagation',
    'List affected services',
    'Summarize business impact',
    'Recommend next investigation steps',
  ];

  return (
    <div className="flex flex-col bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden h-[300px] shadow-sm">
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-sky-50 to-blue-50 dark:from-slate-900 dark:to-slate-900 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-sky-600 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Blast Radius Investigation</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Analyze blast propagation and downstream impact</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${mutedText} flex items-center gap-1`}>
              <Sparkles className="w-2.5 h-2.5" />
              Quick Actions
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {suggestedPrompts.map((p) => (
                <button
                   key={p}
                   type="button"
                   onClick={() => handleSend(p)}
                   disabled={isLoading}
                   className="text-left text-xs px-2.5 py-1.5 rounded-lg border border-slate-250 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 hover:border-sky-500 hover:bg-sky-50/10 text-slate-750 dark:text-slate-200 transition-colors disabled:opacity-50 truncate"
                   title={p}
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
                ? 'bg-sky-600 text-white ml-4'
                : 'bg-slate-100 dark:bg-slate-900/60 text-slate-800 dark:text-slate-200 mr-2 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <p className="whitespace-pre-wrap text-xs">{m.content}</p>
          </div>
        ))}

        {isLoading && (
          <div className={`flex items-center gap-2 text-xs ${mutedText}`}>
            <Loader2 className="w-3 h-3 animate-spin" />
            AI is analyzing blast radius...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-2 border-t border-slate-200 dark:border-slate-700 flex gap-1.5 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about this blast radius..."
          disabled={isLoading}
          className="flex-1 h-8 px-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="h-8 w-8 flex items-center justify-center rounded-lg bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50"
          style={{ backgroundColor: '#0284c7' }}
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
