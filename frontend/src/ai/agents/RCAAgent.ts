import type { AgentConfig } from '../types';

export const RCAAgent: AgentConfig = {
  pageType: 'rca',
  title: 'RCA Expert',
  role: 'Root Cause Analysis Expert',
  suggestedQuestions: [
    'Explain why RCA chose this root cause',
    'Explain confidence score',
    'Compare top candidates',
    'Explain signal correlation',
    'Explain supporting evidence',
  ],
};
