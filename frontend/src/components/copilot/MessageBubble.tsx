import type { ChatMessage } from '../../ai/types';
import { Bot, User, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

interface Props {
  message: ChatMessage;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const hasError = !isUser && message.response?.model && message.response.model.startsWith('error-');

  if (hasError) {
    const errorModel = message.response?.model;
    const isUnconfigured = errorModel === 'error-unconfigured';
    return (
      <div className="flex gap-2.5 flex-row">
        <div className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center bg-red-500/10 text-red-500">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-red-500/10 dark:bg-red-500/5 border border-red-500/20 text-red-700 dark:text-red-400">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">
                {isUnconfigured ? 'AI Integration Inactive' : 'AI Assistant Offline'}
              </span>
              <p className="text-xs">{message.content}</p>
              {message.response?.recommended_actions && message.response.recommended_actions.length > 0 && (
                <div className="mt-2 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80 block">Recommended Actions:</span>
                  <ul className="space-y-0.5">
                    {message.response.recommended_actions.map((act, idx) => (
                      <li key={idx} className="text-xs flex items-center gap-1 opacity-90">
                        <span className="text-[8px]">•</span> {act}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'h-7 w-7 shrink-0 rounded-full flex items-center justify-center',
          isUser ? 'bg-primary/20 text-primary' : 'bg-card-hover text-text-secondary'
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-white'
            : 'bg-card-hover border border-border text-text-primary'
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {!isUser && message.response?.findings && message.response.findings.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-text-secondary">
            {message.response.findings.map((f, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-primary">•</span>
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
