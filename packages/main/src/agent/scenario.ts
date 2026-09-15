import type { AgentScenario, AiFeatureKey } from '@nexnote/shared';

/**
 * scenario → AI 功能指派键（Provider Profile 选择）。
 *
 * debug 复用 chat；translation 复用 writing——翻译是文本生成，不新开设置分区，
 * 与 DEV-041「翻译不改配置结构」一致。
 */
export function scenarioFeature(scenario: AgentScenario): AiFeatureKey {
  if (scenario === 'debug') return 'chat';
  if (scenario === 'translation') return 'writing';
  return scenario;
}
