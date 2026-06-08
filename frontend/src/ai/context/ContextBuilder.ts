import type { CopilotContextPayload, PageContextInput } from '../types';

export function buildContext(
  input: PageContextInput,
  userQuestion = ''
): CopilotContextPayload {
  return {
    context_scope: 'strict',
    page_type: input.pageType,
    selected_entity: input.selectedEntity,
    entity_data: input.entityData ?? {},
    related_metrics: input.relatedMetrics ?? {},
    related_alerts: input.relatedAlerts ?? [],
    related_incidents: input.relatedIncidents ?? [],
    dependency_data: input.dependencyData ?? {},
    analysis_results: input.analysisResults ?? {},
    investigation_results: input.investigationResults ?? {},
    user_question: userQuestion,
  };
}
