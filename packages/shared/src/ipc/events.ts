import type { GitStatus } from './channels/git';
import type { VaultInfo } from '../types/vault';
import type { UpdateCheckResult, UpdateChannel } from './channels/app';
import type { AiConfigState } from '../types/ai';

/**
 * 内置语义向量下载进度载荷（ADR-0027 / DEV-121）。
 * downloading 阶段携带分文件字节进度；ready 表示三个固定文件均已通过 SHA-256 校验。
 */
export interface BuiltInEmbeddingDownloadStatus {
  phase: 'downloading' | 'ready' | 'error';
  file?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  done?: boolean;
  /** ready 时给出 generation identity（model/revision/dtype/维度/度量）。 */
  identity?: string;
  /** error 阶段的失败原因（下载失败或校验不通过）。 */
  error?: string;
}
import type { AgentScenario, AgentRunEvent } from '../types/agent';
import type { ChatStreamEvent } from '../types/ai';
import type { IndexStatus } from '../types/index';
import type { RetrievalIndexStatusPayload } from '../types/retrieval';
import type { GlobalSettings, VaultSettings } from '../types/settings';
import type { UiLanguage } from '../i18n/message-catalog';

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
  /**
   * DEV-121 内置语义向量下载进度（ADR-0027）。
   * 用户显式启用后才下载固定 revision 的模型文件；
   * error 终态说明校验或网络失败，此时召回退回 FTS + 双链。
   */
  'ai:builtInEmbeddingStatus': BuiltInEmbeddingDownloadStatus;
  /** AI 配置变化（Profile 增删改/分功能指定/embedding generation 变更） */
  'ai:configChanged': { state: AiConfigState };
  /** Git 工作区/上游状态变化；自动提交、pull/push 后推送。 */
  'git:statusChanged': GitStatus;
  /** DEV-073：同步生命周期事件，用于状态栏 loading 阶段文案。 */
  'git:syncProgress': {
    phase: 'fetching' | 'rebasing' | 'merging' | 'pushing' | 'done' | 'error';
    message?: string;
  };
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
  /**
   * DEV-074：主窗口 → 二进制编辑器宿主（WebContentsView）的控制指令。
   * 宿主只处理 kind 与自身匹配的指令（kind 为宿主打开时的文档格式）。
   */
  'binary:editorCommand': BinaryEditorCommand;
  /** DEV-096：原生应用菜单动作下发到渲染层执行。 */
  'menu:action': MenuAction;
}

export type MenuAction =
  | { type: 'createNote'; format: 'native-block' | 'markdown' }
  | { type: 'createBlankBinary'; kind: 'xlsx' | 'xmind' }
  | { type: 'importDocx' }
  | { type: 'importXlsx' }
  | { type: 'importXmind' }
  | { type: 'printDocument' };

interface BinaryEditorCommandBase {
  /** kind 与 TabKind 对齐；宿主用它过滤自身不关心的指令（DEV-098 后仅 xlsx / mindmap）。 */
  kind: 'xlsx' | 'mindmap';
  /** 文档 vault 相对路径（load / flush / destroy 用）。 */
  path?: string;
}

/** 主窗口 → 二进制编辑器宿主的控制指令（ADR-0023：language 必须显式携带，不允许静默回退）。 */
export type BinaryEditorCommand =
  | (BinaryEditorCommandBase & { command: 'load' })
  | (BinaryEditorCommandBase & { command: 'flush' })
  | (BinaryEditorCommandBase & { command: 'theme'; theme?: 'light' | 'dark' })
  | (BinaryEditorCommandBase & { command: 'language'; language: UiLanguage })
  | (BinaryEditorCommandBase & { command: 'destroy' });

export interface FsChangeEvent {
  kind: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change';
  path: string;
  /** sidecar format for added Markdown documents; absent → legacy native-block. */
  format?: 'native-block' | 'markdown';
  /**
   * 事件来源：'app' = 应用自身写入（主进程 AppWriteTracker 登记命中）。
   * 渲染层收到 origin:'app' 时不弹外部修改冲突，仅静默刷新基线/重载。
   * 缺省 = 外部变化，保持原有 conflict/reload 语义。
   */
  origin?: 'app';
}

export const IPC_EVENT_CHANNELS: readonly string[] = [
  'vault:changed',
  'fs:changed',
  'app:updateStatus',
  'agent:runEvent',
  'ai:retrievalStatus',
  'ai:builtInEmbeddingStatus',
  'ai:configChanged',
  'git:statusChanged',
  'git:syncProgress',
  'plugins:changed',
  'skills:changed',
  'index:statusChanged',
  'index:confidenceChanged',
  'settings:changed',
  'binary:editorCommand',
  'menu:action',
];

export type IpcEventChannel = keyof IpcEventMap & string;

export function isIpcEventChannel(value: string): value is IpcEventChannel {
  return IPC_EVENT_CHANNELS.includes(value);
}
