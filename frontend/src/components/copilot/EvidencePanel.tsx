import type { CopilotResponse } from '../../ai/types';
import { FileSearch, Lightbulb, Shield } from 'lucide-react';

interface Props {
  response: CopilotResponse | null;
}

export default function EvidencePanel({ response }: Props) {
  if (!response) return null;

  const hasContent =
    response.evidence.length > 0 ||
    response.recommended_actions.length > 0 ||
    response.confidence;

  if (!hasContent) return null;

  return (
    <div className="border-t border-border bg-background/50 p-3 space-y-3">
      {response.confidence && (
        <div className="flex items-center gap-2 text-xs">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span className="text-text-secondary">Confidence:</span>
          <span className="font-medium text-text-primary">{response.confidence}</span>
        </div>
      )}

      {response.evidence.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1.5 mb-1.5">
            <FileSearch className="h-3 w-3" />
            Evidence
          </p>
          <ul className="space-y-1">
            {response.evidence.map((e, i) => (
              <li key={i} className="text-xs text-text-secondary pl-3 border-l-2 border-primary/30">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {response.recommended_actions.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1.5 mb-1.5">
            <Lightbulb className="h-3 w-3" />
            Recommended actions
          </p>
          <ul className="space-y-1">
            {response.recommended_actions.map((a, i) => (
              <li key={i} className="text-xs text-text-primary">
                {i + 1}. {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
