import { useEffect, useRef, useState } from 'react';
import { askReportChat } from '../api/client';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ReportChatProps {
  reportContext: string;
  reportType: string;
}

export function ReportChat({ reportContext, reportType }: ReportChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const question = input.trim();
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

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
      <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase mb-3">
        Ask about this report
      </p>

      {/* Message history */}
      {(messages.length > 0 || loading) && (
        <div className="max-h-48 overflow-y-auto space-y-2 mb-3 pr-1">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-bl-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl rounded-bl-sm">
                <span className="flex gap-1 items-center h-3">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}

          {/* Scroll anchor — always kept at the bottom */}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask a question about this report…"
          disabled={loading}
          className="flex-1 text-xs px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-50 placeholder:text-slate-400"
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors shrink-0"
        >
          Ask
        </button>
      </div>
    </div>
  );
}
