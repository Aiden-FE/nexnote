import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerAllIpcHandlers } from '../src/ipc';
import { createIpcRegistrar, type IpcMainLike } from '../src/ipc/registrar';
import { AppStore } from '../src/vault/app-store';
import { VaultSession } from '../src/vault/vault-session';
import { VaultFsService } from '../src/fs/fs-service';
import { VaultWatchService } from '../src/fs/watch-service';
import { GitService } from '../src/git/git-service';
import { IPC_CHANNELS } from '@nexnote/shared';
import type { IpcServices } from '../src/ipc/services';

class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
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

function makeServices(): { services: IpcServices; session: VaultSession; store: AppStore } {
  const store = new AppStore(path.join(tmp, 'store.json'));
  const windows = new FakeWindows();
  const session = new VaultSession({
    appStore: store,
    windows: windows as never,
  });
  const fs = new VaultFsService(() => session.getCurrent()?.root ?? null);
  const git = new GitService({ useSystemGit: true, minCommitIntervalMs: 0 });
  const services: IpcServices = {
    windows: windows as never,
    appStore: store,
    vaultSession: session,
    fs,
    git,
    dialogs: { pickDirectory: async () => null },
    trash: async () => {},
    revealItem: async () => {},
    watch: new VaultWatchService({ getRoot: () => null, emit: () => undefined }),
    appInfo: () => ({
      version: '0.1.0',
      platform: 'test',
      arch: 'test',
      isPackaged: false,
      electronVersion: 'test',
    }),
    checkForUpdates: async () => ({ status: 'not-configured' as const }),
  };
  return { services, session, store };
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
    expect(() =>
      registrar.register('app:getInfo', (_p, s) => ({ ok: true, data: s.appInfo() })),
    ).toThrow(/重复注册/);
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

    // vault:create 同时初始化 Git 仓库与初始提交
    const createdStatus = (await ipc.invoke('git:getStatus')) as {
      ok: boolean;
      data: { repository: boolean; branch: string | null };
    };
    expect(createdStatus.ok).toBe(true);
    expect(createdStatus.data.repository).toBe(true);
    expect(createdStatus.data.branch).toBeTruthy();

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
    // 关闭时向渲染层发送一次“仓库已关闭”的状态事件
    const win = services.windows as unknown as {
      sent: Array<{ channel: string; payload: { repository: boolean } }>;
    };
    const closedStatusEvents = win.sent.filter(
      (e) => e.channel === 'git:statusChanged' && e.payload.repository === false,
    );
    expect(closedStatusEvents.length).toBeGreaterThan(0);
    const denied = (await ipc.invoke('fs:readTextFile', { path: 'hello.md' })) as {
      ok: boolean;
      error: string;
      code?: string;
    };
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe('NO_VAULT');
  });

  it('vault:open 对未初始化 Git 的普通目录拒绝打开（引导走显式确认初始化）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const rejected = (await ipc.invoke('vault:open', { path: tmp })) as {
      ok: boolean;
      error: string;
      code?: string;
    };
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe('GIT_INITIALIZATION_REQUIRED');

    // 显式确认路径：vault:initGit 校验 → 初始化 → 打开
    const initialized = (await ipc.invoke('vault:initGit', { path: tmp })) as {
      ok: boolean;
      data: { root: string };
    };
    expect(initialized.ok).toBe(true);
    expect(initialized.data.root).toBe(tmp);
    const opened = (await ipc.invoke('vault:open', { path: tmp })) as {
      ok: boolean;
      data: { root: string };
    };
    expect(opened.ok).toBe(true);
    expect(opened.data.root).toBe(tmp);
  });

  it('vault:initGit 对不存在的目录拒绝（不静默创建用户目录）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const result = (await ipc.invoke('vault:initGit', {
      path: path.join(tmp, 'does-not-exist'),
    })) as { ok: boolean; code?: string };
    expect(result.ok).toBe(false);
  });

  it('vault:close 清空 Git root 并取消待执行的自动提交', async () => {
    const ipc = new FakeIpcMain();
    const { services, session } = makeServices();
    registerAllIpcHandlers(ipc, services);

    // 创建 vault → 排程一个很长的自动提交
    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'close-vault',
    })) as { ok: boolean; data: { root: string } };
    expect(created.ok).toBe(true);
    const root = created.data.root;
    const git = services.git as unknown as {
      root: string | null;
      autoTimer: ReturnType<typeof setTimeout> | null;
    };
    await ipc.invoke('git:recordAutoCommit', { summary: '未提交', debounceMs: 60_000 });
    expect(git.root).toBe(root);
    expect(git.autoTimer).not.toBeNull();

    const closed = (await ipc.invoke('vault:close')) as { ok: boolean };
    expect(closed.ok).toBe(true);
    expect(session.getCurrent()).toBeNull();
    expect(git.root).toBeNull();
    expect(git.autoTimer).toBeNull();
  });

  it('git:statusChanged 事件在写入、自动提交、手动提交后发送', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);

    // 创建 vault 并订阅主进程事件
    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'status-events',
    })) as { ok: boolean; data: { root: string } };
    expect(created.ok).toBe(true);
    const win = services.windows as unknown as { sent: Array<{ channel: string }> };
    const before = win.sent.filter((e) => e.channel === 'git:statusChanged').length;

    // 文件写入：立即触发状态事件
    await ipc.invoke('fs:writeTextFile', { path: 'note.md', content: 'x' });
    const afterWrite = win.sent.filter((e) => e.channel === 'git:statusChanged').length;
    expect(afterWrite).toBeGreaterThan(before);

    // 自动提交排程到期 → 再发一次状态事件
    await ipc.invoke('git:recordAutoCommit', { summary: 'note.md', debounceMs: 20 });
    // Runtime policy clamps call overrides to the same 500ms minimum as settings.
    await new Promise((r) => setTimeout(r, 750));
    const afterAuto = win.sent.filter((e) => e.channel === 'git:statusChanged').length;
    expect(afterAuto).toBeGreaterThan(afterWrite);

    // 手动提交 → 再次发送
    await ipc.invoke('git:commit', { message: '手动提交' });
    const afterManual = win.sent.filter((e) => e.channel === 'git:statusChanged').length;
    expect(afterManual).toBeGreaterThan(afterAuto);
  });

  it('命名空间 ping 通道可用（editor/ai/plugins + git 真实通道）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    for (const ns of ['editor', 'ai', 'plugins']) {
      const pong = (await ipc.invoke(`${ns}:ping`)) as {
        ok: boolean;
        data: { pong: boolean; namespace: string };
      };
      expect(pong.ok).toBe(true);
      expect(pong.data.pong).toBe(true);
      expect(pong.data.namespace).toBe(ns);
    }
    // git:* 已由 git-handlers 注册，git:ping 与 git:getStatus 均可用
    const gitPing = (await ipc.invoke('git:ping')) as {
      ok: boolean;
      data: { implementedBy: string };
    };
    expect(gitPing.ok).toBe(true);
    expect(gitPing.data.implementedBy).toBe('DEV-007');
    const status = (await ipc.invoke('git:getStatus')) as {
      ok: boolean;
      error: string;
      code?: string;
    };
    expect(status.ok).toBe(false);
    expect(status.code).toBe('NO_VAULT');
  });

  it('git:setUseSystemGit 在内存与持久化中均生效', async () => {
    const ipc = new FakeIpcMain();
    const { services, store } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'system-git',
    })) as { ok: boolean };
    expect(created.ok).toBe(true);
    const before = (await ipc.invoke('git:getStatus')) as {
      ok: boolean;
      data: { usingSystemGit: boolean };
    };
    // 测试环境以系统 Git 构造服务（CI 无捆绑 Git payload）
    expect(before.data.usingSystemGit).toBe(true);
    await ipc.invoke('git:setUseSystemGit', { enabled: false });
    const after = (await ipc.invoke('git:getStatus')) as {
      ok: boolean;
      data: { usingSystemGit: boolean };
    };
    expect(after.data.usingSystemGit).toBe(false);
    expect(store.getUseSystemGit()).toBe(false);
  });

  it('git debounce IPC clamps, applies, and persists the configured value', async () => {
    const ipc = new FakeIpcMain();
    const { services, store } = makeServices();
    registerAllIpcHandlers(ipc, services);

    const initial = (await ipc.invoke('git:getAutoCommitDebounce')) as {
      ok: boolean;
      data: { milliseconds: number };
    };
    expect(initial.data.milliseconds).toBe(30_000);

    const clamped = (await ipc.invoke('git:setAutoCommitDebounce', {
      milliseconds: 1,
    })) as { ok: boolean; data: { milliseconds: number } };
    expect(clamped.ok).toBe(true);
    expect(clamped.data.milliseconds).toBe(500);
    expect(services.git.getDebounceMs()).toBe(500);
    expect(store.getAutoCommitDebounceMs()).toBe(500);

    const rejected = (await ipc.invoke('git:setAutoCommitDebounce', {
      milliseconds: '500',
    })) as { ok: boolean; code?: string };
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe('IPC_PAYLOAD_INVALID');
  });

  it('Hostile IPC payloads are rejected with IPC_PAYLOAD_INVALID before reaching handlers', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);

    // Each entry: [channel, malicious payload, label]. Hostile inputs include
    // wrong types, missing required fields, additional junk keys, and payloads
    // for void channels.
    const cases: Array<[string, unknown, string]> = [
      ['fs:writeTextFile', { path: 123, content: 'x' }, 'fs:writeTextFile 数字路径'],
      ['fs:writeTextFile', { content: 'x' }, 'fs:writeTextFile 缺 path'],
      ['fs:writeTextFile', { path: 'a', content: 'x', admin: true }, 'fs:writeTextFile 多余字段'],
      ['fs:rename', { from: 'a' }, 'fs:rename 缺 to'],
      ['fs:rename', { from: 1, to: 2 }, 'fs:rename 数字字段'],
      ['fs:mkdir', { path: 'a', recursive: 'yes' }, 'fs:mkdir 错误类型'],
      ['fs:delete', { path: 'a', toTrash: 'yes' }, 'fs:delete 错误类型'],
      ['fs:createNote', { parentDir: 7 }, 'fs:createNote 数字 parentDir'],
      ['fs:createNote', { parentDir: '', name: 7 }, 'fs:createNote 数字 name'],
      ['fs:listTree', { showAllFiles: 'yes' }, 'fs:listTree 错误类型'],
      ['fs:renameLinked', { from: 'a' }, 'fs:renameLinked 缺 to'],
      ['fs:revealInFinder', { path: 7 }, 'fs:revealInFinder 数字 path'],
      ['git:commit', { message: 42 }, 'git:commit 非字符串'],
      ['git:commit', {}, 'git:commit 空对象'],
      ['git:addRemote', { name: 'origin' }, 'git:addRemote 缺 url'],
      ['git:previewRestore', { path: 'a' }, 'git:previewRestore 缺 commit'],
      ['git:setUseSystemGit', { enabled: 'true' }, 'git:setUseSystemGit 字符串'],
      ['vault:create', { parentDir: tmp }, 'vault:create 缺 name'],
      ['vault:create', { parentDir: tmp, name: 'x', evil: true }, 'vault:create 多余字段'],
      ['vault:saveLayout', { layout: 'oops' }, 'vault:saveLayout 错误 layout'],
      // void channels reject any non-null object
      ['git:getStatus', { sneaky: 'oops' }, 'git:getStatus 不收 payload'],
    ];

    for (const [channel, payload, label] of cases) {
      const result = (await ipc.invoke(channel, payload)) as {
        ok: boolean;
        code?: string;
      };
      expect(result.ok, `${label} should reject`).toBe(false);
      expect(result.code, `${label} should be IPC_PAYLOAD_INVALID`).toBe('IPC_PAYLOAD_INVALID');
    }
  });

  it('vault:clone 拒绝逃逸 parentDir 的目录名（traversal hardening）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const parent = await mkdtemp(path.join(tmpdir(), 'nexnote-clone-parent-'));
    try {
      const host = 'https://example.invalid/repo.git';
      const badNames = [
        '..',
        '.',
        '../escape',
        'foo/../escape',
        '/absolute',
        'name|pipe',
        '..\\escape',
      ];
      for (const name of badNames) {
        const result = (await ipc.invoke('vault:clone', {
          url: host,
          parentDir: parent,
          name,
        })) as { ok: boolean; code?: string; error?: string };
        expect(result.ok, `name=${name} should be rejected`).toBe(false);
        // Either sanitizeVaultName refused it (custom error code) or it surfaced
        // as IPC_PAYLOAD_INVALID via the registrar — both are safe rejections.
        expect(['IPC_PAYLOAD_INVALID', 'INVALID_NAME']).toContain(result.code);
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('git:pull 在工作区 dirty 时拒绝（除非显式 force）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'dirty-pull',
    })) as { ok: boolean; data: { root: string } };
    expect(created.ok).toBe(true);
    // 留一个未提交的脏变更
    await ipc.invoke('fs:writeTextFile', { path: 'uncommitted.md', content: 'pending' });
    const denied = (await ipc.invoke('git:pull', {})) as {
      ok: boolean;
      code?: string;
    };
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe('WORKTREE_DIRTY');

    // force=true 仍要通过验证（不会因校验失败）；执行会因没远程而失败，但是错误
    // 应来自底层而非 WORKTREE_DIRTY 守卫。
    const forced = (await ipc.invoke('git:pull', { force: true })) as {
      ok: boolean;
      code?: string;
    };
    expect(forced.code).not.toBe('WORKTREE_DIRTY');

    // 校验失败的 payload 也必须被拒
    const badPayload = (await ipc.invoke('git:pull', { force: 'yes' } as never)) as {
      ok: boolean;
      code?: string;
    };
    expect(badPayload.ok).toBe(false);
    expect(badPayload.code).toBe('IPC_PAYLOAD_INVALID');
  });
});
