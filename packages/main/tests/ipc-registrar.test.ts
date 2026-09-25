import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAllIpcHandlers } from '../src/ipc';
import { __resetVaultStateRestore } from '../src/ipc/vault-handlers';
import { createIpcRegistrar, type IpcMainLike } from '../src/ipc/registrar';
import { AppStore } from '../src/vault/app-store';
import { VaultSession } from '../src/vault/vault-session';
import { VaultFsService } from '../src/fs/fs-service';
import { VaultWatchService } from '../src/fs/watch-service';
import { PluginService } from '../src/plugins/plugin-service';
import { SkillService } from '../src/skills/skill-service';
import { GitService } from '../src/git/git-service';
import { LinkIndexService } from '../src/indexer/index-service';
import { IPC_CHANNELS } from '@nexnote/shared';
import type { IpcServices } from '../src/ipc/services';
import { AiStore } from '../src/ai/ai-store';
import { AiService } from '../src/ai/ai-service';
import type { SecretVault } from '../src/ai/secret-store';
import { SettingsService } from '../src/settings/settings-service';
import { VaultOperationsController } from '../src/vault/vault-operations-controller';
import { VaultCloneController } from '../src/vault/vault-clone-controller';
import { BinaryEditorHostManager } from '../src/binary/binary-editor-host';

/** 测试用内存 credential vault（模拟系统凭据库）。 */
function plainFakeVault(): SecretVault {
  const credentials = new Map<string, string>();
  return {
    available: true,
    put: (account, secret) => void credentials.set(account, secret),
    get: (account) => credentials.get(account) ?? null,
    delete: (account) => void credentials.delete(account),
  };
}

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
  // GitService intentionally rejects inherited unsafe editor overrides; keep this
  // integration suite isolated from a developer shell's GIT_EDITOR setting.
  vi.stubEnv('GIT_EDITOR', undefined);
  __resetVaultStateRestore();
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-ipc-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function makeServices(): {
  services: IpcServices;
  session: VaultSession;
  store: AppStore;
  reveals: string[];
} {
  const store = new AppStore(path.join(tmp, 'store.json'));
  const windows = new FakeWindows();
  const reveals: string[] = [];
  const session = new VaultSession({
    appStore: store,
    windows: windows as never,
  });
  const fs = new VaultFsService(() => session.getCurrent()?.root ?? null);
  const ai = new AiService({
    store: new AiStore(path.join(tmp, 'ai.json'), plainFakeVault()),
    sendEvent: () => undefined,
  });
  const git = new GitService({ useSystemGit: true, minCommitIntervalMs: 0 });
  const services: IpcServices = {
    windows: windows as never,
    appStore: store,
    vaultSession: session,
    fs,
    ai,
    agent: {} as never,
    git,
    binaryEditors: new BinaryEditorHostManager(),
    dialogs: { pickDirectory: async () => null, pickFile: async () => null },
    plugins: new PluginService({ hostVersion: '0.1.0' }),
    skills: new SkillService({
      retrieve: async () => ({
        query: '',
        degraded: false,
        model: null,
        contextText: '',
        sources: [],
        stages: [],
      }),
    }),
    trash: async () => {},
    revealItem: async (absPath: string) => {
      reveals.push(absPath);
    },
    watch: new VaultWatchService({ getRoot: () => null, emit: () => undefined }),
    index: new LinkIndexService(),
    settings: new SettingsService(path.join(tmp, 'settings.json')),
    vaultOperations: new VaultOperationsController(),
    vaultClones: new VaultCloneController(),
    appInfo: () => ({
      version: '0.1.0',
      platform: 'test',
      arch: 'test',
      isPackaged: false,
      electronVersion: 'test',
    }),
    checkForUpdates: async () => ({
      status: 'not-configured' as const,
      channel: 'stable' as const,
    }),
    downloadUpdate: async () => ({ status: 'not-configured' as const, channel: 'stable' as const }),
    installUpdate: async () => ({
      willRestart: true,
      action: 'install-started' as const,
      arch: 'test',
    }),
    setUpdateChannel: (channel) => ({ status: 'not-configured' as const, channel }),
    getUpdateSettings: () => ({
      channel: 'stable' as const,
      autoDownload: true,
      checkOnLaunch: true,
    }),
    setUpdateSettings: (patch) => ({
      channel: 'stable' as const,
      autoDownload: true,
      checkOnLaunch: true,
      ...patch,
    }),
  };
  return { services, session, store, reveals };
}

describe('IPC 注册表框架', () => {
  it('契约中的全部通道都能被注册（无遗漏/无重复）', () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    const registrar = registerAllIpcHandlers(ipc, services);
    expect(registrar.registeredChannels().sort()).toEqual([...IPC_CHANNELS].sort());
    expect(registrar.registeredChannels()).not.toContain('ai:credential:retrieve');
  });

  it('翻译默认语言 IPC 通过主进程持久化并拒绝非法值', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);

    const saved = (await ipc.invoke('ai:translation:setTargetLanguage', {
      targetLanguage: '日本語',
    })) as { ok: boolean; data: { state: { translationTargetLanguage?: string } } };
    expect(saved).toMatchObject({
      ok: true,
      data: { state: { translationTargetLanguage: '日本語' } },
    });
    expect(services.ai.getState().translationTargetLanguage).toBe('日本語');

    for (const targetLanguage of ['', '<script>', 'x'.repeat(41)]) {
      const rejected = (await ipc.invoke('ai:translation:setTargetLanguage', {
        targetLanguage,
      })) as { ok: boolean; code?: string };
      expect(rejected).toMatchObject({ ok: false, code: 'IPC_PAYLOAD_INVALID' });
    }
  });

  it('Git doctor 四个通道注册，malformed payload 稳定拒绝，未初始化返回 NO_VAULT', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    const registrar = registerAllIpcHandlers(ipc, services);
    expect(registrar.registeredChannels()).toEqual(
      expect.arrayContaining([
        'git:doctor:diagnose',
        'git:doctor:repairPrepare',
        'git:doctor:repairExecute',
        'git:doctor:dismiss',
      ]),
    );
    for (const [channel, payload] of [
      ['git:doctor:repairPrepare', { action: 1 }],
      ['git:doctor:repairExecute', { ticket: null }],
    ] as const) {
      const result = (await ipc.invoke(channel, payload)) as { ok: boolean; code?: string };
      expect(result).toMatchObject({ ok: false, code: 'IPC_PAYLOAD_INVALID' });
    }
    const result = (await ipc.invoke('git:doctor:diagnose')) as { ok: boolean; code?: string };
    expect(result).toMatchObject({ ok: false, code: 'NO_VAULT' });
    const dismissed = (await ipc.invoke('git:doctor:dismiss')) as { ok: boolean; code?: string };
    expect(dismissed).toMatchObject({ ok: false, code: 'NO_VAULT' });
  });

  it('git:doctor:repairExecute 的原始 statusFor 异常不会经 IPC 泄漏', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const execute = vi.fn(async () => {
      throw new Error('fatal: Authorization: Bearer sk-live-abcdef123');
    });
    (services as { gitDoctor?: unknown }).gitDoctor = { execute } as never;
    const result = (await ipc.invoke('git:doctor:repairExecute', { ticket: 't-1' })) as {
      ok: boolean;
      code?: string;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('sk-live-abcdef123');
    expect(result.error).toBeTypeOf('string');
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

  it('IPC 错误信封会脱敏代理 URL 中的账号和密码', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    const registrar = createIpcRegistrar(ipc, services);
    registrar.register('fs:readTextFile', async () => {
      throw new Error('request via http://proxy-user:proxy-secret@proxy.local:8080 failed');
    });

    const result = (await ipc.invoke('fs:readTextFile', { path: 'x' })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('proxy-user');
    expect(result.error).not.toContain('proxy-secret');
    expect(result.error).toContain('http://***@proxy.local:8080');
  });

  it('index 查询通道接受契约声明的 payload', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    try {
      await writeFile(path.join(tmp, 'a.md'), '# A\n\n[[b]]\n', 'utf8');
      services.index.setRoot(tmp);

      const tags = await ipc.invoke('index:tags', { flat: true });
      expect(tags).toMatchObject({ ok: true });
      const search = await ipc.invoke('index:search', { query: 'A', limit: 5 });
      expect(search).toMatchObject({ ok: true });
      const jump = await ipc.invoke('index:jumpTo', { query: 'A' });
      expect(jump).toMatchObject({ ok: true });
      const tagPages = await ipc.invoke('index:tagPages', { tag: 'missing' });
      expect(tagPages).toMatchObject({ ok: true });
      const backlinks = await ipc.invoke('index:backlinks', { pagePath: 'b.md' });
      expect(backlinks).toMatchObject({ ok: true });
      const summary = (await ipc.invoke('index:pageSummary', { path: 'a.md' })) as {
        ok: boolean;
        data: { pageId: number } | null;
      };
      expect(summary.ok).toBe(true);
      expect(summary.data?.pageId).toBeGreaterThan(0);
      const confidence = await ipc.invoke('index:confidence', { pageId: summary.data!.pageId });
      expect(confidence).toMatchObject({ ok: true, data: null });
    } finally {
      // The index holds an open SQLite handle; Windows cannot unlink it during tmp cleanup.
      services.index.close();
    }
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
      initGit: true,
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
        tabOrder: ['kind:welcome', 'a.md', 'kind:graph'],
      },
    })) as { ok: boolean };
    expect(saved.ok).toBe(true);
    const layout = (await ipc.invoke('vault:getLayout')) as {
      ok: boolean;
      data: { sidebarWidth: number; dockWidth: number; tabOrder: string[] };
    };
    expect(layout.data.sidebarWidth).toBe(300);
    expect(layout.data.dockWidth).toBe(320);
    // DEV-022：页签顺序随布局持久化往返
    expect(layout.data.tabOrder).toEqual(['kind:welcome', 'a.md', 'kind:graph']);

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

  it('vault:create initGit=false 也安全写入同步护栏模板', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);

    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'no-git-vault',
      initGit: false,
    })) as { ok: boolean; data: { root: string } };

    expect(created.ok).toBe(true);
    expect(await readFile(path.join(created.data.root, '.gitignore'), 'utf8')).toContain(
      '.nexnote/',
    );
    expect(await services.git.isRepository(created.data.root)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'startup restore 护栏失败会回滚 session，后续查询不能跳过修复进入 ready',
    async () => {
      const ipc = new FakeIpcMain();
      const { services, session, store } = makeServices();
      const vault = path.join(tmp, 'restore-vault');
      const outside = path.join(tmp, 'outside-ignore');
      await mkdir(vault);
      const git = simpleGit({ baseDir: vault, binary: process.env.NEXNOTE_TEST_GIT ?? 'git' });
      await git.init();
      await git.addConfig('user.name', 'NexNote');
      await git.addConfig('user.email', 'noreply@nexnote.local');
      await writeFile(path.join(vault, 'page.md'), 'page');
      await git.add(['page.md']);
      await git.commit('base');
      await writeFile(outside, 'outside');
      await symlink(outside, path.join(vault, '.gitignore'));
      store.setLastVault(vault);
      registerAllIpcHandlers(ipc, services);

      const first = (await ipc.invoke('vault:getState')) as { ok: boolean; code?: string };
      expect(first.ok).toBe(false);
      expect(session.getCurrent()).toBeNull();
      expect(store.get().lastVaultPath).toBeNull();
      expect(await readFile(outside, 'utf8')).toBe('outside');

      const second = (await ipc.invoke('vault:getState')) as {
        ok: boolean;
        data?: { mode: string };
      };
      expect(second).toMatchObject({ ok: true, data: { mode: 'onboarding' } });
      expect(session.getCurrent()).toBeNull();
    },
  );

  it('restore guard 异步等待期间并发 getState 不能看见未验证的 vault', async () => {
    const ipc = new FakeIpcMain();
    const { services, session } = makeServices();
    const vault = path.join(tmp, 'pending-vault');
    await mkdir(vault);
    const git = simpleGit({ baseDir: vault, binary: process.env.NEXNOTE_TEST_GIT ?? 'git' });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await writeFile(path.join(vault, 'page.md'), 'page');
    await git.add(['page.md']);
    await git.commit('base');

    let resolveGuard: () => void = () => undefined;
    const guardGate = new Promise<void>((resolve) => {
      resolveGuard = resolve;
    });
    const realEnsure = services.git.ensureSyncGuard.bind(services.git);
    vi.spyOn(services.git, 'ensureSyncGuard').mockImplementation(async (root: string) => {
      await guardGate;
      return realEnsure(root);
    });
    services.appStore.setLastVault(vault);
    registerAllIpcHandlers(ipc, services);

    const reentrant = ipc.invoke('vault:getState');
    await new Promise((r) => setTimeout(r, 20));
    expect(session.getCurrent()).toBeNull();

    let secondSettled = false;
    const second = ipc.invoke('vault:getState').finally(() => {
      secondSettled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(secondSettled).toBe(false);
    expect(session.getCurrent()).toBeNull();

    resolveGuard();
    const [first, concurrent] = (await Promise.all([reentrant, second])) as Array<{
      ok: boolean;
      data?: { mode: string };
    }>;
    expect(first).toMatchObject({ ok: true, data: { mode: 'ready' } });
    expect(concurrent).toMatchObject({ ok: true, data: { mode: 'ready' } });
    expect(session.getCurrent()?.root).toBe(vault);
  });

  it('vault:reveal 解析 vault 内路径并调用系统文件管理器', async () => {
    const ipc = new FakeIpcMain();
    const { services, reveals } = makeServices();
    registerAllIpcHandlers(ipc, services);
    await ipc.invoke('vault:initGit', { path: tmp });
    await ipc.invoke('vault:open', { path: tmp });
    const result = (await ipc.invoke('vault:reveal', { path: 'nested/note.md' })) as {
      ok: boolean;
    };
    expect(result.ok).toBe(true);
    expect(reveals).toEqual([path.join(tmp, 'nested/note.md')]);
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
      initGit: true,
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

  it('所有写操作路径都会安排自动提交（DEV-083：vault:saveLayout 不再触发）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    await ipc.invoke('vault:create', { parentDir: tmp, name: 'all-mutations', initGit: true });
    const git = services.git as unknown as { autoTimer: ReturnType<typeof setTimeout> | null };

    await ipc.invoke('fs:createNote', { parentDir: '', name: 'One' });
    expect(git.autoTimer).not.toBeNull();
    services.git.cancelAutoCommit();

    await ipc.invoke('fs:renameLinked', { from: 'One.md', to: 'Two.md' });
    expect(git.autoTimer).not.toBeNull();
    services.git.cancelAutoCommit();

    // DEV-083/ADR-0016：layout 仅本地保留，vault:saveLayout 不再 scheduleAutoCommit。
    await ipc.invoke('vault:saveLayout', {
      layout: {
        sidebarWidth: 300,
        sidebarCollapsed: false,
        activeSidebarPanelId: null,
        dockVisible: true,
        dockWidth: 320,
      },
    });
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
      initGit: true,
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
    const autoDeadline = Date.now() + 3_000;
    let afterAuto = win.sent.filter((e) => e.channel === 'git:statusChanged').length;
    while (Date.now() < autoDeadline && afterAuto <= afterWrite) {
      await new Promise((r) => setTimeout(r, 50));
      afterAuto = win.sent.filter((e) => e.channel === 'git:statusChanged').length;
    }
    expect(afterAuto).toBeGreaterThan(afterWrite);

    // 手动提交 → 再次发送
    await ipc.invoke('git:commit', { message: '手动提交' });
    const afterManual = win.sent.filter((e) => e.channel === 'git:statusChanged').length;
    expect(afterManual).toBeGreaterThan(afterAuto);
  });

  it('命名空间 ping 通道可用（editor/ai/plugins/skills + git 真实通道）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    for (const ns of ['editor', 'ai', 'plugins', 'skills']) {
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
      initGit: true,
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
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'debounce-vault',
      initGit: true,
    })) as { ok: boolean };
    expect(created.ok).toBe(true);

    const initial = (await ipc.invoke('git:getAutoCommitDebounce')) as {
      ok: boolean;
      data: { milliseconds: number };
    };
    expect(initial.data.milliseconds).toBe(30_000);

    const clamped = (await ipc.invoke('git:setAutoCommitDebounce', {
      milliseconds: 1,
    })) as { ok: boolean; data: { milliseconds: number } };
    expect(clamped.ok).toBe(true);
    // vault config clamp 到 2000ms（vault 设置范围），GitService 取该值
    expect(clamped.data.milliseconds).toBe(2_000);
    expect(services.git.getDebounceMs()).toBe(2_000);
    const vaultSettings = (await ipc.invoke('settings:getVault')) as {
      ok: boolean;
      data: { git: { autoCommitIntervalMs: number } };
    };
    expect(vaultSettings.data.git.autoCommitIntervalMs).toBe(2_000);

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
      ['git:getTimeline', { limit: 1.5 }, 'git:getTimeline 非整数 limit'],
      ['git:getTimeline', { limit: 0 }, 'git:getTimeline 越界 limit'],
      ['git:getTimeline', { limit: 501 }, 'git:getTimeline 上界 limit'],
      ['git:setUseSystemGit', { enabled: 'true' }, 'git:setUseSystemGit 字符串'],
      ['vault:create', { parentDir: tmp }, 'vault:create 缺 name'],
      ['vault:create', { parentDir: tmp, name: 'x', evil: true }, 'vault:create 多余字段'],
      ['vault:saveLayout', { layout: 'oops' }, 'vault:saveLayout 错误 layout'],
      ['vault:saveLayout', { layout: { sidebarWidth: 'wide' } }, 'vault:saveLayout 嵌套字段错误'],
      ['vault:saveLayout', { layout: { unknown: true } }, 'vault:saveLayout 嵌套未知字段'],
      ['vault:saveLayout', { layout: { treeCollapsedDirs: [1] } }, 'vault:saveLayout 嵌套数组错误'],
      ['vault:saveLayout', { layout: { tabOrder: [1] } }, 'vault:saveLayout tabOrder 非字符串数组'],
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

  it('clone preflight token 可被相同 canonical target 消费，改变目标仍失败', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const url = 'https://example.invalid/owner/repo.git';
    const parentDir = await mkdtemp(path.join(tmpdir(), 'nexnote-clone-token-'));
    const status = {
      repository: true,
      branch: 'trunk',
      changed: 1,
      ahead: 2,
      behind: 3,
      remote: 'origin',
      usingSystemGit: true,
      conflict: false,
      rebaseInProgress: false,
    };
    vi.spyOn(services.git, 'lsRemote').mockResolvedValue();
    vi.spyOn(services.git, 'cloneInto').mockImplementation(async (_url, temporaryParent, name) => {
      await import('node:fs/promises').then(({ mkdir }) =>
        mkdir(path.join(temporaryParent, name), { recursive: true }),
      );
      return { message: '克隆完成', status };
    });
    const ensureSyncGuard = vi.spyOn(services.git, 'ensureSyncGuard').mockResolvedValue();
    vi.spyOn(services.git, 'status').mockResolvedValue(status);
    try {
      const preflight = (await ipc.invoke('vault:clonePreflight', {
        url,
        parentDir,
        name: 'repo',
      })) as { ok: boolean; data: { reachable: boolean; preflightToken?: string } };
      expect(preflight).toMatchObject({ ok: true, data: { reachable: true } });

      const cloned = (await ipc.invoke('vault:clone', {
        url,
        parentDir,
        name: 'repo',
        preflightToken: preflight.data.preflightToken,
      })) as { ok: boolean; data: { status: typeof status } };
      expect(cloned.ok).toBe(true);
      expect(cloned.data.status).toEqual(status);
      expect(ensureSyncGuard).toHaveBeenCalledWith(path.join(parentDir, 'repo'));

      const secondPreflight = (await ipc.invoke('vault:clonePreflight', {
        url,
        parentDir,
        name: 'repo-two',
      })) as { ok: boolean; data: { preflightToken?: string } };
      const mismatch = (await ipc.invoke('vault:clone', {
        url,
        parentDir,
        name: 'different-target',
        preflightToken: secondPreflight.data.preflightToken,
      })) as { ok: boolean; code?: string };
      expect(mismatch).toMatchObject({ ok: false, code: 'CLONE_TOKEN_INVALID' });
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it('vault:cancelOperation 对未知 operationId 明确报错', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const result = (await ipc.invoke('vault:cancelOperation', {
      operationId: 'does-not-exist',
    })) as { ok: boolean; code?: string };
    expect(result).toMatchObject({ ok: false, code: 'OPERATION_NOT_FOUND' });
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

  it('git:pull accepts the renderer default empty object payload', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'pull-default',
      initGit: true,
    })) as {
      ok: boolean;
    };
    expect(created.ok).toBe(true);

    const result = (await ipc.invoke('git:pull', {})) as { ok: boolean; code?: string };
    // No remote is expected, but the renderer's `{}` must pass validation and reach Git.
    expect(result.code).toBe('NO_REMOTE');
  });

  it('binary:gitignore:set 停止跟踪已提交原件并保留 CRLF 用户规则', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'binary-ignore',
      initGit: true,
    })) as { ok: boolean; data: { root: string } };
    expect(created.ok).toBe(true);
    const root = created.data.root;
    const git = simpleGit({ baseDir: root });
    await writeFile(path.join(root, 'tracked.docx'), 'original');
    await git.add(['tracked.docx']);
    await git.commit('track docx');
    await writeFile(path.join(root, '.gitignore'), '# user\r\nsecret.txt\r\n');

    const enabled = (await ipc.invoke('binary:gitignore:set', { untrack: true })) as {
      ok: boolean;
      data: { untracked: boolean; removedFromIndex: number };
    };
    expect(enabled).toMatchObject({ ok: true, data: { untracked: true, removedFromIndex: 1 } });
    expect((await git.raw(['ls-files', '-z'])).split('\0')).not.toContain('tracked.docx');
    expect(await readFile(path.join(root, 'tracked.docx'), 'utf8')).toBe('original');
    const ignore = await readFile(path.join(root, '.gitignore'), 'utf8');
    expect(ignore).toContain('# user\r\nsecret.txt\r\n');
    expect(ignore).toContain('*.docx\r\n*.xlsx\r\n*.xmind\r\n');

    const disabled = (await ipc.invoke('binary:gitignore:set', { untrack: false })) as {
      ok: boolean;
      data: { untracked: boolean; removedFromIndex: number };
    };
    expect(disabled).toMatchObject({ ok: true, data: { untracked: false, removedFromIndex: 0 } });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('# user\r\nsecret.txt\r\n');
    services.git.cancelAutoCommit();
  });

  it('git:pull 在工作区 dirty 时拒绝（除非显式 force）', async () => {
    const ipc = new FakeIpcMain();
    const { services } = makeServices();
    registerAllIpcHandlers(ipc, services);
    const created = (await ipc.invoke('vault:create', {
      parentDir: tmp,
      name: 'dirty-pull',
      initGit: true,
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
