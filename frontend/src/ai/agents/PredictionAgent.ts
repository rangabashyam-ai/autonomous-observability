import type { AgentConfig } from '../types';

export const PredictionAgent: AgentConfig = {
  pageType: 'prediction',
  title: 'Predictive Analyst',
  role: 'Predictive Operations Analyst',
  suggestedQuestions: [
    'Why was this prediction generated?',
    'What evidence supports it?',
    'How confident is the model?',
    'What should we do now?',
    'What happens if ignored?',
  ],
};
