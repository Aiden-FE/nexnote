import type { Result } from '../result';

/**
 * editor:* 命名空间占位。
 * DEV-002（编辑器内核）与 DEV-017（交互细节）在此追加真实通道；
 * 当前仅保留 ping 作为命名空间注册示例（主进程已注册，可 invoke）。
 */
export const EDITOR_CHANNELS = ['editor:ping'] as const;

export type EditorChannel = (typeof EDITOR_CHANNELS)[number];

export interface EditorChannelMap {
  'editor:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'editor'; implementedBy: 'DEV-002' }>;
  };
}
