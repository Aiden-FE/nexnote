import type { Result } from '../result';

/** git:* 命名空间占位。DEV-007（Git 底座）在此追加真实通道。 */
export const GIT_CHANNELS = ['git:ping'] as const;

export type GitChannel = (typeof GIT_CHANNELS)[number];

export interface GitChannelMap {
  'git:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'git'; implementedBy: 'DEV-007' }>;
  };
}
