import type { AppInfo, UpdateChannel, UpdateCheckResult } from '@nexnote/shared';
import type { AppStore } from '../vault/app-store';
import type { VaultSession } from '../vault/vault-session';
import type { VaultFsService } from '../fs/fs-service';
import type { VaultWatchService } from '../fs/watch-service';
import type { GitService } from '../git/git-service';
import type { WindowManager } from '../window';
import type { AiService } from '../ai/ai-service';
import type { LinkIndexService } from '../indexer/index-service';
import type { ConfidenceService } from '../confidence/confidence-service';
import type { RetrievalService } from '../retrieval/retrieval-service';
import type { PluginService } from '../plugins/plugin-service';
import type { SkillService } from '../skills/skill-service';

/** 注入给所有 IPC handler 的服务集合（全部可替身，便于单测）。 */
export interface IpcServices {
  windows: WindowManager;
  appStore: AppStore;
  vaultSession: VaultSession;
  fs: VaultFsService;
  /** AI 组装层（DEV-009）：密钥仅存在于此层 + 系统钥匙串 */
  ai: AiService;
  git: GitService;
  /** 系统目录选择对话框（渲染层无原生能力，统一走主进程） */
  dialogs: {
    pickDirectory(): Promise<string | null>;
    pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
  };
  /** 移入系统回收站（fs:delete toTrash=true 时使用） */
  trash(absPath: string): Promise<void>;
  /** 在系统文件管理器中显示文件（fs:revealInFinder） */
  revealItem(absPath: string): Promise<void>;
  /** vault 文件监视（fs:changed 事件源，DEV-003） */
  watch: VaultWatchService;
  /** SQLite 关系索引（DEV-004）。 */
  index: LinkIndexService;
  confidence?: ConfidenceService;
  /** DEV-011 向量召回（可选：未打开 vault/无 embedding 时降级）。 */
  retrieval?: RetrievalService;
  /** DEV-013 插件沙箱运行时与能力 RPC。 */
  plugins: PluginService;
  /** DEV-014 检索 Skill 系统（多 Skill 合并重排）。 */
  skills?: SkillService;
  appInfo(): AppInfo;
  checkForUpdates(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<UpdateCheckResult>;
  installUpdate(): { willRestart: true };
  setUpdateChannel(channel: UpdateChannel): UpdateCheckResult;
}
