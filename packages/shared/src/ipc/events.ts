import type { GitStatus } from './channels/git';
import type { VaultInfo } from '../types/vault';

/** 主进程 → 渲染层推送事件契约。 */
export interface IpcEventMap {
  /** 当前 vault 变化（打开/关闭/切换）。vault=null 表示回到向导 */
  'vault:changed': { vault: VaultInfo | null };
  /** vault 文件系统变化（DEV-003，chokidar 驱动）。 */
  'fs:changed': FsChangeEvent;
  /** Git 工作区/上游状态变化；自动提交、pull/push 后推送。 */
  'git:statusChanged': GitStatus;
}

export interface FsChangeEvent {
  kind: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change';
  path: string;
}

export const IPC_EVENT_CHANNELS: readonly string[] = [
  'vault:changed',
  'fs:changed',
  'git:statusChanged',
];

export type IpcEventChannel = keyof IpcEventMap & string;

export function isIpcEventChannel(value: string): value is IpcEventChannel {
  return IPC_EVENT_CHANNELS.includes(value);
}
