import type { GitStatus } from './channels/git';
import type { VaultInfo } from '../types/vault';
import type { UpdateCheckResult, UpdateChannel } from './channels/app';
import type { ChatStreamEvent, AiConfigState } from '../types/ai';
import type { IndexStatus } from '../types/index';
import type { RetrievalIndexStatusPayload } from '../types/retrieval';

/**
 * 主进程 → 渲染层推送事件契约。
 * preload 暴露类型化 on(channel, listener)，渲染层只监听这里声明的事件。
 */
export interface IpcEventMap {
  /** 当前 vault 变化（打开/关闭/切换）。vault=null 表示回到向导 */
  'vault:changed': { vault: VaultInfo | null };
  /** vault 文件系统变化（DEV-003，chokidar 驱动）。 */
  'fs:changed': FsChangeEvent;
  /** 更新检查、下载、安装流程的实时状态（DEV-018）。 */
  'app:updateStatus': UpdateCheckResult & { progress?: number; channel: UpdateChannel };
  /** AI 对话流事件（统一内部协议，按 streamId 关联） */
  'ai:streamEvent': { streamId: string; event: ChatStreamEvent };
  /** DEV-011 向量索引后台构建进度 */
  'ai:retrievalStatus': { status: RetrievalIndexStatusPayload };
  /** AI 配置变化（Profile 增删改/分功能指定/embedding generation 变更） */
  'ai:configChanged': { state: AiConfigState };
  /** Git 工作区/上游状态变化；自动提交、pull/push 后推送。 */
  'git:statusChanged': GitStatus;
  /** 插件安装/启停/授权/崩溃/命令注册变化（DEV-013）。 */
  'plugins:changed': { reason: string };
  /** 检索 Skill 启停/排序/参数变化（DEV-014）。 */
  'skills:changed': { reason: string };
  /** 关系索引状态变化（扫描进度、ready、error）。DEV-004。 */
  'index:statusChanged': IndexStatus;
  /** 置信度全量/增量计算完成。DEV-008。 */
  'index:confidenceChanged': { paths: string[] | null };
}

export interface FsChangeEvent {
  kind: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change';
  path: string;
}

export const IPC_EVENT_CHANNELS: readonly string[] = [
  'vault:changed',
  'fs:changed',
  'app:updateStatus',
  'ai:streamEvent',
  'ai:retrievalStatus',
  'ai:configChanged',
  'git:statusChanged',
  'plugins:changed',
  'skills:changed',
  'index:statusChanged',
  'index:confidenceChanged',
];

export type IpcEventChannel = keyof IpcEventMap & string;

export function isIpcEventChannel(value: string): value is IpcEventChannel {
  return IPC_EVENT_CHANNELS.includes(value);
}
