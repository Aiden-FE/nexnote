import type { VaultInfo } from '../types/vault';
import type { IndexStatus } from '../types/index';

/**
 * 主进程 → 渲染层推送事件契约。
 * preload 暴露类型化 on(channel, listener)，渲染层只监听这里声明的事件。
 */
export interface IpcEventMap {
  /** 当前 vault 变化（打开/关闭/切换）。vault=null 表示回到向导 */
  'vault:changed': { vault: VaultInfo | null };
  /**
   * vault 文件系统变化（DEV-003，chokidar 驱动）。
   * path 为 vault 相对路径；change 表示内容变化（同一路径重写）。
   */
  'fs:changed': FsChangeEvent;
  /** 关系索引状态变化（扫描进度、ready、error）。DEV-004。 */
  'index:statusChanged': IndexStatus;
}

export interface FsChangeEvent {
  kind: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change';
  /** vault 相对路径（目录时以相对路径表示，无尾斜杠） */
  path: string;
}

export const IPC_EVENT_CHANNELS: readonly string[] = ['vault:changed', 'fs:changed', 'index:statusChanged'];

export type IpcEventChannel = keyof IpcEventMap & string;

export function isIpcEventChannel(value: string): value is IpcEventChannel {
  return IPC_EVENT_CHANNELS.includes(value);
}
