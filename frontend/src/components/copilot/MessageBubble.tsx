import type { ChatMessage } from '../../ai/types';
import { Bot, User } from 'lucide-react';
import { cn } from '../../lib/cn';

interface Props {
  message: ChatMessage;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

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
