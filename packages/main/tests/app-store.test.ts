import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppStore, MAX_RECENT_VAULTS } from '../src/vault/app-store';
import { mkdir } from 'node:fs/promises';

let tmp: string;
let storeFile: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-appstore-test-'));
  storeFile = path.join(tmp, 'app-store.json');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('AppStore', () => {
  it('文件缺失时返回默认值', () => {
    const store = new AppStore(storeFile);
    expect(store.get()).toEqual({
      version: 1,
      lastVaultPath: null,
      recentVaults: [],
      windowBounds: null,
      updateChannel: null,
    });
  });

  it('文件损坏时回退默认值', async () => {
    await writeFile(storeFile, '}}}broken', 'utf8');
    const store = new AppStore(storeFile);
    expect(store.get().recentVaults).toEqual([]);
  });

  it('touchRecent 去重、置顶、限量', () => {
    const store = new AppStore(storeFile);
    store.touchRecent('/v/a');
    store.touchRecent('/v/b');
    store.touchRecent('/v/c');
    store.touchRecent('/v/a'); // 重复 → 置顶且不重复
    const paths = store.get().recentVaults.map((e) => e.path);
    expect(paths).toEqual(['/v/a', '/v/c', '/v/b']);

    for (let i = 0; i < MAX_RECENT_VAULTS + 5; i++) {
      store.touchRecent(`/v/extra-${i}`);
    }
    expect(store.get().recentVaults).toHaveLength(MAX_RECENT_VAULTS);
    expect(store.get().recentVaults[0]).toMatchObject({ path: `/v/extra-${MAX_RECENT_VAULTS + 4}` });
  });

  it('removeRecent 移除指定条目', () => {
    const store = new AppStore(storeFile);
    store.touchRecent('/v/a');
    store.touchRecent('/v/b');
    store.removeRecent('/v/a');
    expect(store.get().recentVaults.map((e) => e.path)).toEqual(['/v/b']);
  });

  it('持久化后新实例可读到（原子写）', async () => {
    const store = new AppStore(storeFile);
    store.setLastVault('/v/keep');
    store.setWindowBounds({ x: 1, y: 2, width: 1200, height: 800 });
    store.setUpdateChannel('beta');
    const raw = JSON.parse(await readFile(storeFile, 'utf8'));
    expect(raw.lastVaultPath).toBe('/v/keep');
    expect(raw.updateChannel).toBe('beta');
    const reopened = new AppStore(storeFile);
    expect(reopened.get().lastVaultPath).toBe('/v/keep');
    expect(reopened.get().windowBounds).toMatchObject({ width: 1200 });
    expect(reopened.get().updateChannel).toBe('beta');
  });

  it('existingRecents 只保留磁盘上存在的目录', async () => {
    await mkdir(path.join(tmp, 'real-vault'), { recursive: true });
    const store = new AppStore(storeFile);
    store.touchRecent(path.join(tmp, 'real-vault'));
    store.touchRecent(path.join(tmp, 'deleted-vault'));
    const recents = store.existingRecents();
    expect(recents.map((e) => e.name)).toEqual(['real-vault']);
  });
});
