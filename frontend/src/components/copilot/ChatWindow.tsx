import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { useCopilot } from '../../ai/context/CopilotProvider';
import MessageBubble from './MessageBubble';
import SuggestedQuestions from './SuggestedQuestions';
import EvidencePanel from './EvidencePanel';

export default function ChatWindow() {
  const {
    messages,
    isLoading,
    pageContext,
    agentTitle,
    suggestedQuestions,
    sendMessage,
    clearConversation,
    lastResponse,
  } = useCopilot();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const q = input;
    setInput('');
    await sendMessage(q);
  };

  const entity = pageContext?.selectedEntity ?? 'this page';

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-text-secondary">
              Context scoped to <span className="font-medium text-text-primary">{entity}</span>
            </p>
            <p className="text-xs text-text-secondary/70">
              {agentTitle} — answers only from current investigation context
            </p>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Analyzing context...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {messages.length === 0 && (
        <div className="px-4 pb-3">
          <SuggestedQuestions
            questions={suggestedQuestions}
            onSelect={(q) => sendMessage(q)}
            disabled={isLoading}
          />
        </div>
      )}

      <EvidencePanel response={lastResponse} />

      <form onSubmit={handleSubmit} className="p-3 border-t border-border flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the current context..."
          disabled={isLoading || !pageContext}
          className="flex-1 h-9 px-3 text-sm rounded-lg border border-border bg-background text-text-primary placeholder:text-text-secondary/60 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim() || !pageContext}
          className="h-9 w-9 flex items-center justify-center rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearConversation}
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors"
            title="Clear conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </form>
    </div>
  );
}
