import { ServiceAgent } from '../agents/ServiceAgent';
import { IncidentAgent } from '../agents/IncidentAgent';
import { RCAAgent } from '../agents/RCAAgent';
import { BlastRadiusAgent } from '../agents/BlastRadiusAgent';
import { PredictionAgent } from '../agents/PredictionAgent';
import { WorkflowAgent } from '../agents/WorkflowAgent';
import { ExecutiveAgent } from '../agents/ExecutiveAgent';
import type { AgentConfig, PageType } from '../types';

const agents: Record<PageType, AgentConfig> = {
  service: ServiceAgent,
  incident: IncidentAgent,
  rca: RCAAgent,
  blast: BlastRadiusAgent,
  prediction: PredictionAgent,
  workflow: WorkflowAgent,
  executive: ExecutiveAgent,
};

export function getAgentConfig(pageType: PageType): AgentConfig {
  return agents[pageType] ?? ExecutiveAgent;
}
