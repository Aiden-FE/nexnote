import type { AgentScenario, AiFeatureKey } from '@nexnote/shared';

/**
 * scenario → AI 功能指派键（Provider Profile 选择）。
 *
 * debug 复用 chat；translation 拥有独立指派键（AiFeatureKey 'translation'），
 * 未设置时回退 writing 保持旧行为。
 */
export function scenarioFeature(scenario: AgentScenario): AiFeatureKey {
  if (scenario === 'debug') return 'chat';
  return scenario;
}
