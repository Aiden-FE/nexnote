import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

export interface ElectronAppLike {
  readonly isPackaged: boolean;
  getVersion(): string;
}

export interface UpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade?: boolean;
  channel: string;
  checkForUpdates(): Promise<{ updateInfo?: { version?: string; channel?: string } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  setFeedURL(config: UpdateFeedConfig): void;
}

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
  verifyMacAppSignature(
    bundlePath: string,
  ): Promise<MacSignatureVerification> | MacSignatureVerification;
  openExternal(url: string): void | Promise<void>;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
}
export type RunCommand = (
  file: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandOutput>;
export const CODESIGN_PATH = '/usr/bin/codesign';
export const CODESIGN_TIMEOUT_MS = 10_000;
export const INSTALL_TIMEOUT_MS = 15_000;
const runCommandDefault: RunCommand = async (file, args, timeoutMs) => {
  const run = promisify(execFile);
  const result = await run(file, args, { timeout: timeoutMs, encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr };
};
let runCommand: RunCommand = runCommandDefault;

export type UpdateFeedConfig =
  | { provider: 'github'; owner: string; repo: string; channel?: string }
  | { provider: 'generic'; url: string; channel?: string };

const VALID_CHANNELS: readonly UpdateChannel[] = ['stable', 'beta', 'alpha'] as const;
export const REPO_OWNER = 'Aiden-FE';
export const REPO_NAME = 'nexnote';
export const RELEASES_LATEST_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

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
  if (electronApp.isPackaged) return readBakedChannel() ?? resolveChannelFromEnv();
  return resolveChannelFromEnv();
}
export const updaterChannel = (channel: UpdateChannel): string =>
  channel === 'stable' ? 'latest' : channel;

let testUpdateUrl: string | undefined;
function allowedUpdateBase(raw: string | undefined, packaged: boolean): string | undefined {
  const value = raw?.trim().replace(/\/+$/, '');
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return undefined;
    const loopback =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (url.protocol === 'http:' && !loopback) return undefined;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return undefined;
    if (packaged) return undefined;
    return value;
  } catch {
    return undefined;
  }
}
function feedConfig(channel: UpdateChannel): UpdateFeedConfig {
  if (!VALID_CHANNELS.includes(channel)) throw new Error(`非法更新通道: ${channel}`);
  const genericBase = allowedUpdateBase(testUpdateUrl, electronApp.isPackaged);
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
}

const lazyAutoUpdater = (): UpdaterAdapter =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('electron-updater').autoUpdater as unknown as UpdaterAdapter;
let adapter: UpdaterAdapter | null = null;
const getAdapter = (): UpdaterAdapter => (adapter ??= lazyAutoUpdater());

export function createDefaultUpdaterPlatform(): UpdaterPlatformAdapter {
  return {
    platform: process.platform,
    arch: process.arch,
    getAppBundlePath: () =>
      process.platform === 'darwin' ? deriveMacAppBundlePath(process.execPath) : undefined,
    async verifyMacAppSignature(bundlePath) {
      try {
        await runCommand(
          CODESIGN_PATH,
          ['--verify', '--deep', '--strict', bundlePath],
          CODESIGN_TIMEOUT_MS,
        );
        const output = await runCommand(
          CODESIGN_PATH,
          ['-dv', '--verbose=4', bundlePath],
          CODESIGN_TIMEOUT_MS,
        );
        const details = `${output.stdout}\n${output.stderr}`;
        const authorities = [...details.matchAll(/^Authority=(.+)$/gm)].map((m) => m[1]!.trim());
        if (/^Signature=adhoc$/m.test(details)) return { status: 'adhoc', authorities };
        if (authorities.length > 0) return { status: 'signed', authorities };
        return { status: 'unsigned', authorities };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stderr =
          error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
        return {
          status: 'invalid',
          authorities: [],
          detail: `${message}${stderr ? `: ${stderr}` : ''}`,
        };
      }
    },
    async openExternal(url) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shell } = require('electron') as {
        shell?: { openExternal(url: string): Promise<void> };
      };
      if (!shell?.openExternal) throw new Error('系统浏览器不可用');
      await shell.openExternal(url);
    },
  };
}
export function deriveMacAppBundlePath(execPath: string): string | undefined {
  const marker = `${sep}Contents${sep}MacOS${sep}`;
  const index = execPath.indexOf(marker);
  return index > 0 && execPath.slice(0, index).endsWith('.app')
    ? execPath.slice(0, index)
    : undefined;
}

let platformAdapter: UpdaterPlatformAdapter = createDefaultUpdaterPlatform();
let sendStatus: SendStatus = () => {};
let logger: Log = () => {};
let activeChannel: UpdateChannel = resolveChannelFromEnv();
let availableVersion: string | undefined;
let downloadedVersion: string | undefined;
let downloadInFlight = false;
let autoDownloadSetting = false;
let checkOnLaunchSetting = true;
let installing = false;
let installTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
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

function clearInstallTimer(): void {
  if (installTimer !== undefined) clearTimeout(installTimer);
  installTimer = undefined;
  installing = false;
}
interface SemVer {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
}

function parseSemVer(value: unknown): SemVer | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) return undefined;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0')))
    return undefined;
  return { major: match[1]!, minor: match[2]!, patch: match[3]!, prerelease };
}

function compareNumericStrings(left: string, right: string): number {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function compareSemVer(a: SemVer, b: SemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumericStrings(a[key], b[key]);
    if (comparison !== 0) return comparison;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return compareNumericStrings(left, right);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

function isStrictlyNewer(version: unknown): version is string {
  const remote = parseSemVer(version);
  const current = parseSemVer(electronApp.getVersion());
  return remote !== undefined && current !== undefined && compareSemVer(remote, current) > 0;
}
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
  clearInstallTimer();
  generation += 1;
  const persistedChannel = settings.channel;
  if (persistedChannel && !VALID_CHANNELS.includes(persistedChannel))
    log(`[updater] 非法持久化通道 ${persistedChannel}，使用打包默认值`);
  autoDownloadSetting = settings.autoDownload ?? false;
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
  a.autoInstallOnAppQuit = false;
  a.allowDowngrade = false;
  a.channel = updaterChannel(activeChannel);
  if (testUpdateUrl && allowedUpdateBase(testUpdateUrl, true))
    a.setFeedURL(feedConfig(activeChannel));
  const runGeneration = generation;
  a.on('error', (...args) => {
    if (runGeneration !== generation) return;
    const retry = downloadInFlight ? 'download' : 'check';
    downloadInFlight = false;
    emit(
      'error',
      args[0] instanceof Error ? args[0].message : String(args[0] ?? 'unknown error'),
      undefined,
      { retry },
    );
  });
  a.on('checking-for-update', () => {
    if (runGeneration === generation) emit('checking', '正在检查更新…');
  });
  a.on('update-available', (...args) => {
    if (runGeneration !== generation) return;
    const info = args[0] as { version?: string; channel?: string } | undefined;
    if (!info) return;
    if (info.channel && normalizeChannel(info.channel) !== activeChannel) return;
    if (info.version === availableVersion) return;
    if (!isStrictlyNewer(info.version)) return;
    availableVersion = info.version;
    downloadedVersion = undefined;
    downloadInFlight = false;
    emit('available', `发现新版本 ${info.version}`);
  });
  a.on('update-not-available', () => {
    if (runGeneration !== generation) return;
    availableVersion = undefined;
    downloadedVersion = undefined;
    downloadInFlight = false;
    emit('up-to-date', `当前 ${electronApp.getVersion()} 已是最新`);
  });
  a.on('download-progress', (...args) => {
    if (runGeneration === generation) {
      const p = args[0] as { percent?: number } | undefined;
      emit('downloading', '正在下载更新…', p?.percent ?? 0);
    }
  });
  a.on('update-downloaded', (...args) => {
    if (runGeneration !== generation) return;
    const info = args[0] as { version?: string; channel?: string } | undefined;
    if (info?.channel && normalizeChannel(info.channel) !== activeChannel) return;
    if (info?.version && (!isStrictlyNewer(info.version) || info.version !== availableVersion))
      return;
    if (!availableVersion) return;
    downloadedVersion = availableVersion;
    downloadInFlight = false;
    emit('downloaded', '更新已下载，可重启安装');
  });
  if (checkOnLaunchSetting)
    setTimeout(() => {
      if (runGeneration === generation) void checkForUpdates(runGeneration);
    }, 5_000);
}

export function setUpdateChannel(channel: UpdateChannel): UpdateCheckResult {
  if (!VALID_CHANNELS.includes(channel))
    return emit('error', `不支持的更新通道: ${channel}（必须是 stable/beta/alpha）`);
  clearInstallTimer();
  generation += 1;
  activeChannel = channel;
  availableVersion = undefined;
  downloadedVersion = undefined;
  downloadInFlight = false;
  if (electronApp.isPackaged) {
    const a = getAdapter();
    a.channel = updaterChannel(channel);
    a.allowDowngrade = false;
    if (testUpdateUrl && allowedUpdateBase(testUpdateUrl, true)) a.setFeedURL(feedConfig(channel));
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
export async function checkForUpdates(expectedGeneration = generation): Promise<UpdateCheckResult> {
  if (!electronApp.isPackaged)
    return {
      status: 'not-configured',
      message: '开发模式下更新通道未启用',
      channel: activeChannel,
    };
  try {
    emit('checking', '正在检查更新…');
    const result = await getAdapter().checkForUpdates();
    if (expectedGeneration !== generation)
      return {
        status: 'error',
        message: '更新通道已切换',
        channel: activeChannel,
        retry: 'check',
      };
    const remoteVersion = result?.updateInfo?.version;
    if (isStrictlyNewer(remoteVersion)) {
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
    return emit('error', e instanceof Error ? e.message : String(e), undefined, {
      retry: 'check',
    });
  }
}
export async function downloadUpdate(): Promise<UpdateCheckResult> {
  const runGeneration = generation;
  if (!electronApp.isPackaged)
    return {
      status: 'not-configured',
      message: '开发模式不能下载发布更新',
      channel: activeChannel,
    };
  if (!availableVersion)
    return {
      status: 'error',
      message: '没有可下载的更新，请先检查更新',
      channel: activeChannel,
      retry: 'check',
    };
  if (downloadedVersion === availableVersion) return emit('downloaded', '更新已下载，可重启安装');
  if (downloadInFlight) return emit('downloading', '更新正在下载…');
  try {
    downloadInFlight = true;
    emit('downloading', '正在下载更新…', 0);
    await getAdapter().downloadUpdate();
    if (runGeneration !== generation)
      return { status: 'error', message: '更新通道已切换', channel: activeChannel, retry: 'check' };
    downloadInFlight = false;
    return downloadedVersion === availableVersion
      ? emit('downloaded', '更新已下载，可重启安装')
      : emit('downloading', '正在等待下载确认…');
  } catch (e) {
    if (runGeneration !== generation)
      return { status: 'error', message: '更新通道已切换', channel: activeChannel, retry: 'check' };
    downloadInFlight = false;
    return emit('error', e instanceof Error ? e.message : String(e), undefined, {
      retry: 'download',
    });
  }
}
export async function installUpdate(): Promise<UpdateInstallResult> {
  if (
    !electronApp.isPackaged ||
    !availableVersion ||
    downloadedVersion !== availableVersion ||
    installing
  )
    throw new Error('没有可安装的已下载更新');
  if (platformAdapter.platform === 'darwin') {
    const bundlePath = platformAdapter.getAppBundlePath();
    const signature = bundlePath
      ? await platformAdapter.verifyMacAppSignature(bundlePath)
      : { status: 'invalid' as const, authorities: [], detail: '无法定位 .app' };
    if (signature.status !== 'signed') {
      const reason =
        signature.status === 'adhoc'
          ? 'Ad hoc 签名（未公证）'
          : '未签名或签名异常（可能需要移除 xattr quarantine）';
      try {
        await platformAdapter.openExternal(RELEASES_LATEST_URL);
      } catch (e) {
        emit('error', e instanceof Error ? e.message : String(e));
        throw e;
      }
      logger(`[updater] Mac ${reason}，改用手动下载 (${platformAdapter.arch})`);
      emit(
        'downloaded',
        `当前 Mac 架构 ${platformAdapter.arch}：${reason}；已打开 Releases，请手动下载。`,
        undefined,
        { action: 'manual-download', arch: platformAdapter.arch },
      );
      return { willRestart: false, action: 'manual-download', arch: platformAdapter.arch };
    }
  }
  try {
    installing = true;
    emit('installing', '正在重启并安装更新…', undefined, {
      action: 'install-started',
      arch: platformAdapter.arch,
    });
    getAdapter().quitAndInstall(false, true);
    installTimer = setTimeout(() => {
      if (installing) {
        clearInstallTimer();
        emit('error', '安装启动超时，更新仍已保留，请重试。', undefined, {
          action: 'install-started',
          arch: platformAdapter.arch,
          recoverable: true,
        });
      }
    }, INSTALL_TIMEOUT_MS);
    return { willRestart: true, action: 'install-started', arch: platformAdapter.arch };
  } catch (error) {
    clearInstallTimer();
    emit('error', error instanceof Error ? error.message : String(error), undefined, {
      action: 'install-started',
      arch: platformAdapter.arch,
      recoverable: true,
    });
    throw error;
  }
}

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
export function setUpdaterPlatformForTests(next: UpdaterPlatformAdapter): () => void {
  const previous = platformAdapter;
  platformAdapter = next;
  return () => {
    platformAdapter = previous;
  };
}
export function setUpdaterCommandForTests(next: RunCommand): () => void {
  const previous = runCommand;
  runCommand = next;
  return () => {
    runCommand = previous;
  };
}
export function setUpdaterFeedForTests(url?: string): () => void {
  const previous = testUpdateUrl;
  testUpdateUrl = url;
  return () => {
    testUpdateUrl = previous;
  };
}
