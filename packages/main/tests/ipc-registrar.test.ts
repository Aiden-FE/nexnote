import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerAllIpcHandlers } from '../src/ipc';
import { createIpcRegistrar, type IpcMainLike } from '../src/ipc/registrar';
import { AppStore } from '../src/vault/app-store';
import { VaultSession } from '../src/vault/vault-session';
import { VaultFsService } from '../src/fs/fs-service';
import { IPC_CHANNELS } from '@nexnote/shared';
import type { IpcServices } from '../src/ipc/services';

class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void {
    if (this.handlers.has(channel)) throw new Error(`duplicate: ${channel}`);
    this.handlers.set(channel, listener);
  }

  invoke(channel: string, payload?: unknown): Promise<unknown> {
    const h = this.handlers.get(channel);
    if (!h) throw new Error(`no handler registered: ${channel}`);
    return Promise.resolve(h(undefined, payload));
  }
}

class FakeWindows {
  sent: Array<{ channel: string; payload: unknown }> = [];
  sendToMainWindow(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
}

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-ipc-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function makeServices(): { services: IpcServices; session: VaultSession; store: AppStore; reveals: string[] } {
  const store = new AppStore(path.join(tmp, 'store.json'));
  const windows = new FakeWindows();
  const reveals: string[] = [];
  const session = new VaultSession({
    appStore: store,
    windows: windows as never,
  });
  const fs = new VaultFsService(() => session.getCurrent()?.root ?? null);
  const services: IpcServices = {
    windows: windows as never,
    appStore: store,
    vaultSession: session,
    fs,
    dialogs: { pickDirectory: async () => null },
    trash: async () => {},
    reveal: (absPath) => reveals.push(absPath),
    appInfo: () => ({
      version: '0.1.0',
      platform: 'test',
      arch: 'test',
      isPackaged: false,
      electronVersion: 'test',
    }),
    checkForUpdates: async () => ({ status: 'not-configured' as const }),
  };
  return { services, session, store, reveals };
}

describe('IPC 注册表框架', () => {
  it('契约中的全部通道都能被注册（无遗漏/无重复）', () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    const registrar = registerAllIpcHandlers(ipc, services);
    expect(registrar.registeredChannels().sort()).toEqual([...IPC_CHANNELS].sort());
  });

  it('拒绝未在契约中声明的通道', () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    const registrar = createIpcRegistrar(ipc, services);
    expect(() => registrar.register('bogus:channel' as never, (async () => null) as never)).toThrow(
      /未在 shared 契约中声明/,
    );
  });

  it('拒绝重复注册', () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    const registrar = createIpcRegistrar(ipc, services);
    registrar.register('app:getInfo', (_p, s) => ({ ok: true, data: s.appInfo() }));
    expect(() => registrar.register('app:getInfo', (_p, s) => ({ ok: true, data: s.appInfo() }))).toThrow(
      /重复注册/,
    );
  });

  it('handler 抛错时统一转 Result 错误信封（含错误码）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    const registrar = createIpcRegistrar(ipc, services);
    registrar.register('fs:readTextFile', async () => {
      const e = new Error('boom') as Error & { code: string };
      e.code = 'READ_FAILED';
      throw e;
    });
    const result = (await ipc.invoke('fs:readTextFile', { path: 'x' })) as {
      ok: boolean;
      error: string;
      code?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.code).toBe('READ_FAILED');
  });
});

describe('IPC 集成（vault + fs，单一注册表）', () => {
  it('完整生命周期：create → getState ready → fs 写读 → saveLayout → close → onboarding', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);

    // 首次状态：向导
    const initial = (await ipc.invoke('vault:getState')) as {
      ok: boolean;
      data: { mode: string; recent: unknown[] };
    };
    expect(initial.ok).toBe(true);
    expect(initial.data.mode).toBe('onboarding');

    // 新建 vault
    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'smoke-vault',
    })) as { ok: boolean; data: { root: string; name: string } };
    expect(created.ok).toBe(true);
    expect(created.data.name).toBe('smoke-vault');

    // 状态变 ready，且最近列表包含它
    const afterCreate = (await ipc.invoke('vault:getState')) as {
      ok: boolean;
      data: { mode: string; vault: { root: string }; recent: { name: string }[] };
    };
    expect(afterCreate.data.mode).toBe('ready');
    expect(afterCreate.data.vault.root).toBe(path.join(tmp, 'smoke-vault'));
    const recentAfterCreate = (await ipc.invoke('vault:listRecent')) as {
      ok: boolean;
      data: { name: string }[];
    };
    expect(recentAfterCreate.data[0]?.name).toBe('smoke-vault');

    // fs 在 vault 内可用
    const written = (await ipc.invoke('fs:writeTextFile', {
      path: 'hello.md',
      content: '# 来自 IPC 测试',
    })) as { ok: boolean; data: { path: string } };
    expect(written.ok).toBe(true);
    const read = (await ipc.invoke('fs:readTextFile', { path: 'hello.md' })) as {
      ok: boolean;
      data: string;
    };
    expect(read.data).toBe('# 来自 IPC 测试');

    // 布局持久化
    const saved = (await ipc.invoke('vault:saveLayout', {
      layout: {
        sidebarWidth: 300,
        sidebarCollapsed: false,
        activeSidebarPanelId: null,
        dockVisible: true,
        dockWidth: 320,
        splitEnabled: true,
        splitRatio: 0.62,
      },
    })) as { ok: boolean };
    expect(saved.ok).toBe(true);
    const layout = (await ipc.invoke('vault:getLayout')) as {
      ok: boolean;
      data: { sidebarWidth: number; splitRatio: number };
    };
    expect(layout.data.sidebarWidth).toBe(300);
    expect(layout.data.splitRatio).toBe(0.62);

    // 关闭 → 回到向导；fs 拒绝
    const closed = (await ipc.invoke('vault:close')) as { ok: boolean };
    expect(closed.ok).toBe(true);
    const afterClose = (await ipc.invoke('vault:getState')) as {
      ok: boolean;
      data: { mode: string };
    };
    expect(afterClose.data.mode).toBe('onboarding');
    const denied = (await ipc.invoke('fs:readTextFile', { path: 'hello.md' })) as {
      ok: boolean;
      error: string;
      code?: string;
    };
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe('NO_VAULT');
  });

  it('vault:reveal 解析 vault 内路径并调用系统文件管理器', async () => {
    const ipc = new FakeIpcMain();
    const { services, reveals } = makeServices();
    registerAllIpcHandlers(ipc, services);
    await ipc.invoke('vault:open', { path: tmp });
    const result = (await ipc.invoke('vault:reveal', { path: 'nested/note.md' })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(reveals).toEqual([path.join(tmp, 'nested/note.md')]);
  });

  it('vault:open 对普通目录自动初始化 .nexnote', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const opened = (await ipc.invoke('vault:open', { path: tmp })) as {
      ok: boolean;
      data: { root: string };
    };
    expect(opened.ok).toBe(true);
    expect(opened.data.root).toBe(tmp);
  });

  it('命名空间 ping 通道可用（editor/git/ai/plugins 占位）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    for (const ns of ['editor', 'git', 'ai', 'plugins']) {
      const pong = (await ipc.invoke(`${ns}:ping`)) as {
        ok: boolean;
        data: { pong: boolean; namespace: string };
      };
      expect(pong.ok).toBe(true);
      expect(pong.data.pong).toBe(true);
      expect(pong.data.namespace).toBe(ns);
    }
  });
});
