import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { useCopilot } from '../ai/context/CopilotProvider';
import { mutedText } from './ui';

type Selection =
  | { type: 'node'; detail: any }
  | { type: 'edge'; detail: any }
  | null;

export default function BlastRadiusCopilotChat({ selection }: { selection: Selection }) {
  const {
    messages,
    isLoading,
    agentTitle,
    suggestedQuestions,
    sendMessage,
    clearConversation,
    enabled,
  } = useCopilot();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const q = input;
    setInput('');
    await sendMessage(q);
  };

  if (!enabled) {
    return (
      <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
        <p className={`text-xs ${mutedText}`}>AI assistant is disabled.</p>
      </div>
    );
  }

  const selectedNode = selection?.type === 'node' ? selection.detail : null;
  const selectedEdge = selection?.type === 'edge' ? selection.detail : null;

  const blastQuestions = [
    ...(selectedNode
      ? [`Why is ${selectedNode.label} affected?`, `Show dependency paths for ${selectedNode.label}`]
      : selectedEdge
        ? [`Why does failure propagate from ${selectedEdge.sourceLabel} to ${selectedEdge.targetLabel}?`]
        : ['How is the incident propagating?', 'Explain the blast radius']),
    'What is the business impact?',
    ...suggestedQuestions.slice(0, 1),
  ];

  return (
    <div className="flex flex-col bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden h-[340px] shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-blue-50 to-violet-50 dark:from-slate-900 dark:to-slate-900 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Impact Analyst</h3>
            <p className={`text-[10px] ${mutedText}`}>Ask about propagation, blast radius & impact</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${mutedText} flex items-center gap-1`}>
              <Sparkles className="w-3 h-3" />
              Try asking
            </p>
            <div className="flex flex-col gap-1.5">
              {blastQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendMessage(q)}
                  disabled={isLoading}
                  className="text-left text-[11px] px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 hover:border-blue-400 dark:hover:border-blue-500 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`text-xs leading-relaxed rounded-lg px-3 py-2 ${
              m.role === 'user'
                ? 'bg-blue-600 text-white ml-4'
                : 'bg-slate-100 dark:bg-slate-900/60 text-slate-800 dark:text-slate-200 mr-2 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.role === 'assistant' && m.response?.findings && m.response.findings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[10px] opacity-90">
                {m.response.findings.slice(0, 3).map((f, i) => (
                  <li key={i}>• {f}</li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {isLoading && (
          <div className={`flex items-center gap-2 text-[11px] ${mutedText}`}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {agentTitle} is analyzing...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-2.5 border-t border-slate-200 dark:border-slate-700 flex gap-1.5 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about incident propagation..."
          disabled={isLoading}
          className="flex-1 h-8 px-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="h-8 w-8 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearConversation}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-slate-800 dark:hover:text-white"
            title="Clear"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </form>
    </div>
  );
}
