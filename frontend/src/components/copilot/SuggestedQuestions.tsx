import { Sparkles } from 'lucide-react';

interface Props {
  questions: string[];
  onSelect: (q: string) => void;
  disabled?: boolean;
}

export default function SuggestedQuestions({ questions, onSelect, disabled }: Props) {
  if (questions.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1.5">
        <Sparkles className="h-3 w-3" />
        Suggested questions
      </p>
      <div className="flex flex-wrap gap-1.5">
        {questions.map((q) => (
          <button
            key={q}
            onClick={() => onSelect(q)}
            disabled={disabled}
            className="text-left text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background hover:bg-card-hover hover:border-primary/40 text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
