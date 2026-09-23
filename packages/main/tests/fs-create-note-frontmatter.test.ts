import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAllIpcHandlers } from '../src/ipc';
import { __resetVaultStateRestore } from '../src/ipc/vault-handlers';
import type { IpcMainLike } from '../src/ipc/registrar';
import { AppStore } from '../src/vault/app-store';
import { VaultSession } from '../src/vault/vault-session';
import { VaultFsService } from '../src/fs/fs-service';
import { VaultWatchService } from '../src/fs/watch-service';
import { PluginService } from '../src/plugins/plugin-service';
import { SkillService } from '../src/skills/skill-service';
import { GitService } from '../src/git/git-service';
import { LinkIndexService } from '../src/indexer/index-service';
import type { IpcServices } from '../src/ipc/services';
import { AiStore } from '../src/ai/ai-store';
import { AiService } from '../src/ai/ai-service';
import type { SecretVault } from '../src/ai/secret-store';
import { SettingsService } from '../src/settings/settings-service';
import { VaultOperationsController } from '../src/vault/vault-operations-controller';
import { VaultCloneController } from '../src/vault/vault-clone-controller';

/** DEV-077 smoke 回归：fs:createNote 在 content 已含 frontmatter 时不应叠加 created。 */

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
    if (!h) throw new Error(`no handler: ${channel}`);
    return Promise.resolve(h(undefined, payload));
  }
}

class FakeWindows {
  sendToMainWindow(): void {}
}

let tmp: string;

beforeEach(async () => {
  vi.stubEnv('GIT_EDITOR', undefined);
  __resetVaultStateRestore();
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-fm-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function makeServices(): { services: IpcServices; session: VaultSession } {
  const store = new AppStore(path.join(tmp, 'store.json'));
  const windows = new FakeWindows();
  const session = new VaultSession({ appStore: store, windows: windows as never });
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
    dialogs: { pickDirectory: async () => null, pickFile: async () => null },
    plugins: new PluginService({ hostVersion: '0.1.0' }),
    skills: new SkillService({
      retrieve: async () => ({ query: '', degraded: false, model: null, contextText: '', sources: [], stages: [] }),
    }),
    trash: async () => {},
    revealItem: async () => {},
    watch: new VaultWatchService({ getRoot: () => null, emit: () => undefined }),
    index: new LinkIndexService(),
    settings: new SettingsService(path.join(tmp, 'settings.json')),
    vaultOperations: new VaultOperationsController(),
    vaultClones: new VaultCloneController(),
    appInfo: () => ({ version: '0.1.0', platform: 'test', arch: 'test', isPackaged: false, electronVersion: 'test' }),
    checkForUpdates: async () => ({ status: 'not-configured' as const, channel: 'stable' as const }),
    downloadUpdate: async () => ({ status: 'not-configured' as const, channel: 'stable' as const }),
    installUpdate: async () => ({ willRestart: true, action: 'install-started' as const, arch: 'test' }),
    setUpdateChannel: () => ({ status: 'not-configured' as const, channel: 'stable' as const }),
    getUpdateSettings: () => ({ channel: 'stable' as const, autoDownload: true, checkOnLaunch: true }),
    setUpdateSettings: (patch) => ({ channel: 'stable' as const, autoDownload: true, checkOnLaunch: true, ...patch }),
  };
  return { services, session };
}

describe('fs:createNote frontmatter 保护（DEV-077）', () => {
  it('content 已含 frontmatter 时不注入 created，原 YAML 头完整保留', async () => {
    const ipc = new FakeIpcMain();
    const { services, session } = makeServices();
    registerAllIpcHandlers(ipc, services);
    await session.open(tmp);

    const raw = '---\ntitle: 已带头\n---\n\n# 正文\n';
    const result = (await ipc.invoke('fs:createNote', {
      parentDir: '',
      name: 'preheaded',
      content: raw,
      format: 'markdown',
    })) as { ok: true; data: { path: string } };
    expect(result.ok).toBe(true);

    const onDisk = await readFile(path.join(tmp, 'preheaded.md'), 'utf8');
    // 只有一个 YAML 头（两行 ---），且包含 title；不应出现 created。
    const fenceCount = (onDisk.match(/^---$/gm) ?? []).length;
    expect(fenceCount).toBe(2);
    expect(onDisk).toContain('title: 已带头');
    expect(onDisk).not.toContain('created:');
  });

  it('content 不含 frontmatter 时仍正常注入 created（无回归）', async () => {
    const ipc = new FakeIpcMain();
    const { services, session } = makeServices();
    registerAllIpcHandlers(ipc, services);
    await session.open(tmp);

    const result = (await ipc.invoke('fs:createNote', {
      parentDir: '',
      name: 'plain',
      content: '# plain\n',
      format: 'native-block',
    })) as { ok: true; data: { path: string } };
    expect(result.ok).toBe(true);

    const onDisk = await readFile(path.join(tmp, 'plain.md'), 'utf8');
    expect(onDisk).toMatch(/^---\ncreated: .+\n---\n/);
  });
});