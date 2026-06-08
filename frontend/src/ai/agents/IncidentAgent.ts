import type { AgentConfig } from '../types';

export const IncidentAgent: AgentConfig = {
  pageType: 'incident',
  title: 'Incident Specialist',
  role: 'Incident Investigation Specialist',
  suggestedQuestions: [
    'Explain this incident',
    'Create executive summary',
    'Explain root cause',
    'What alerts triggered this incident?',
    'What lessons can be learned?',
  ],
};
