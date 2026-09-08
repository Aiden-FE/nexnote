import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { RecentVaultEntry, UpdateChannel } from '@nexnote/shared';

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface AppStoreData {
  version: 1;
  lastVaultPath: string | null;
  recentVaults: RecentVaultEntry[];
  windowBounds: WindowBounds | null;
  updateChannel: UpdateChannel | null;
  /** Git binary preference; persisted in app userData rather than a vault. */
  useSystemGit: boolean;
  /** 自动提交防抖（毫秒），持久化到应用 userData；受 DEBOUNCE_RANGE_MS 约束。 */
  autoCommitDebounceMs: number;
  updateAutoDownload: boolean;
  updateCheckOnLaunch: boolean;
}

export const MAX_RECENT_VAULTS = 10;
export const DEFAULT_AUTO_COMMIT_DEBOUNCE_MS = 30_000;
export const AUTO_COMMIT_DEBOUNCE_RANGE_MS = { min: 500, max: 10 * 60_000 };

function coerceDebounceMs(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_AUTO_COMMIT_DEBOUNCE_MS;
  return Math.min(
    AUTO_COMMIT_DEBOUNCE_RANGE_MS.max,
    Math.max(AUTO_COMMIT_DEBOUNCE_RANGE_MS.min, Math.round(raw)),
  );
}

function defaults(): AppStoreData {
  return {
    version: 1,
    lastVaultPath: null,
    recentVaults: [],
    windowBounds: null,
    updateChannel: null,
    useSystemGit: false,
    autoCommitDebounceMs: DEFAULT_AUTO_COMMIT_DEBOUNCE_MS,
    updateAutoDownload: true,
    updateCheckOnLaunch: true,
  };
}

function coerce(raw: unknown): AppStoreData {
  const base = defaults();
  if (typeof raw !== 'object' || raw === null) return base;
  const data = raw as Partial<AppStoreData>;
  const recent = Array.isArray(data.recentVaults)
    ? data.recentVaults.filter(
        (e): e is RecentVaultEntry =>
          typeof e === 'object' && e !== null && typeof e.path === 'string',
      )
    : [];
  return {
    version: 1,
    lastVaultPath: typeof data.lastVaultPath === 'string' ? data.lastVaultPath : null,
    recentVaults: recent.slice(0, MAX_RECENT_VAULTS),
    windowBounds:
      typeof data.windowBounds === 'object' && data.windowBounds !== null
        ? data.windowBounds
        : null,
    updateChannel:
      data.updateChannel === 'stable' ||
      data.updateChannel === 'beta' ||
      data.updateChannel === 'alpha'
        ? data.updateChannel
        : null,
    useSystemGit: data.useSystemGit === true,
    autoCommitDebounceMs: coerceDebounceMs(data.autoCommitDebounceMs),
    updateAutoDownload: data.updateAutoDownload !== false,
    updateCheckOnLaunch: data.updateCheckOnLaunch !== false,
  };
}

/**
 * 应用级持久化存储（userData/nexnote-app.json）：最近 vault 列表、上次 vault、窗口边界。
 * 损坏时回退默认值（不抛错——这些全是可丢的派生状态）。
 */
export class AppStore {
  private data: AppStoreData;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  private load(): AppStoreData {
    try {
      return coerce(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return defaults();
    }
  }

  get(): Readonly<AppStoreData> {
    return this.data;
  }

  /** 原子持久化（tmp + rename）。 */
  private persist(): void {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.filePath);
  }

  setLastVault(root: string | null): void {
    this.data.lastVaultPath = root;
    this.persist();
  }

  touchRecent(root: string): void {
    const entry: RecentVaultEntry = {
      path: root,
      name: path.basename(root),
      lastOpenedAt: Date.now(),
    };
    this.data.recentVaults = [
      entry,
      ...this.data.recentVaults.filter((e) => e.path !== root),
    ].slice(0, MAX_RECENT_VAULTS);
    this.persist();
  }

  removeRecent(root: string): void {
    this.data.recentVaults = this.data.recentVaults.filter((e) => e.path !== root);
    this.persist();
  }

  /** 过滤仍存在于磁盘上的最近 vault（启动时调用）。 */
  existingRecents(): RecentVaultEntry[] {
    return this.data.recentVaults.filter((e) => existsSync(e.path));
  }

  setWindowBounds(bounds: WindowBounds): void {
    this.data.windowBounds = bounds;
    this.persist();
  }

  setUpdateChannel(channel: UpdateChannel): void {
    this.data.updateChannel = channel;
    this.persist();
  }

  getUpdateAutoDownload(): boolean {
    return this.data.updateAutoDownload;
  }

  setUpdateAutoDownload(enabled: boolean): void {
    this.data.updateAutoDownload = enabled === true;
    this.persist();
  }

  getUpdateCheckOnLaunch(): boolean {
    return this.data.updateCheckOnLaunch;
  }

  setUpdateCheckOnLaunch(enabled: boolean): void {
    this.data.updateCheckOnLaunch = enabled === true;
    this.persist();
  }

  getUseSystemGit(): boolean {
    return this.data.useSystemGit;
  }

  setUseSystemGit(enabled: boolean): void {
    this.data.useSystemGit = enabled === true;
    this.persist();
  }

  getAutoCommitDebounceMs(): number {
    return this.data.autoCommitDebounceMs;
  }

  setAutoCommitDebounceMs(milliseconds: number): void {
    this.data.autoCommitDebounceMs = coerceDebounceMs(milliseconds);
    this.persist();
  }
}
