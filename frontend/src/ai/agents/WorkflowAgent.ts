import type { AgentConfig } from '../types';

export const WorkflowAgent: AgentConfig = {
  pageType: 'workflow',
  title: 'Remediation Advisor',
  role: 'Autonomous Remediation Advisor',
  suggestedQuestions: [
    'What has already been investigated?',
    'Why is approval required?',
    'What happens after approval?',
    'Explain remediation risk',
    'Explain rollback plan',
  ],
};
