import type { Result } from '../result';

/** ai:* 命名空间占位。DEV-009/010/011/012（AI 层）在此追加真实通道。 */
export const AI_CHANNELS = ['ai:ping'] as const;

export type AiChannel = (typeof AI_CHANNELS)[number];

export interface AiChannelMap {
  'ai:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'ai'; implementedBy: 'DEV-009' }>;
  };
}
