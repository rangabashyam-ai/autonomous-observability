import InlineCopilot from '../copilot/InlineCopilot';
import { cn } from '../../lib/cn';

export interface DrawerAIAssistantProps {
  pageType: string;
  selectedEntity: string;
  entityData: Record<string, unknown>;
  relatedMetrics?: Record<string, unknown>;
  relatedAlerts?: unknown[];
  relatedIncidents?: unknown[];
  suggestedQuestions?: string[];
  title?: string;
  subtitle?: string;
  className?: string;
  /** Flatter styling when rendered inside a drawer scroll area */
  embedded?: boolean;
}

export default function DrawerAIAssistant({
  title,
  subtitle,
  selectedEntity,
  className,
  embedded = false,
  ...props
}: DrawerAIAssistantProps) {
  const label = selectedEntity;

  return (
    <div
      className={cn(
        embedded ? 'mt-6 border-t border-border pt-6' : 'mt-6 border-t border-border pt-6',
        className
      )}
    >
      <InlineCopilot
        {...props}
        selectedEntity={selectedEntity}
        title={title ?? `AI Assistant: ${label}`}
        subtitle={subtitle ?? `Ask questions about ${label} only`}
        embedded={embedded}
      />
    </div>
  );
}
