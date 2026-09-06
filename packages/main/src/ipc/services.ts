import type { AppInfo, UpdateChannel, UpdateCheckResult } from '@nexnote/shared';
import type { AppStore } from '../vault/app-store';
import type { VaultSession } from '../vault/vault-session';
import type { VaultFsService } from '../fs/fs-service';
import type { VaultWatchService } from '../fs/watch-service';
import type { WindowManager } from '../window';

/** 注入给所有 IPC handler 的服务集合（全部可替身，便于单测）。 */
export interface IpcServices {
  windows: WindowManager;
  appStore: AppStore;
  vaultSession: VaultSession;
  fs: VaultFsService;
  dialogs: { pickDirectory(): Promise<string | null> };
  trash(absPath: string): Promise<void>;
  /** 在系统文件管理器中显示文件（fs:revealInFinder） */
  revealItem(absPath: string): Promise<void>;
  /** vault 文件监视（fs:changed 事件源，DEV-003） */
  watch: VaultWatchService;
  appInfo(): AppInfo;
  checkForUpdates(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<UpdateCheckResult>;
  installUpdate(): { willRestart: true };
  setUpdateChannel(channel: UpdateChannel): UpdateCheckResult;
}
