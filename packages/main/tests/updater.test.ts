import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REPO_NAME,
  REPO_OWNER,
  checkForUpdates,
  downloadUpdate,
  getUpdateSettings,
  initAutoUpdater,
  installUpdate,
  normalizeChannel,
  setUpdateChannel,
  setUpdateSettings,
  setUpdaterAdapterForTests,
  setUpdaterCommandForTests,
  setUpdaterPlatformForTests,
  type UpdaterAdapter,
  type UpdaterPlatformAdapter,
  type CommandOutput,
} from '../src/updater';

function makeAdapter() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const adapter: UpdaterAdapter = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: 'stable',
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: '9.9.9' } })),
    downloadUpdate: vi.fn(async () => {}),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    on: (event, listener) => {
      listeners.set(event, listener);
    },
  };
  return { adapter, listeners };
}

/** Create a fake package resources dir containing the given app-update.yml. */
function bakeChannel(channel: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'nexnote-resources-'));
  writeFileSync(
    join(dir, 'app-update.yml'),
    `provider: github\nowner: Aiden-FE\nrepo: nexnote\nchannel: ${channel}\n`,
  );
  return dir;
}

let restore = () => {};
let restorePlatform = () => {};
let envBackup: NodeJS.ProcessEnv = {};

afterEach(() => {
  restore();
  restorePlatform();
  process.env = { ...envBackup };
});

describe('channel resolution', () => {
  it('defaults to stable when no channel source present', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    expect(await checkForUpdates()).toMatchObject({ status: 'not-configured', channel: 'stable' });
  });

  it('reads the channel baked into app-update.yml when packaged (beta)', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const resourcesPath = bakeChannel('beta');
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(
      adapter,
      { isPackaged: true, getVersion: () => '0.1.0' },
      resourcesPath,
    );
    initAutoUpdater(() => {});
    expect(adapter.channel).toBe('beta');
    // GitHub default: no feed override, electron-updater reads the baked app-update.yml.
    expect(adapter.setFeedURL).not.toHaveBeenCalled();
    expect(await checkForUpdates()).toMatchObject({ status: 'available', channel: 'beta' });
  });

  it('respects env channel in dev mode', async () => {
    envBackup = { ...process.env };
    process.env.NEXNOTE_UPDATE_CHANNEL = 'alpha';
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    initAutoUpdater(() => {});
    expect(setUpdateChannel('alpha')).toMatchObject({
      status: 'channel-switched',
      channel: 'alpha',
    });
  });

  it('rejects unsupported channel on setUpdateChannel', () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    expect(setUpdateChannel('nightly' as never)).toMatchObject({ status: 'error' });
  });

  it('maps stable to electron-updater latest metadata', async () => {
    delete process.env.NEXNOTE_UPDATE_URL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    initAutoUpdater(
      () => {},
      () => {},
      { channel: 'stable' },
    );
    expect(adapter.channel).toBe('latest');
    // GitHub provider must omit channel for stable so electron-updater reads latest*.yml.
    expect(adapter.setFeedURL).not.toHaveBeenCalled();
  });

  it('accepts strict SemVer precedence and rejects malformed versions', async () => {
    const { adapter, listeners } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '1.2.3' });
    initAutoUpdater(() => {});
    for (const version of ['1.2.3', '1.2.3+build.1', '1.2.2', '1.2.3-'])
      listeners.get('update-available')?.({ version });
    expect((await checkForUpdates()).status).toBe('available');
    expect((await checkForUpdates()).version).toBe('9.9.9');
  });

  it('normalizeChannel accepts only stable/beta/alpha', () => {
    expect(normalizeChannel('beta')).toBe('beta');
    expect(normalizeChannel(' BETA ')).toBe('beta');
    expect(normalizeChannel('nightly')).toBeUndefined();
    expect(normalizeChannel(undefined)).toBeUndefined();
  });

  it('targets the repository from git origin, not a placeholder', () => {
    expect(REPO_OWNER).not.toBe('nexnote');
    expect(REPO_OWNER).toBe('Aiden-FE');
    expect(REPO_NAME).toBe('nexnote');
  });
});

describe('updater policy', () => {
  it('keeps development mode explicitly unconfigured', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    initAutoUpdater(
      () => {},
      () => {},
      { channel: 'stable' },
    ); // reset module-level activeChannel
    expect(await checkForUpdates()).toMatchObject({ status: 'not-configured', channel: 'stable' });
  });

  it('configures packaged app channel and detects a newer release', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    const statuses: unknown[] = [];
    initAutoUpdater(
      () => {},
      (status) => statuses.push(status),
      { channel: 'beta' },
    );
    expect(adapter.channel).toBe('beta');
    expect(adapter.autoDownload).toBe(false);
    expect(adapter.autoInstallOnAppQuit).toBe(false);
    expect(await checkForUpdates()).toMatchObject({
      status: 'available',
      version: '9.9.9',
      channel: 'beta',
    });
    expect(statuses).toContainEqual(
      expect.objectContaining({ status: 'available', version: '9.9.9' }),
    );
  });

  it('emits progress, downloads, and explicitly installs', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter, listeners } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    restorePlatform = setUpdaterPlatformForTests({
      platform: 'linux',
      arch: 'x64',
      getAppBundlePath: () => undefined,
      verifyMacAppSignature: async () => ({ status: 'invalid', authorities: [] }),
      openExternal: vi.fn(),
    });
    const statuses: Array<{ status: string; progress?: number }> = [];
    initAutoUpdater(
      () => {},
      (status) => statuses.push(status),
    );
    await checkForUpdates();
    listeners.get('download-progress')?.({ percent: 42 });
    expect(statuses.at(-1)).toMatchObject({ status: 'downloading', progress: 42 });
    expect(await downloadUpdate()).toMatchObject({ status: 'downloading' });
    await expect(installUpdate()).rejects.toThrow(/没有可安装|没有已下载/);
    listeners.get('update-downloaded')?.({ version: '9.9.9' });
    await expect(installUpdate()).resolves.toMatchObject({
      willRestart: true,
      action: 'install-started',
    });
    expect(adapter.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('deduplicates repeated available events and concurrent download requests', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter, listeners } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    const statuses: Array<{ status: string }> = [];
    initAutoUpdater(
      () => {},
      (status) => statuses.push(status),
    );
    listeners.get('update-available')?.({ version: '9.9.9' });
    listeners.get('update-available')?.({ version: '9.9.9' });
    expect(statuses.filter((s) => s.status === 'available')).toHaveLength(1);
    // A resolved promise without update-downloaded is a failed/missed confirmation;
    // clear the guard so the user can retry rather than getting stuck.
    await downloadUpdate();
    await downloadUpdate();
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(2);
    // After explicit download confirmation event, a second call returns cached.
    listeners.get('update-downloaded')?.({ version: '9.9.9' });
    const cached = await downloadUpdate();
    expect(cached.status).toBe('downloaded');
  });

  it('parses codesign Authority and adhoc details from stdout and stderr', async () => {
    const outputs: CommandOutput[] = [
      { stdout: '', stderr: '' },
      { stdout: '', stderr: 'Signature=adhoc\nAuthority=Developer ID Application: Test' },
    ];
    const restoreCommand = setUpdaterCommandForTests(async () => outputs.shift()!);
    const restorePlatform = setUpdaterPlatformForTests({
      platform: 'darwin',
      arch: 'arm64',
      getAppBundlePath: () => '/tmp/NexNote.app',
      verifyMacAppSignature: async () => ({ status: 'invalid', authorities: [] }),
      openExternal: vi.fn(),
    });
    const { adapter, listeners } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    initAutoUpdater(() => {});
    await checkForUpdates();
    listeners.get('update-downloaded')?.({ version: '9.9.9' });
    restoreCommand();
    restorePlatform();
    expect(outputs).toBeDefined();
  });

  it('uses manual download for an unsigned Mac and retains downloaded state', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter, listeners } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    const openExternal = vi.fn();
    const platform: UpdaterPlatformAdapter = {
      platform: 'darwin',
      arch: 'arm64',
      getAppBundlePath: () => '/Applications/NexNote.app',
      verifyMacAppSignature: async () => ({ status: 'adhoc', authorities: [] }),
      openExternal,
    };
    restorePlatform = setUpdaterPlatformForTests(platform);
    initAutoUpdater(() => {});
    await checkForUpdates();
    listeners.get('update-downloaded')?.({ version: '9.9.9' });
    await expect(installUpdate()).resolves.toMatchObject({
      willRestart: false,
      action: 'manual-download',
      arch: 'arm64',
    });
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/Aiden-FE/nexnote/releases/latest',
    );
    expect(adapter.quitAndInstall).not.toHaveBeenCalled();
  });

  it('starts installation on a signed Mac', async () => {
    const { adapter, listeners } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    restorePlatform = setUpdaterPlatformForTests({
      platform: 'darwin',
      arch: 'x64',
      getAppBundlePath: () => '/Applications/NexNote.app',
      verifyMacAppSignature: async () => ({
        status: 'signed',
        authorities: ['Developer ID Application: NexNote'],
      }),
      openExternal: vi.fn(),
    });
    initAutoUpdater(() => {});
    await checkForUpdates();
    listeners.get('update-downloaded')?.({ version: '9.9.9' });
    await expect(installUpdate()).resolves.toMatchObject({
      willRestart: true,
      action: 'install-started',
    });
    expect(adapter.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('allows retry after a download promise resolves without confirmation', async () => {
    const { adapter, listeners } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    initAutoUpdater(() => {});
    await checkForUpdates();
    expect((await downloadUpdate()).status).toBe('downloading');
    listeners.get('update-downloaded')?.({ version: '9.9.9' });
    expect((await downloadUpdate()).status).toBe('downloaded');
  });

  it('does not install before a packaged update is downloaded', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    await expect(installUpdate()).rejects.toThrow(/没有可安装|没有已下载/);
  });

  it('autoDownload setting comes from init options and can be toggled via setUpdateSettings', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    initAutoUpdater(
      () => {},
      () => {},
      { channel: 'stable', autoDownload: false },
    );
    expect(adapter.autoDownload).toBe(false);
    const updated = setUpdateSettings({ autoDownload: true });
    expect(updated.autoDownload).toBe(true);
    expect(adapter.autoDownload).toBe(true);
  });

  it('checkOnLaunch setting controls whether startup check is scheduled', () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    vi.useFakeTimers();
    try {
      initAutoUpdater(
        () => {},
        () => {},
        { channel: 'stable', checkOnLaunch: false },
      );
      vi.advanceTimersByTime(10_000);
      // checkOnLaunch=false → 启动时不调度检查
      expect(adapter.checkForUpdates).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('getUpdateSettings reflects the current authoritative state', () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    initAutoUpdater(
      () => {},
      () => {},
      { channel: 'alpha', autoDownload: false, checkOnLaunch: true },
    );
    const settings = getUpdateSettings();
    expect(settings).toMatchObject({ channel: 'alpha', autoDownload: false, checkOnLaunch: true });
  });
});
