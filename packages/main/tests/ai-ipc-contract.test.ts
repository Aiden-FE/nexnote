import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerAllIpcHandlers } from '../src/ipc';
import type { IpcMainLike, IpcServices } from '../src/ipc';
import { AiStore } from '../src/ai/ai-store';
import { AiService } from '../src/ai/ai-service';
import type { SecretVault } from '../src/ai/secret-store';
import { startMockOpenAiServer, type MockOpenAiServer } from './helpers/mock-openai';
import type { Result } from '@nexnote/shared';

/**
 * 密钥不经过渲染层的 IPC 契约测试：
 * - 全部 ai:* 通道的响应 payload 与推送事件 payload 均不含密钥明文
 * - Profile 视图对象无任何密钥字段
 * - 落盘文件只含加密 blob
 */

const SECRET = 'sk-contract-secret-do-not-leak';

class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  invoke(channel: string, payload?: unknown): Promise<unknown> {
    const h = this.handlers.get(channel);
    if (!h) return Promise.resolve({ ok: false, error: `no handler: ${channel}` } satisfies Result<never>);
    return Promise.resolve(h(undefined, payload));
  }
}

const rot = (s: string): string =>
  s.replace(/[a-zA-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) + 13 - (c <= 'Z' ? 65 : 97)) % 26) + (c <= 'Z' ? 65 : 97)));

function fakeSafeStorageVault(): SecretVault {
  return {
    available: true,
    encrypt: (p) => `enc:v1:${btoa(rot(p))}`,
    decrypt: (b) => rot(atob(b.slice('enc:v1:'.length))),
  };
}

let mock: MockOpenAiServer;
let tmp: string;
let ipc: FakeIpcMain;
let sentEvents: Array<{ channel: string; payload: unknown }>;

beforeAll(async () => {
  mock = await startMockOpenAiServer();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-ai-ipc-test-'));
  sentEvents = [];
  ipc = new FakeIpcMain();

  const store = new AiStore(path.join(tmp, 'ai.json'), fakeSafeStorageVault());
  const ai = new AiService({
    store,
    sendEvent: (channel, payload) => sentEvents.push({ channel, payload }),
  });

  const services = {
    windows: { sendToMainWindow: () => undefined },
    appStore: {},
    vaultSession: {},
    fs: {},
    ai,
    dialogs: { pickDirectory: async () => null },
    trash: async () => {},
    appInfo: () => ({}),
    checkForUpdates: async () => ({ status: 'not-configured' as const }),
  } as unknown as IpcServices;

  registerAllIpcHandlers(ipc, services);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const res = (await ipc.invoke(channel, payload)) as Result<T>;
  if (!res.ok) throw new Error(`${channel} 失败: ${res.error}`);
  return res.data;
}

describe('密钥安全 IPC 契约（密钥永不经过渲染层）', () => {
  it('创建 Profile → testConnection → 全通道响应与事件 payload 无密钥明文', async () => {
    // 1. 保存（密钥一次性流入主进程）
    const saved = await call<{ id: string; state: unknown }>('ai:profile:save', {
      profile: {
        name: '契约测试网关',
        kind: 'openai-compatible',
        baseUrl: `${mock.url}/v1`,
        defaultModel: 'gpt-4o-mini',
        apiKey: SECRET,
      },
    });

    // 2. 连通性测试（主进程解密密钥直连供应商）
    const conn = await call<{ reachable: boolean }>('ai:testConnection', { profileId: saved.id });
    expect(conn.reachable).toBe(true);
    expect(mock.requests.some((r) => r.headers['authorization'] === `Bearer ${SECRET}`)).toBe(true);

    // 3. 流式 + embed 走全链路（产生事件推送）
    await call('ai:chat:stream:start', {
      profileId: saved.id,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const embed = await call<{ dimensions: number; vectors: number[][] }>('ai:embed', {
      texts: ['契约测试'],
    });
    expect(embed.dimensions).toBe(1536);

    // 等待流事件推送完成
    await new Promise((r) => setTimeout(r, 300));

    // 4. 全部响应通道逐一调用，收集 payload
    const payloads: unknown[] = [];
    payloads.push(await call('ai:getState'));
    payloads.push(await call('ai:listModels', { profileId: saved.id }));
    payloads.push(await call('ai:export'));
    payloads.push(sentEvents);

    // 5. 契约断言：任何经 IPC 送达渲染层的数据都不含密钥明文
    for (const p of payloads) {
      expect(JSON.stringify(p)).not.toContain(SECRET);
    }
  });

  it('Profile 视图对象无密钥字段（结构级保证）', async () => {
    const saved = await call<{ state: { profiles: Array<Record<string, unknown>> } }>('ai:profile:save', {
      profile: {
        name: '结构检查',
        kind: 'openai-compatible',
        baseUrl: `${mock.url}/v1`,
        defaultModel: 'm',
        apiKey: SECRET,
      },
    });
    const view = saved.state.profiles[0]!;
    expect(view.hasApiKey).toBe(true);
    for (const key of Object.keys(view)) {
      expect(key.toLowerCase()).not.toMatch(/^(api[-_]?key|key|secret|password|token)$/);
    }
    expect(view.hasApiKey).toBe(true); // 唯一密钥相关信息是布尔标记
  });

  it('磁盘存储只含加密 blob（无明文密钥）', async () => {
    const saved = await call<{ id: string }>('ai:profile:save', {
      profile: {
        name: '磁盘检查',
        kind: 'openai-compatible',
        baseUrl: `${mock.url}/v1`,
        defaultModel: 'm',
        apiKey: SECRET,
      },
    });
    expect(saved.id).toBeTruthy();
    const raw = await readFile(path.join(tmp, 'ai.json'), 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain('enc:v1:');
  });

  it('错误路径也不泄漏密钥（坏密钥的 testConnection 错误信息无密钥）', async () => {
    mock.failNextChatWith = 401;
    const conn = await call<{ reachable: boolean; error?: string }>('ai:testConnection', {
      candidate: { kind: 'openai-compatible', baseUrl: `${mock.url}/v1`, apiKey: SECRET },
    });
    expect(JSON.stringify(conn)).not.toContain(SECRET);
    expect(mock.requests.some((r) => r.headers['authorization'] === `Bearer ${SECRET}`)).toBe(true);
  });
});
