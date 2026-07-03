import type { DrawerAIAssistantProps } from './DrawerAIAssistant';

export function defaultDrawerAIProps(opts: {
  selectedEntity: string;
  pageType?: string;
  entityData?: Record<string, unknown>;
  relatedMetrics?: Record<string, unknown>;
  relatedAlerts?: unknown[];
  relatedIncidents?: unknown[];
  suggestedQuestions?: string[];
}): DrawerAIAssistantProps {
  const { selectedEntity, pageType = 'service', entityData = {}, suggestedQuestions, ...rest } = opts;

  return {
    pageType,
    selectedEntity,
    entityData: { name: selectedEntity, ...entityData },
    suggestedQuestions:
      suggestedQuestions ?? [
        `Summarize key insights for ${selectedEntity}`,
        `What should I investigate first for ${selectedEntity}?`,
        `What are the recommended next steps for ${selectedEntity}?`,
      ],
    ...rest,
  };
}

export function pageTypeFromDrawerType(type?: string): string {
  if (type === 'incident') return 'incident';
  if (type === 'infrastructure' || type === 'node') return 'service';
  return 'service';
}
