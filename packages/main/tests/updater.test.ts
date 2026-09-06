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
afterEach(() => restore());

describe('updater policy', () => {
  it('keeps development mode explicitly unconfigured', async () => {
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    expect(await checkForUpdates()).toMatchObject({ status: 'not-configured', channel: 'stable' });
  });

  it('configures packaged app channel and detects a newer release', async () => {
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
    const statuses: unknown[] = [];
    initAutoUpdater(() => {}, (status) => statuses.push(status));
    expect(setUpdateChannel('beta')).toMatchObject({ channel: 'beta' });
    expect(adapter.channel).toBe('beta');
    expect(adapter.setFeedURL).toHaveBeenCalledWith(expect.objectContaining({ channel: 'beta' }));
    expect(await checkForUpdates()).toMatchObject({ status: 'available', version: '9.9.9', channel: 'beta' });
    expect(statuses).toContainEqual(expect.objectContaining({ status: 'available', version: '9.9.9' }));
  });

  it('emits progress, downloads, and explicitly installs', async () => {
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
    const { adapter } = makeAdapter();
    restore = setUpdaterAdapterForTests(adapter, { isPackaged: false, getVersion: () => '0.1.0' });
    expect(() => installUpdate()).toThrow(/没有已下载/);
  });
});
