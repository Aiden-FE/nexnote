import type { AppInfo, UpdateCheckResult } from '@nexnote/shared';
import type { AppStore } from '../vault/app-store';
import type { VaultSession } from '../vault/vault-session';
import type { VaultFsService } from '../fs/fs-service';
import type { VaultWatchService } from '../fs/watch-service';
import type { GitService } from '../git/git-service';
import type { WindowManager } from '../window';

/** 注入给所有 IPC handler 的服务集合（全部可替身，便于单测）。 */
export interface IpcServices {
  windows: WindowManager;
  appStore: AppStore;
  vaultSession: VaultSession;
  fs: VaultFsService;
  git: GitService;
  /** 系统目录选择对话框（渲染层无原生能力，统一走主进程） */
  dialogs: {
    pickDirectory(): Promise<string | null>;
  };
  /** 移入系统回收站（fs:delete toTrash=true 时使用） */
  trash(absPath: string): Promise<void>;
  /** 在系统文件管理器中显示文件（fs:revealInFinder） */
  revealItem(absPath: string): Promise<void>;
  /** vault 文件监视（fs:changed 事件源，DEV-003） */
  watch: VaultWatchService;
  appInfo(): AppInfo;
  checkForUpdates(): Promise<UpdateCheckResult>;
}
