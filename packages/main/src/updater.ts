import type { UpdateChannel, UpdateCheckResult } from '@nexnote/shared';

type Log = (...args: unknown[]) => void;
type SendStatus = (status: UpdateCheckResult & { progress?: number; channel: UpdateChannel }) => void;

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
  setFeedURL(config: { provider: string; channel?: string; url?: string; owner?: string; repo?: string }): void;
}

/** electron-updater 的 autoUpdater 在 import 时即读取 Electron app（Node 环境会崩），按需懒加载。 */
const lazyAutoUpdater = (): UpdaterAdapter =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('electron-updater').autoUpdater as unknown as UpdaterAdapter;

let adapter: UpdaterAdapter | null = null;
const getAdapter = (): UpdaterAdapter => (adapter ??= lazyAutoUpdater());
let sendStatus: SendStatus = () => {};
let logger: Log = () => {};
let activeChannel: UpdateChannel = 'stable';
let availableVersion: string | undefined;
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

const feedConfig = (channel: UpdateChannel): Parameters<UpdaterAdapter['setFeedURL']>[0] => {
  const genericBase = process.env.NEXNOTE_UPDATE_URL?.replace(/\/+$/, '');
  if (genericBase) return { provider: 'generic', url: `${genericBase}/${channel}`, channel };
  return { provider: 'github', owner: 'nexnote', repo: 'nexnote', channel };
};

function emit(status: UpdateCheckResult['status'], message?: string, progress?: number): UpdateCheckResult {
  const result: UpdateCheckResult & { channel: UpdateChannel } = {
    status,
    ...(message ? { message } : {}),
    ...(availableVersion ? { version: availableVersion } : {}),
    channel: activeChannel,
  };
  sendStatus({ ...result, ...(progress === undefined ? {} : { progress }) });
  return result;
}

/** Production policy: silent startup check, user-driven download/install confirmation. */
export function initAutoUpdater(log: Log, statusSender: SendStatus = () => {}, channel: UpdateChannel = 'stable'): void {
  logger = log;
  sendStatus = statusSender;
  activeChannel = channel;
  availableVersion = undefined;
  if (!electronApp.isPackaged) {
    log('[updater] 开发模式，跳过自动更新初始化');
    return;
  }

  const a = getAdapter();
  a.autoDownload = false;
  a.autoInstallOnAppQuit = true;
  a.channel = channel;
  a.setFeedURL(feedConfig(channel));
  a.on('error', (...args: unknown[]) => {
    const e = args[0];
    emit('error', e instanceof Error ? e.message : String(e ?? 'unknown error'));
  });
  a.on('checking-for-update', () => emit('checking', '正在检查更新…'));
  a.on('update-available', (...args: unknown[]) => {
    const info = args[0] as { version?: string } | undefined;
    availableVersion = info?.version;
    emit('available', info?.version ? `发现新版本 ${info.version}` : '发现新版本');
  });
  a.on('update-not-available', () => emit('up-to-date', `当前 ${electronApp.getVersion()} 已是最新`));
  a.on('download-progress', (...args: unknown[]) => {
    const progress = args[0] as { percent?: number } | undefined;
    emit('downloading', '正在下载更新…', progress?.percent ?? 0);
  });
  a.on('update-downloaded', (...args: unknown[]) => {
    const info = args[0] as { version?: string } | undefined;
    availableVersion = info?.version ?? availableVersion;
    emit('downloaded', '更新已下载，可重启安装');
  });

  // Do not block startup; errors are surfaced as update status events.
  setTimeout(() => void checkForUpdates(), 5_000);
}

export function setUpdateChannel(channel: UpdateChannel): UpdateCheckResult {
  activeChannel = channel;
  availableVersion = undefined;
  if (electronApp.isPackaged) {
    const a = getAdapter();
    a.channel = channel;
    a.setFeedURL(feedConfig(channel));
  }
  return emit('not-configured', `已切换至 ${channel} 更新通道`);
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!electronApp.isPackaged) return { status: 'not-configured', message: '开发模式下更新通道未启用', channel: activeChannel };
  try {
    emit('checking', '正在检查更新…');
    const result = await getAdapter().checkForUpdates();
    const remoteVersion = result?.updateInfo?.version;
    if (remoteVersion && remoteVersion !== electronApp.getVersion()) {
      availableVersion = remoteVersion;
      return emit('available', `发现新版本 ${remoteVersion}`);
    }
    return emit('up-to-date', `当前 ${electronApp.getVersion()} 已是最新`);
  } catch (e) {
    return emit('error', e instanceof Error ? e.message : String(e));
  }
}

export async function downloadUpdate(): Promise<UpdateCheckResult> {
  if (!electronApp.isPackaged) return { status: 'not-configured', message: '开发模式不能下载发布更新', channel: activeChannel };
  if (!availableVersion) return { status: 'error', message: '没有可下载的更新，请先检查更新', channel: activeChannel };
  try {
    emit('downloading', '正在下载更新…', 0);
    await getAdapter().downloadUpdate();
    return emit('downloaded', '更新已下载，可重启安装');
  } catch (e) {
    return emit('error', e instanceof Error ? e.message : String(e));
  }
}

export function installUpdate(): { willRestart: true } {
  if (!electronApp.isPackaged || !availableVersion) throw new Error('没有已下载的更新可安装');
  logger('[updater] quitAndInstall');
  getAdapter().quitAndInstall(false, true);
  return { willRestart: true };
}

/** Test seam; never call from production code. */
export function setUpdaterAdapterForTests(next: UpdaterAdapter, appLike: ElectronAppLike = electronApp): () => void {
  const previousAdapter = adapter;
  const previousApp = electronApp;
  adapter = next;
  electronApp = appLike;
  return () => {
    adapter = previousAdapter;
    electronApp = previousApp;
  };
}
