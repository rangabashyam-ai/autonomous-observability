import { useState, useRef, useEffect } from 'react';
import { askCopilot } from '../api/client';
import { PageHeader, inputClass, btnPrimary } from '../components/ui';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  actions?: string[];
}

const SUGGESTIONS = [
  'Why is Payment Authorization slow?',
  'What changed before this incident?',
  'Which services are impacted?',
  'What is the likely root cause?',
  'Have we seen this pattern before?',
  'What fix worked last time?',
  'What should I check next?',
  'Is this issue localized or systemic?',
];

export default function CopilotPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'I\'m your AI Operations Copilot. I can help with root cause analysis, impact assessment, change correlation, and historical pattern matching. What would you like to know?',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (question: string) => {
    if (!question.trim()) return;
    setMessages((m) => [...m, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      const res = await askCopilot(question);
      setMessages((m) => [...m, {
        role: 'assistant',
        content: res.answer,
        sources: res.sources,
        actions: res.suggested_actions,
      }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Sorry, I encountered an error processing your question.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <PageHeader
        title="AI Operations Copilot"
        description="Ask natural language questions about incidents, root causes, impact, and remediation"
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => send(s)}
            className="text-xs px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-full hover:border-blue-500 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-4 rounded-xl text-sm ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.sources && msg.sources.length > 0 && (
                <p className="text-[10px] text-slate-600 dark:text-slate-500 mt-2">Sources: {msg.sources.join(', ')}</p>
              )}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.actions.map((a) => (
                    <p key={a} className="text-[10px] text-blue-700 dark:text-blue-400">→ {a}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-sm text-slate-500 animate-pulse">Analyzing operational data...</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(input)}
          placeholder="Ask about incidents, root causes, impact..."
          className={`flex-1 px-4 py-3 ${inputClass} rounded-xl`}
        />
        <button
          onClick={() => send(input)}
          disabled={loading}
          className={`px-6 py-3 rounded-xl ${btnPrimary}`}
        >
          Send
        </button>
      </div>
    </div>
  );
}
