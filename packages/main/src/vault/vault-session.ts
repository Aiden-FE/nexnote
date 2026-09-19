import type { VaultInfo } from '@nexnote/shared';
import { ensureVault, validateVaultRoot } from './vault-manager';
import type { AppStore } from './app-store';
import type { WindowManager } from '../window';

/**
 * 当前窗口绑定的 vault 会话（一个窗口 = 一个 vault；多窗口在 DEV-019 后扩展为按窗口隔离）。
 * open/close 会广播 vault:changed 事件给渲染层。
 */
export class VaultSession {
  private currentVault: VaultInfo | null = null;

  constructor(
    private readonly deps: {
      appStore: AppStore;
      windows: WindowManager;
      /** vault 变化回调（DEV-003 文件监视等外部联动；open 时先完成初始化再提交 session） */
      onChanged?: (vault: VaultInfo | null) => void | Promise<void>;
    },
  ) {}

  getCurrent(): VaultInfo | null {
    return this.currentVault;
  }

  async open(
    root: string,
    beforeCommit?: (candidate: VaultInfo) => Promise<void>,
  ): Promise<VaultInfo> {
    const info = await ensureVault(root);
    // Guard/preflight belongs to the same transaction as index/watch binding. Until it
    // resolves, getCurrent/lastVault/broadcast must continue exposing the old session.
    await beforeCommit?.(info);
    // 原子性：guard/index/watch/git 等初始化全部成功后才提交 currentVault/持久化/广播。
    const previous = this.currentVault;
    try {
      await this.deps.onChanged?.(info);
    } catch (e) {
      // 失败不上线：保留旧 session，并把外部联动（索引等）回滚到旧 root。
      try {
        await this.deps.onChanged?.(previous);
      } catch {
        /* 回滚尽力而为，不掩盖原始错误 */
      }
      throw e;
    }
    this.currentVault = info;
    this.deps.appStore.setLastVault(info.root);
    this.deps.appStore.touchRecent(info.root);
    this.emitChanged();
    return info;
  }

  close(): void {
    this.currentVault = null;
    this.deps.appStore.setLastVault(null);
    this.broadcast();
  }

  /** 启动时恢复上次 vault；目录已不存在则静默跳过并清除记录。 */
  async restoreLast(
    beforeCommit?: (candidate: VaultInfo) => Promise<void>,
  ): Promise<VaultInfo | null> {
    const last = this.deps.appStore.get().lastVaultPath;
    if (!last) return null;
    let safe: string;
    try {
      safe = await validateVaultRoot(last);
    } catch {
      this.deps.appStore.setLastVault(null);
      return null;
    }
    return this.open(safe, beforeCommit);
  }

  private emitChanged(): void {
    this.deps.windows.sendToMainWindow('vault:changed', { vault: this.currentVault });
  }

  private broadcast(): void {
    this.emitChanged();
    void Promise.resolve(this.deps.onChanged?.(this.currentVault)).catch((error) => {
      console.error('[vault] close cleanup failed:', error);
    });
  }
}
