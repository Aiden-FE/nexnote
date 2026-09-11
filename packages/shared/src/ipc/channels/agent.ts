import type { Result } from '../result';
import type { AgentApprovalResponse, AgentRunRequest, AgentScenario } from '../../types/agent';

export const AGENT_SCENARIOS = ['chat', 'writing', 'debug'] as const;
export const AGENT_CHANNELS = [
  'agent:run:chat',
  'agent:run:writing',
  'agent:run:debug',
  'agent:cancel',
  'agent:approval:respond',
] as const;
export type AgentChannel = (typeof AGENT_CHANNELS)[number];
export interface AgentChannelMap {
  'agent:run:chat': { request: AgentRunRequest; response: Result<{ runId: string }> };
  'agent:run:writing': { request: AgentRunRequest; response: Result<{ runId: string }> };
  'agent:run:debug': { request: AgentRunRequest; response: Result<{ runId: string }> };
  'agent:cancel': { request: { runId: string }; response: Result<{ cancelled: boolean }> };
  'agent:approval:respond': {
    request: AgentApprovalResponse;
    response: Result<{ accepted: boolean }>;
  };
}
export function scenarioChannel(scenario: AgentScenario): AgentChannel {
  return `agent:run:${scenario}` as AgentChannel;
}
