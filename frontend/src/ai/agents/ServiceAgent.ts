import type { AgentConfig } from '../types';

export const ServiceAgent: AgentConfig = {
  pageType: 'service',
  title: 'Service Expert',
  role: 'Payment Authorization Service Expert',
  suggestedQuestions: [
    'Why is this service degraded?',
    'Which alerts are impacting this service?',
    'What is the most likely root cause?',
    'Which downstream services are affected?',
    'What changed recently?',
  ],
};
