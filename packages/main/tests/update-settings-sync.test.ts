import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../src/settings/settings-service';
import {
  extractUpdateSettings,
  syncUpdaterSettings,
} from '../src/settings/update-settings-sync';
import { AppStore } from '../src/vault/app-store';
import {
  getUpdateSettings,
  initAutoUpdater,
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

let tmp: string;
let settingsFile: string;
let appStoreFile: string;
let restore = () => {};
let envBackup: NodeJS.ProcessEnv = {};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nexnote-update-sync-test-'));
  settingsFile = join(tmp, 'settings.json');
  appStoreFile = join(tmp, 'app.json');
  envBackup = { ...process.env };
  delete process.env.NEXNOTE_UPDATE_CHANNEL;
  const { adapter } = makeAdapter();
  restore = setUpdaterAdapterForTests(adapter, { isPackaged: true, getVersion: () => '0.1.0' });
});

afterEach(() => {
  restore();
  process.env = { ...envBackup };
  rmSync(tmp, { recursive: true, force: true });
});

describe('extractUpdateSettings', () => {
  it('从 SettingsService 提取 updater 三字段', () => {
    const settings = new SettingsService(settingsFile);
    const u = extractUpdateSettings(settings);
    expect(u).toMatchObject({
      channel: 'stable',
      autoDownload: false,
      checkOnLaunch: true,
    });
  });

  it('变更后反映新值', () => {
    const settings = new SettingsService(settingsFile);
    settings.update({ updates: { channel: 'beta', autoDownload: true, checkOnLaunch: false } });
    const u = extractUpdateSettings(settings);
    expect(u).toMatchObject({ channel: 'beta', autoDownload: true, checkOnLaunch: false });
  });
});

describe('syncUpdaterSettings', () => {
  it('启动时同步：SettingsService 值写入 updater 运行态 + AppStore 镜像', () => {
    // 先在磁盘预置一个 settings，channel=beta, autoDownload=false
    writeFileSync(
      settingsFile,
      JSON.stringify({
        version: 1,
        updates: { channel: 'beta', autoDownload: false, checkOnLaunch: false },
      }),
    );
    const settings = new SettingsService(settingsFile);
    const appStore = new AppStore(appStoreFile);

    // 初始化 updater 为默认 stable（packaged=true 且无 baked channel 无 env → stable）
    initAutoUpdater(() => {}, () => {});
    expect(getUpdateSettings().channel).toBe('stable');

    // 执行同步
    const unsubscribe = syncUpdaterSettings(settings, appStore);
    unsubscribe();

    // updater 运行态应反映 SettingsService 的值
    const updaterState = getUpdateSettings();
    expect(updaterState.channel).toBe('beta');
    expect(updaterState.autoDownload).toBe(false);
    expect(updaterState.checkOnLaunch).toBe(false);

    // AppStore 镜像也应同步
    expect(appStore.get().updateChannel).toBe('beta');
    expect(appStore.getUpdateAutoDownload()).toBe(false);
    expect(appStore.getUpdateCheckOnLaunch()).toBe(false);
  });

  it('SettingsService 更新时 diff-apply 到 updater 运行态', () => {
    const settings = new SettingsService(settingsFile);
    const appStore = new AppStore(appStoreFile);

    // 初始化 updater 为默认值
    initAutoUpdater(() => {}, () => {});
    const unsubscribe = syncUpdaterSettings(settings, appStore);

    // 初始：stable, autoDownload=false (默认值)
    expect(getUpdateSettings().channel).toBe('stable');

    // 通过 SettingsService 修改 channel
    settings.update({ updates: { channel: 'alpha' } });

    // updater 运行态应随之变更
    expect(getUpdateSettings().channel).toBe('alpha');

    // AppStore 也应同步
    expect(appStore.get().updateChannel).toBe('alpha');

    unsubscribe();
  });

  it('修改 autoDownload 会同步到 updater 适配器（packaged 模式）', () => {
    const { adapter } = makeAdapter();
    const localRestore = setUpdaterAdapterForTests(
      adapter,
      { isPackaged: true, getVersion: () => '0.1.0' },
    );
    try {
      const settings = new SettingsService(settingsFile);
      const appStore = new AppStore(appStoreFile);
      initAutoUpdater(() => {}, () => {}, { channel: 'stable', autoDownload: true });
      expect(adapter.autoDownload).toBe(true);

      const unsubscribe = syncUpdaterSettings(settings, appStore);

      // 默认 autoDownload 是 false（从 SettingsService 来），sync 后应为 false
      expect(adapter.autoDownload).toBe(false);

      // 再通过 SettingsService 改为 true
      settings.update({ updates: { autoDownload: true } });
      expect(adapter.autoDownload).toBe(true);

      unsubscribe();
    } finally {
      localRestore();
    }
  });

  it('无关设置变更（如 theme）不会触发 updater 状态变更', () => {
    const settings = new SettingsService(settingsFile);
    const appStore = new AppStore(appStoreFile);
    initAutoUpdater(() => {}, () => {});
    const unsubscribe = syncUpdaterSettings(settings, appStore);

    const before = getUpdateSettings();
    // 改主题，不改 updates
    settings.update({ appearance: { theme: 'dark' } });
    const after = getUpdateSettings();

    // updater 状态应不变
    expect(after).toEqual(before);

    unsubscribe();
  });

  it('幂等：重复调用相同值不会产生冗余应用', () => {
    const { adapter } = makeAdapter();
    const localRestore = setUpdaterAdapterForTests(
      adapter,
      { isPackaged: true, getVersion: () => '0.1.0' },
    );
    try {
      const settings = new SettingsService(settingsFile);
      const appStore = new AppStore(appStoreFile);
      initAutoUpdater(() => {}, () => {}, { channel: 'stable', autoDownload: true });

      const unsubscribe = syncUpdaterSettings(settings, appStore);

      const setFeedBefore = adapter.setFeedURL.mock.calls.length;
      // 用当前值再 update 一次（即 no-op patch）
      settings.update({ updates: { channel: 'stable' } });
      // 因为 channel 没变，setFeedURL 不应被再次调用（diff-check 跳过）
      expect(adapter.setFeedURL.mock.calls.length).toBe(setFeedBefore);

      unsubscribe();
    } finally {
      localRestore();
    }
  });
});

describe('SettingsService update prune 未知子字段', () => {
  it('update 时未知子字段不会持久化', () => {
    const settings = new SettingsService(settingsFile);
    // 模拟 IPC 带的多余字段
    const patch = {
      updates: { channel: 'beta', unknownField: 'leak' } as never,
      appearance: { theme: 'dark', hack: true } as never,
    };
    settings.update(patch);

    const data = settings.get();
    expect((data.updates as Record<string, unknown>).unknownField).toBeUndefined();
    expect((data.appearance as Record<string, unknown>).hack).toBeUndefined();

    // 磁盘上也不应有
    const onDisk = JSON.parse(readFileSync(settingsFile, 'utf8'));
    expect(onDisk.updates.unknownField).toBeUndefined();
    expect(onDisk.appearance.hack).toBeUndefined();

    // 正常字段仍生效
    expect(data.updates.channel).toBe('beta');
    expect(data.appearance.theme).toBe('dark');
  });
});
