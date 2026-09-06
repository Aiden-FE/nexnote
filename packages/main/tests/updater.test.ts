import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REPO_NAME,
  REPO_OWNER,
  checkForUpdates,
  downloadUpdate,
  initAutoUpdater,
  installUpdate,
  normalizeChannel,
  setUpdateChannel,
  setUpdaterAdapterForTests,
  type UpdaterAdapter,
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
  writeFileSync(join(dir, 'app-update.yml'), `provider: github\nowner: Aiden-FE\nrepo: nexnote\nchannel: ${channel}\n`);
  return dir;
}

let restore = () => {};
let envBackup: NodeJS.ProcessEnv = {};

afterEach(() => {
  restore();
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
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' }, resourcesPath);
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
    expect(setUpdateChannel('alpha')).toMatchObject({ status: 'not-configured', channel: 'alpha' });
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
    initAutoUpdater(() => {}, () => {}, 'stable');
    expect(adapter.channel).toBe('latest');
    // GitHub provider must omit channel for stable so electron-updater reads latest*.yml.
    expect(adapter.setFeedURL).not.toHaveBeenCalled();
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
    initAutoUpdater(() => {}, () => {}, 'stable'); // reset module-level activeChannel
    expect(await checkForUpdates()).toMatchObject({ status: 'not-configured', channel: 'stable' });
  });

  it('configures packaged app channel and detects a newer release', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    const statuses: unknown[] = [];
    initAutoUpdater(() => {}, (status) => statuses.push(status), 'beta');
    expect(adapter.channel).toBe('beta');
    expect(await checkForUpdates()).toMatchObject({ status: 'available', version: '9.9.9', channel: 'beta' });
    expect(statuses).toContainEqual(expect.objectContaining({ status: 'available', version: '9.9.9' }));
  });

  it('emits progress, downloads, and explicitly installs', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter, listeners } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    const statuses: Array<{ status: string; progress?: number }> = [];
    initAutoUpdater(() => {}, (status) => statuses.push(status));
    await checkForUpdates();
    listeners.get('download-progress')?.({ percent: 42 });
    expect(statuses.at(-1)).toMatchObject({ status: 'downloading', progress: 42 });
    expect(await downloadUpdate()).toMatchObject({ status: 'downloading' });
    expect(() => installUpdate()).toThrow(/没有已下载/);
    listeners.get('update-downloaded')?.({ version: '9.9.9' });
    expect(installUpdate()).toEqual({ willRestart: true });
    expect(adapter.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('deduplicates repeated available events and concurrent download requests', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter, listeners } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    const statuses: Array<{ status: string }> = [];
    initAutoUpdater(() => {}, (status) => statuses.push(status));
    listeners.get('update-available')?.({ version: '9.9.9' });
    listeners.get('update-available')?.({ version: '9.9.9' });
    expect(statuses.filter((s) => s.status === 'available')).toHaveLength(1);
    await downloadUpdate();
    await downloadUpdate();
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not install before a packaged update is downloaded', () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    expect(() => installUpdate()).toThrow(/没有已下载/);
  });
});
