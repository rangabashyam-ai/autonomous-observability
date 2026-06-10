export type PageType =
  | 'service'
  | 'incident'
  | 'rca'
  | 'blast'
  | 'prediction'
  | 'workflow'
  | 'executive';

export interface CopilotContextPayload {
  context_scope: 'strict';
  page_type: PageType;
  selected_entity: string;
  entity_data?: Record<string, unknown>;
  related_metrics?: Record<string, unknown>;
  related_alerts?: unknown[];
  related_incidents?: unknown[];
  dependency_data?: Record<string, unknown>;
  analysis_results?: Record<string, unknown>;
  investigation_results?: Record<string, unknown>;
  user_question?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  response?: CopilotResponse;
}

export interface CopilotResponse {
  summary: string;
  findings: string[];
  evidence: string[];
  recommended_actions: string[];
  confidence: string;
  model?: string;
  agent?: string;
  timestamp?: string;
  fallback_reason?: string;
}

export interface AgentConfig {
  pageType: PageType;
  title: string;
  role: string;
  suggestedQuestions: string[];
}

export interface PageContextInput {
  pageType: PageType;
  selectedEntity: string;
  entityData?: Record<string, unknown>;
  relatedMetrics?: Record<string, unknown>;
  relatedAlerts?: unknown[];
  relatedIncidents?: unknown[];
  dependencyData?: Record<string, unknown>;
  analysisResults?: Record<string, unknown>;
  investigationResults?: Record<string, unknown>;
}
