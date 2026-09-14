import { sep } from 'node:path';
import type {
  UpdateChannel,
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateSettings,
  UpdateSettingsPatch,
} from '@nexnote/shared';

type Log = (...args: unknown[]) => void;
type SendStatus = (
  status: UpdateCheckResult & { progress?: number; channel: UpdateChannel },
) => void;

/** Minimal Electron-like surface the updater needs, kept narrow for testability. */
export interface ElectronAppLike {
  readonly isPackaged: boolean;
  getVersion(): string;
}

/** Injectable narrow adapter keeps updater policy unit-testable without Electron network calls. */
export interface UpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  channel: string;
  checkForUpdates(): Promise<{ updateInfo?: { version?: string } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  setFeedURL(config: UpdateFeedConfig): void;
}

/** The small platform seam is deliberately independent of electron-updater. */
export type MacSignatureStatus = 'signed' | 'adhoc' | 'unsigned' | 'invalid';
export interface MacSignatureVerification {
  status: MacSignatureStatus;
  authorities: string[];
  detail?: string;
}
export interface UpdaterPlatformAdapter {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  getAppBundlePath(): string | undefined;
  verifyMacAppSignature(bundlePath: string): MacSignatureVerification;
  openExternal(url: string): void | Promise<void>;
}

/** Accepted publish configurations (a subset of what electron-updater supports). */
export type UpdateFeedConfig =
  | { provider: 'github'; owner: string; repo: string; channel?: string }
  | { provider: 'generic'; url: string; channel?: string };

const VALID_CHANNELS: readonly UpdateChannel[] = ['stable', 'beta', 'alpha'] as const;
const UPDATE_URL_ALLOWLIST = [`https://github.com/Aiden-FE/nexnote`];
export const INSTALL_TIMEOUT_MS = 15_000;
export const REPO_OWNER = 'Aiden-FE';
export const REPO_NAME = 'nexnote';
export const RELEASES_LATEST_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

/** Normalize arbitrary input to a channel, or undefined when not stable|beta|alpha. */
export function normalizeChannel(raw: unknown): UpdateChannel | undefined {
  const value = typeof raw === 'string' ? (raw.trim().toLowerCase() as UpdateChannel) : undefined;
  return value && VALID_CHANNELS.includes(value) ? value : undefined;
}

function resolveChannelFromEnv(): UpdateChannel {
  return normalizeChannel(process.env.NEXNOTE_UPDATE_CHANNEL) ?? 'stable';
}

let getResourcesPath = (): string | undefined => process.resourcesPath;

function readBakedChannel(): UpdateChannel | undefined {
  try {
    const resources = getResourcesPath();
    if (!resources) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as { readFileSync(p: string, e: string): string };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('js-yaml') as { load(s: string): unknown };
    const doc = yaml.load(fs.readFileSync(`${resources}/app-update.yml`, 'utf8')) as {
      channel?: unknown;
    };
    return normalizeChannel(doc?.channel);
  } catch {
    return undefined;
  }
}

function resolveStartupChannel(persisted: UpdateChannel | undefined): UpdateChannel {
  if (persisted && VALID_CHANNELS.includes(persisted)) return persisted;
  if (electronApp.isPackaged) {
    const baked = readBakedChannel();
    if (baked) return baked;
  }
  return resolveChannelFromEnv();
}

export const updaterChannel = (channel: UpdateChannel): string =>
  channel === 'stable' ? 'latest' : channel;

/** Production ignores arbitrary update endpoints; test/dev may use a local generic feed. */
function allowedUpdateBase(raw: string | undefined, packaged: boolean): string | undefined {
  const value = raw?.trim().replace(/\/+$/, '');
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    if (!packaged || process.env.NODE_ENV !== 'production') return value;
    return UPDATE_URL_ALLOWLIST.includes(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const feedConfig = (channel: UpdateChannel): UpdateFeedConfig => {
  if (!VALID_CHANNELS.includes(channel)) {
    throw new Error(`非法更新通道: ${channel}（必须是 stable/beta/alpha）`);
  }
  const genericBase = allowedUpdateBase(process.env.NEXNOTE_UPDATE_URL, electronApp.isPackaged);
  if (genericBase)
    return {
      provider: 'generic',
      url: `${genericBase}/${channel}`,
      channel: updaterChannel(channel),
    };
  return {
    provider: 'github',
    owner: REPO_OWNER,
    repo: REPO_NAME,
    ...(channel === 'stable' ? {} : { channel }),
  };
};

const lazyAutoUpdater = (): UpdaterAdapter =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('electron-updater').autoUpdater as unknown as UpdaterAdapter;

function defaultPlatformAdapter(): UpdaterPlatformAdapter {
  return {
    platform: process.platform,
    arch: process.arch,
    getAppBundlePath() {
      if (process.platform !== 'darwin') return undefined;
      return deriveMacAppBundlePath(process.execPath);
    },
    verifyMacAppSignature(bundlePath) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execFileSync } = require('node:child_process') as {
        execFileSync: (file: string, args: string[], options: Record<string, unknown>) => unknown;
      };
      try {
        execFileSync('codesign', ['--verify', '--deep', '--strict', bundlePath], {
          stdio: 'pipe',
        });
        const details = execFileSync('codesign', ['-dv', '--verbose=4', bundlePath], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }) as string;
        const authorities = [...details.matchAll(/^Authority=(.+)$/gm)].map((m) => m[1]!.trim());
        if (/^Signature=adhoc$/m.test(details)) return { status: 'adhoc', authorities };
        if (authorities.length > 0) return { status: 'signed', authorities };
        return { status: 'unsigned', authorities };
      } catch (error) {
        return {
          status: 'invalid',
          authorities: [],
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    openExternal(url) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shell } = require('electron') as {
        shell?: { openExternal(url: string): Promise<void> };
      };
      if (shell?.openExternal) void shell.openExternal(url);
    },
  };
}

/** Derive the distributable .app from Electron's Contents/MacOS executable path. */
export function deriveMacAppBundlePath(execPath: string): string | undefined {
  const marker = `${sep}Contents${sep}MacOS${sep}`;
  const index = execPath.indexOf(marker);
  return index > 0 && execPath.slice(0, index).endsWith('.app')
    ? execPath.slice(0, index)
    : undefined;
}

let adapter: UpdaterAdapter | null = null;
const getAdapter = (): UpdaterAdapter => (adapter ??= lazyAutoUpdater());
let platformAdapter: UpdaterPlatformAdapter = defaultPlatformAdapter();
let sendStatus: SendStatus = () => {};
let logger: Log = () => {};
let activeChannel: UpdateChannel = resolveChannelFromEnv();
let availableVersion: string | undefined;
let downloadedVersion: string | undefined;
let downloadInFlight = false;
let autoDownloadSetting = true;
let checkOnLaunchSetting = true;
let electronApp: ElectronAppLike = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const app = (require('electron') as { app?: ElectronAppLike }).app;
    if (app && typeof app.isPackaged === 'boolean') return app;
  } catch {
    /* Node 测试环境无 Electron */
  }
  return { isPackaged: false, getVersion: () => '0.0.0-test' };
})();

function emit(
  status: UpdateCheckResult['status'],
  message?: string,
  progress?: number,
  extra: Partial<UpdateCheckResult> = {},
): UpdateCheckResult {
  const result: UpdateCheckResult & { channel: UpdateChannel } = {
    status,
    ...(message ? { message } : {}),
    ...(availableVersion ? { version: availableVersion } : {}),
    channel: activeChannel,
    ...extra,
  };
  sendStatus({ ...result, ...(progress === undefined ? {} : { progress }) });
  return result;
}

export function initAutoUpdater(
  log: Log,
  statusSender: SendStatus = () => {},
  settings: UpdateSettingsPatch & { channel?: UpdateChannel } = {},
): void {
  const persistedChannel = settings.channel;
  if (persistedChannel && !VALID_CHANNELS.includes(persistedChannel)) {
    log(`[updater] 非法持久化通道 ${persistedChannel}，使用打包默认值`);
  }
  autoDownloadSetting = settings.autoDownload ?? true;
  checkOnLaunchSetting = settings.checkOnLaunch ?? true;
  logger = log;
  sendStatus = statusSender;
  activeChannel = resolveStartupChannel(persistedChannel);
  availableVersion = undefined;
  downloadedVersion = undefined;
  downloadInFlight = false;
  if (!electronApp.isPackaged) {
    log('[updater] 开发模式，跳过自动更新初始化');
    return;
  }

  const a = getAdapter();
  a.autoDownload = autoDownloadSetting;
  // Never let electron-updater install without the explicit renderer confirmation.
  a.autoInstallOnAppQuit = false;
  a.channel = updaterChannel(activeChannel);
  const genericBase = allowedUpdateBase(process.env.NEXNOTE_UPDATE_URL, electronApp.isPackaged);
  if (process.env.NEXNOTE_UPDATE_URL && !genericBase)
    log('[updater] 忽略不在 production allowlist 的 NEXNOTE_UPDATE_URL');
  if (genericBase) a.setFeedURL(feedConfig(activeChannel));
  a.on('error', (...args: unknown[]) => {
    downloadInFlight = false;
    const e = args[0];
    emit('error', e instanceof Error ? e.message : String(e ?? 'unknown error'));
  });
  a.on('checking-for-update', () => emit('checking', '正在检查更新…'));
  a.on('update-available', (...args: unknown[]) => {
    const info = args[0] as { version?: string } | undefined;
    if (info?.version && info.version === availableVersion) return;
    availableVersion = info?.version;
    downloadedVersion = undefined;
    emit('available', info?.version ? `发现新版本 ${info.version}` : '发现新版本');
  });
  a.on('update-not-available', () => {
    availableVersion = undefined;
    downloadedVersion = undefined;
    downloadInFlight = false;
    emit('up-to-date', `当前 ${electronApp.getVersion()} 已是最新`);
  });
  a.on('download-progress', (...args: unknown[]) => {
    const progress = args[0] as { percent?: number } | undefined;
    emit('downloading', '正在下载更新…', progress?.percent ?? 0);
  });
  a.on('update-downloaded', (...args: unknown[]) => {
    const info = args[0] as { version?: string } | undefined;
    availableVersion = info?.version ?? availableVersion;
    downloadedVersion = availableVersion;
    downloadInFlight = false;
    emit('downloaded', '更新已下载，可重启安装');
  });

  if (checkOnLaunchSetting) setTimeout(() => void checkForUpdates(), 5_000);
}

export function setUpdateChannel(channel: UpdateChannel): UpdateCheckResult {
  if (!VALID_CHANNELS.includes(channel)) {
    return emit('error', `不支持的更新通道: ${channel}（必须是 stable/beta/alpha）`);
  }
  activeChannel = channel;
  availableVersion = undefined;
  downloadedVersion = undefined;
  downloadInFlight = false;
  if (electronApp.isPackaged) {
    const a = getAdapter();
    a.channel = updaterChannel(channel);
    a.setFeedURL(feedConfig(channel));
  }
  return emit('channel-switched', `已切换至 ${channel} 更新通道`);
}

export function getUpdateSettings(): UpdateSettings {
  return {
    channel: activeChannel,
    autoDownload: autoDownloadSetting,
    checkOnLaunch: checkOnLaunchSetting,
  };
}

export function setUpdateSettings(patch: UpdateSettingsPatch): UpdateSettings {
  if (patch.channel !== undefined) setUpdateChannel(patch.channel);
  if (patch.autoDownload !== undefined) {
    autoDownloadSetting = patch.autoDownload;
    if (electronApp.isPackaged) getAdapter().autoDownload = patch.autoDownload;
  }
  if (patch.checkOnLaunch !== undefined) checkOnLaunchSetting = patch.checkOnLaunch;
  return getUpdateSettings();
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!electronApp.isPackaged)
    return {
      status: 'not-configured',
      message: '开发模式下更新通道未启用',
      channel: activeChannel,
    };
  try {
    emit('checking', '正在检查更新…');
    const result = await getAdapter().checkForUpdates();
    const remoteVersion = result?.updateInfo?.version;
    if (remoteVersion && remoteVersion !== electronApp.getVersion()) {
      if (remoteVersion !== availableVersion) downloadedVersion = undefined;
      availableVersion = remoteVersion;
      return emit('available', `发现新版本 ${remoteVersion}`);
    }
    availableVersion = undefined;
    downloadedVersion = undefined;
    downloadInFlight = false;
    return emit('up-to-date', `当前 ${electronApp.getVersion()} 已是最新`);
  } catch (e) {
    downloadInFlight = false;
    return emit('error', e instanceof Error ? e.message : String(e));
  }
}

export async function downloadUpdate(): Promise<UpdateCheckResult> {
  if (!electronApp.isPackaged)
    return {
      status: 'not-configured',
      message: '开发模式不能下载发布更新',
      channel: activeChannel,
    };
  if (!availableVersion)
    return { status: 'error', message: '没有可下载的更新，请先检查更新', channel: activeChannel };
  if (downloadedVersion === availableVersion) return emit('downloaded', '更新已下载，可重启安装');
  if (downloadInFlight) return emit('downloading', '更新正在下载…');
  try {
    downloadInFlight = true;
    emit('downloading', '正在下载更新…', 0);
    await getAdapter().downloadUpdate();
    // Adapters can resolve before update-downloaded. Clear the guard so a failed/missed
    // confirmation can be retried; only the event grants the install capability.
    downloadInFlight = false;
    return downloadedVersion === availableVersion
      ? emit('downloaded', '更新已下载，可重启安装')
      : emit('downloading', '正在等待下载确认…');
  } catch (e) {
    downloadInFlight = false;
    return emit('error', e instanceof Error ? e.message : String(e));
  }
}

export function installUpdate(): UpdateInstallResult {
  if (!electronApp.isPackaged || !availableVersion || downloadedVersion !== availableVersion)
    throw new Error('没有已下载的更新可安装');

  if (platformAdapter.platform === 'darwin') {
    const bundlePath = platformAdapter.getAppBundlePath();
    const signature = bundlePath
      ? platformAdapter.verifyMacAppSignature(bundlePath)
      : { status: 'invalid' as const, authorities: [], detail: '无法定位 .app' };
    if (signature.status !== 'signed') {
      const reason =
        signature.status === 'adhoc'
          ? 'Ad hoc 签名（未公证）'
          : '未签名或签名异常（可能需要移除 xattr quarantine）';
      logger(`[updater] Mac ${reason}，改用手动下载 (${platformAdapter.arch})`);
      platformAdapter.openExternal(RELEASES_LATEST_URL);
      emit(
        'downloaded',
        `当前 Mac 架构 ${platformAdapter.arch}：${reason}；已打开 Releases，请手动下载。`,
        undefined,
        {
          action: 'manual-download',
          arch: platformAdapter.arch,
        },
      );
      return { willRestart: false, action: 'manual-download', arch: platformAdapter.arch };
    }
  }

  try {
    logger('[updater] quitAndInstall');
    getAdapter().quitAndInstall(false, true);
    setTimeout(() => {
      if (downloadedVersion === availableVersion) {
        emit('error', '安装启动超时，更新仍已保留，请重试。', undefined, {
          action: 'install-started',
          arch: platformAdapter.arch,
          recoverable: true,
        });
      }
    }, INSTALL_TIMEOUT_MS);
    emit('downloaded', '正在重启并安装更新…', undefined, {
      action: 'install-started',
      arch: platformAdapter.arch,
    });
    return { willRestart: true, action: 'install-started', arch: platformAdapter.arch };
  } catch (error) {
    // Keep downloadedVersion intact: the user can retry from the visible error state.
    emit('error', error instanceof Error ? error.message : String(error), undefined, {
      action: 'install-started',
      arch: platformAdapter.arch,
      recoverable: true,
    });
    throw error;
  }
}

/** Test seam; never call from production code. */
export function setUpdaterAdapterForTests(
  next: UpdaterAdapter,
  appLike: ElectronAppLike = electronApp,
  resourcesPath?: string,
): () => void {
  const previousAdapter = adapter;
  const previousApp = electronApp;
  const previousResourcesPath = getResourcesPath;
  adapter = next;
  electronApp = appLike;
  if (resourcesPath !== undefined) getResourcesPath = () => resourcesPath;
  return () => {
    adapter = previousAdapter;
    electronApp = previousApp;
    getResourcesPath = previousResourcesPath;
  };
}

/** Test seam for platform/signature policy; production uses the real OS commands. */
export function setUpdaterPlatformForTests(next: UpdaterPlatformAdapter): () => void {
  const previous = platformAdapter;
  platformAdapter = next;
  return () => {
    platformAdapter = previous;
  };
}
