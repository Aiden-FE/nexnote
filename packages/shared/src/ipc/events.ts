import type { GitStatus } from './channels/git';
import type { VaultInfo } from '../types/vault';
import type { UpdateCheckResult, UpdateChannel } from './channels/app';
import type { AiConfigState } from '../types/ai';
import type { AgentScenario, AgentRunEvent } from '../types/agent';
import type { ChatStreamEvent } from '../types/ai';
import type { IndexStatus } from '../types/index';
import type { RetrievalIndexStatusPayload } from '../types/retrieval';
import type { GlobalSettings, VaultSettings } from '../types/settings';

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
  /** Agent 流事件（仅由主进程 AgentGateway 推送，按 runId 关联）。 */
  'agent:runEvent': { runId: string; scenario: AgentScenario; event: AgentRunEvent };
  /** @deprecated internal compatibility only; omitted from the renderer allowlist. */
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
  /** Settings authoritative state changed. Vault is null when no vault is open. */
  'settings:changed': { global: GlobalSettings; vault: VaultSettings | null };
}

export interface FsChangeEvent {
  kind: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change';
  path: string;
  /** sidecar format for added Markdown documents; absent → legacy native-block. */
  format?: 'native-block' | 'markdown';
}

export const IPC_EVENT_CHANNELS: readonly string[] = [
  'vault:changed',
  'fs:changed',
  'app:updateStatus',
  'agent:runEvent',
  'ai:retrievalStatus',
  'ai:configChanged',
  'git:statusChanged',
  'plugins:changed',
  'skills:changed',
  'index:statusChanged',
  'index:confidenceChanged',
  'settings:changed',
];

export type IpcEventChannel = keyof IpcEventMap & string;

export function isIpcEventChannel(value: string): value is IpcEventChannel {
  return IPC_EVENT_CHANNELS.includes(value);
}
