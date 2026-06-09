import type { AgentConfig } from '../types';

export const ExecutiveAgent: AgentConfig = {
  pageType: 'executive',
  title: 'Executive Advisor',
  role: 'Executive Operations Advisor',
  suggestedQuestions: [
    'Summarize platform health',
    'What are the biggest risks today?',
    'What is our revenue exposure?',
    'What are the top repeating failures?',
    'Give me an executive briefing',
  ],
};
