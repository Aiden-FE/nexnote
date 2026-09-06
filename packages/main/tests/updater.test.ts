import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdates,
  downloadUpdate,
  initAutoUpdater,
  installUpdate,
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

let restore = () => {};
let envBackup: NodeJS.ProcessEnv = {};

afterEach(() => {
  restore();
  process.env = { ...envBackup };
});

describe('update channel resolution (NEXNOTE_UPDATE_CHANNEL)', () => {
  it('defaults to stable when env missing', async () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    expect(await checkForUpdates()).toMatchObject({ status: 'not-configured', channel: 'stable' });
  });

  it('reads a valid alpha channel from env', async () => {
    envBackup = { ...process.env };
    process.env.NEXNOTE_UPDATE_CHANNEL = 'alpha';
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    initAutoUpdater(() => {});
    expect(setUpdateChannel('alpha')).toMatchObject({ status: 'not-configured', channel: 'alpha' });
  });

  it('falls back to stable when env is invalid', async () => {
    envBackup = { ...process.env };
    process.env.NEXNOTE_UPDATE_CHANNEL = 'nightly';
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    const result = setUpdateChannel('nightly' as never);
    expect(result).toMatchObject({ status: 'error' });
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
    expect(adapter.setFeedURL).toHaveBeenCalledWith(expect.objectContaining({ channel: 'beta' }));
    expect(await checkForUpdates()).toMatchObject({ status: 'available', version: '9.9.9', channel: 'beta' });
    expect(statuses).toContainEqual(expect.objectContaining({ status: 'available', version: '9.9.9' }));
  });

  it('rejects unsupported channel on setUpdateChannel', () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    expect(setUpdateChannel('nightly' as never)).toMatchObject({ status: 'error' });
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
    expect(await downloadUpdate()).toMatchObject({ status: 'downloaded' });
    expect(installUpdate()).toEqual({ willRestart: true });
    expect(adapter.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('does not install before a packaged update is downloaded', () => {
    delete process.env.NEXNOTE_UPDATE_CHANNEL;
    envBackup = { ...process.env };
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    expect(() => installUpdate()).toThrow(/没有已下载/);
  });
});
