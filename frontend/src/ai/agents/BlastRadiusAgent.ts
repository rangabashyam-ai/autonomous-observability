import type { AgentConfig } from '../types';

export const BlastRadiusAgent: AgentConfig = {
  pageType: 'blast',
  title: 'Impact Analyst',
  role: 'Impact Analysis Specialist',
  suggestedQuestions: [
    'Explain the cascade chain',
    'Why are downstream services affected?',
    'Explain business impact',
    'Recommend containment strategy',
    'Recommend recovery order',
  ],
};
