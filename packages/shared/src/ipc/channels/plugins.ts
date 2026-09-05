import type { Result } from '../result';

/** plugins:* 命名空间占位。DEV-013/014/015（插件系统）在此追加真实通道。 */
export const PLUGINS_CHANNELS = ['plugins:ping'] as const;

export type PluginsChannel = (typeof PLUGINS_CHANNELS)[number];

export interface PluginsChannelMap {
  'plugins:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'plugins'; implementedBy: 'DEV-013' }>;
  };
}
