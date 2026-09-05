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
    },
  ) {}

  getCurrent(): VaultInfo | null {
    return this.currentVault;
  }

  async open(root: string): Promise<VaultInfo> {
    const info = await ensureVault(root);
    this.currentVault = info;
    this.deps.appStore.setLastVault(info.root);
    this.deps.appStore.touchRecent(info.root);
    this.broadcast();
    return info;
  }

  close(): void {
    this.currentVault = null;
    this.deps.appStore.setLastVault(null);
    this.broadcast();
  }

  /** 启动时恢复上次 vault；目录已不存在则静默跳过并清除记录。 */
  async restoreLast(): Promise<VaultInfo | null> {
    const last = this.deps.appStore.get().lastVaultPath;
    if (!last) return null;
    try {
      await validateVaultRoot(last);
    } catch {
      this.deps.appStore.setLastVault(null);
      return null;
    }
    return this.open(last);
  }

  private broadcast(): void {
    this.deps.windows.sendToMainWindow('vault:changed', { vault: this.currentVault });
  }
}
