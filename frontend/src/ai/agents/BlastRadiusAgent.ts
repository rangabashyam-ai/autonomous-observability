import type { AgentConfig } from '../types';

export const BlastRadiusAgent: AgentConfig = {
  pageType: 'blast',
  title: 'Impact Analyst',
  role: 'Impact Analysis Specialist',
  suggestedQuestions: [
<<<<<<< HEAD
    'Explain the cascade chain',
    'Why are downstream services affected?',
    'Explain business impact',
    'Recommend containment strategy',
    'Recommend recovery order',
=======
    'How is the incident propagating?',
    'Explain the blast radius from the root cause',
    'Why are downstream services affected?',
    'What is the business impact?',
    'Recommend containment strategy',
    'What is the recovery order?',
>>>>>>> origin/main
  ],
};
