import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../src/vault/app-store';
import { VaultSession } from '../src/vault/vault-session';

class FakeWindows {
  readonly sent: Array<{ channel: string; payload: unknown }> = [];

  sendToMainWindow(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
}

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-vault-session-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('VaultSession', () => {
  it('初始化失败时保留旧 session，且不持久化或广播候选 vault', async () => {
    const first = path.join(tmp, 'first');
    const second = path.join(tmp, 'second');
    await mkdir(first);
    await mkdir(second);

    const appStore = new AppStore(path.join(tmp, 'app-store.json'));
    const windows = new FakeWindows();
    const initialize = vi.fn(async (vault: { root: string } | null) => {
      if (vault?.root === second) throw new Error('index failed');
    });
    const session = new VaultSession({
      appStore,
      windows: windows as never,
      onChanged: initialize,
    });

    const opened = await session.open(first);
    windows.sent.length = 0;

    await expect(session.open(second)).rejects.toThrow('index failed');
    expect(initialize.mock.calls.map(([vault]) => vault?.root ?? null)).toEqual([
      first,
      second,
      first,
    ]);
    expect(session.getCurrent()).toEqual(opened);
    expect(appStore.get().lastVaultPath).toBe(first);
    expect(appStore.get().recentVaults.map((entry) => entry.path)).toEqual([first]);
    expect(windows.sent).toEqual([]);
  });

  it('close 清理失败会被记录，不产生 unhandled rejection', async () => {
    const root = path.join(tmp, 'vault');
    await mkdir(root);
    const appStore = new AppStore(path.join(tmp, 'app-store.json'));
    const windows = new FakeWindows();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const session = new VaultSession({
      appStore,
      windows: windows as never,
      onChanged: async (vault) => {
        if (vault === null) throw new Error('watch cleanup failed');
      },
    });
    await session.open(root);

    session.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error).toHaveBeenCalledWith(
      '[vault] close cleanup failed:',
      expect.objectContaining({ message: 'watch cleanup failed' }),
    );
    error.mockRestore();
  });

  it('close 清空并广播 session，且通知外部服务关闭 root', async () => {
    const root = path.join(tmp, 'vault');
    await mkdir(root);
    const appStore = new AppStore(path.join(tmp, 'app-store.json'));
    const windows = new FakeWindows();
    const onChanged = vi.fn();
    const session = new VaultSession({ appStore, windows: windows as never, onChanged });
    await session.open(root);
    windows.sent.length = 0;
    onChanged.mockClear();

    session.close();

    expect(session.getCurrent()).toBeNull();
    expect(appStore.get().lastVaultPath).toBeNull();
    expect(windows.sent).toEqual([{ channel: 'vault:changed', payload: { vault: null } }]);
    expect(onChanged).toHaveBeenCalledExactlyOnceWith(null);
  });
});
