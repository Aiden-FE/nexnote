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
  setFeedURL(config: UpdateFeedConfig): void;
}

/** Accepted publish configurations (a subset of what electron-updater supports). */
export type UpdateFeedConfig =
  | { provider: 'github'; owner: string; repo: string; channel?: string }
  | { provider: 'generic'; url: string; channel?: string };

const VALID_CHANNELS: readonly UpdateChannel[] = ['stable', 'beta', 'alpha'] as const;

/** Must match the git origin, not a hard-coded placeholder. */
export const REPO_OWNER = 'Aiden-FE';
export const REPO_NAME = 'nexnote';

/** Normalize arbitrary input to a channel, or undefined when not stable|beta|alpha. */
export function normalizeChannel(raw: unknown): UpdateChannel | undefined {
  const value = typeof raw === 'string' ? (raw.trim().toLowerCase() as UpdateChannel) : undefined;
  return value && VALID_CHANNELS.includes(value) ? value : undefined;
}

/** Deterministic env override, pinned by CI so a build never silently drifts to stable. */
function resolveChannelFromEnv(): UpdateChannel {
  return normalizeChannel(process.env.NEXNOTE_UPDATE_CHANNEL) ?? 'stable';
}

/**
 * The channel electron-builder baked into app-update.yml at build time.
 * This is the only channel the packaged app knows about: NEXNOTE_UPDATE_CHANNEL is a
 * build-time variable and is *not* present in the shipped process.env. Reading this is
 * what makes stable/beta/alpha packages behave differently instead of all defaulting to stable.
 */
let getResourcesPath = (): string | undefined => process.resourcesPath;

function readBakedChannel(): UpdateChannel | undefined {
  try {
    const resources = getResourcesPath();
    if (!resources) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as { readFileSync(p: string, e: string): string };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('js-yaml') as { load(s: string): unknown };
    const doc = yaml.load(fs.readFileSync(`${resources}/app-update.yml`, 'utf8')) as { channel?: unknown };
    return normalizeChannel(doc?.channel);
  } catch {
    return undefined;
  }
}

/** Startup channel priority: persisted selection → baked app-update.yml → env → stable. */
function resolveStartupChannel(persisted: UpdateChannel | undefined): UpdateChannel {
  if (persisted && VALID_CHANNELS.includes(persisted)) return persisted;
  if (electronApp.isPackaged) {
    const baked = readBakedChannel();
    if (baked) return baked;
  }
  return resolveChannelFromEnv();
}

export const updaterChannel = (channel: UpdateChannel): string => (channel === 'stable' ? 'latest' : channel);

const feedConfig = (channel: UpdateChannel): UpdateFeedConfig => {
  if (!VALID_CHANNELS.includes(channel)) {
    throw new Error(`非法更新通道: ${channel}（必须是 stable/beta/alpha）`);
  }
  const genericBase = process.env.NEXNOTE_UPDATE_URL?.replace(/\/+$/, '');
  if (genericBase) return { provider: 'generic', url: `${genericBase}/${channel}`, channel: updaterChannel(channel) };
  return { provider: 'github', owner: REPO_OWNER, repo: REPO_NAME, ...(channel === 'stable' ? {} : { channel }) };
};

/** electron-updater 的 autoUpdater 在 import 时即读取 Electron app（Node 环境会崩），按需懒加载。 */
const lazyAutoUpdater = (): UpdaterAdapter =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('electron-updater').autoUpdater as unknown as UpdaterAdapter;

let adapter: UpdaterAdapter | null = null;
const getAdapter = (): UpdaterAdapter => (adapter ??= lazyAutoUpdater());
let sendStatus: SendStatus = () => {};
let logger: Log = () => {};
let activeChannel: UpdateChannel = resolveChannelFromEnv();
let availableVersion: string | undefined;
let downloadedVersion: string | undefined;
let downloadInFlight = false;
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
export function initAutoUpdater(
  log: Log,
  statusSender: SendStatus = () => {},
  persistedChannel?: UpdateChannel,
): void {
  if (persistedChannel && !VALID_CHANNELS.includes(persistedChannel)) {
    log(`[updater] 非法持久化通道 ${persistedChannel}，使用打包默认值`);
    persistedChannel = undefined;
  }
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
  a.autoDownload = false;
  a.autoInstallOnAppQuit = true;
  // electron-updater's stable metadata is latest*.yml, never stable*.yml.
  a.channel = updaterChannel(activeChannel);
  // GitHub 默认交给 electron-updater 读取打包进 app-update.yml 的 provider/channel；
  // 仅当配置了 generic 静态源时才主动 setFeedURL 覆盖。
  const genericBase = process.env.NEXNOTE_UPDATE_URL?.replace(/\/+$/, '');
  if (genericBase) a.setFeedURL(feedConfig(activeChannel));
  a.on('error', (...args: unknown[]) => {
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
  a.on('update-not-available', () => emit('up-to-date', `当前 ${electronApp.getVersion()} 已是最新`));
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

  // Do not block startup; errors are surfaced as update status events.
  setTimeout(() => void checkForUpdates(), 5_000);
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
    // Explicit switching must also update the provider; stable omits GitHub channel
    // and resolves electron-updater's generated latest*.yml metadata.
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
      if (remoteVersion !== availableVersion) downloadedVersion = undefined;
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
  if (downloadedVersion === availableVersion) return emit('downloaded', '更新已下载，可重启安装');
  if (downloadInFlight) return emit('downloading', '更新正在下载…');
  try {
    downloadInFlight = true;
    emit('downloading', '正在下载更新…', 0);
    await getAdapter().downloadUpdate();
    // Some adapters resolve before the event; never enable install until update-downloaded confirms it.
    return downloadedVersion === availableVersion
      ? emit('downloaded', '更新已下载，可重启安装')
      : emit('downloading', '正在等待下载确认…');
  } catch (e) {
    downloadInFlight = false;
    return emit('error', e instanceof Error ? e.message : String(e));
  }
}

export function installUpdate(): { willRestart: true } {
  if (!electronApp.isPackaged || !availableVersion || downloadedVersion !== availableVersion) throw new Error('没有已下载的更新可安装');
  logger('[updater] quitAndInstall');
  getAdapter().quitAndInstall(false, true);
  return { willRestart: true };
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
