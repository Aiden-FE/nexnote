import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockOpenAiServer, type MockOpenAiServer } from './helpers/mock-openai';
import { AiStore } from '../src/ai/ai-store';
import { AiService, splitEmbedBatches } from '../src/ai/ai-service';
import type { SecretVault } from '../src/ai/secret-store';
import type { AiConfigState, ChatStreamEvent, IpcEventChannel, IpcEventMap } from '@nexnote/shared';

let mock: MockOpenAiServer;
let tmp: string;

beforeAll(async () => {
  mock = await startMockOpenAiServer();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-ai-service-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  mock.requests.length = 0;
});

function fakeVault(): SecretVault {
  const credentials = new Map<string, string>();
  return {
    available: true,
    put: (account, secret) => void credentials.set(account, secret),
    get: (account) => credentials.get(account) ?? null,
    delete: (account) => void credentials.delete(account),
  };
}

type SentEvent = { channel: IpcEventChannel; payload: IpcEventMap[IpcEventChannel] };

function makeService(): { service: AiService; sent: SentEvent[]; store: AiStore } {
  const sent: SentEvent[] = [];
  const store = new AiStore(path.join(tmp, 'ai.json'), fakeVault());
  const service = new AiService({
    store,
    sendEvent: (channel, payload) => sent.push({ channel, payload }),
  });
  return { service, sent, store };
}

function saveMockProfile(service: AiService, overrides: Record<string, unknown> = {}): string {
  const input = {
    name: 'Mock 网关',
    kind: 'openai-compatible' as const,
    baseUrl: `${mock.url}/v1`,
    defaultModel: 'gpt-4o-mini',
    ...overrides,
  };
  const credentialToken = service.submitCredential('sk-service-secret-xyz', input.baseUrl);
  const { id } = service.saveProfile(undefined, { ...input, credentialToken });
  return id;
}

describe('AiService', () => {
  it('未配置时 chat/embed 抛 AI_NOT_CONFIGURED（降级路径入口）', async () => {
    const { service } = makeService();
    await expect(
      service.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    await expect(service.embed(['hi'])).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(service.getState().needsOnboarding).toBe(true);
  });

  it('local-only setup supports embedding but has no usable chat default', async () => {
    const { service } = makeService();
    const local = service.saveProfile(undefined, {
      name: 'Local vectors',
      kind: 'local-embedding',
      baseUrl: 'local://embedding',
      defaultModel: 'local-hash-384',
    });
    service.setFeatureAssignment('embedding', {
      profileId: local.id,
      model: 'local-hash-384',
      dimensions: 384,
    });

    expect(service.getState().needsOnboarding).toBe(false);
    expect(service.getState().defaultProfileId).toBeNull();
    await expect(
      service.chatCompletion({ feature: 'chat', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    const embedded = await service.embed(['hello']);
    expect(embedded[0]).toHaveLength(384);
  });

  it('Profile 解析优先级：显式 profileId > feature > 全局默认', async () => {
    const { service } = makeService();
    const a = saveMockProfile(service, { name: 'A' });
    const b = saveMockProfile(service, { name: 'B', defaultModel: 'gpt-4o' });
    service.setDefaultProfile(a);
    service.setFeatureAssignment('chat', { profileId: b, model: 'gpt-4o' });

    // 默认 → A 的模型
    await service.chatCompletion({ messages: [{ role: 'user', content: 'x' }] });
    expect((mock.requests.at(-1)?.body as { model?: string })?.model).toBe('gpt-4o-mini');
    // feature=chat → B + feature 模型
    await service.chatCompletion({ feature: 'chat', messages: [{ role: 'user', content: 'x' }] });
    expect((mock.requests.at(-1)?.body as { model?: string })?.model).toBe('gpt-4o');
    // 显式 profileId 覆盖 feature
    await service.chatCompletion({
      feature: 'chat',
      profileId: a,
      messages: [{ role: 'user', content: 'x' }],
    });
    expect((mock.requests.at(-1)?.body as { model?: string })?.model).toBe('gpt-4o-mini');
    expect(a).not.toBe(b);
  });

  it('testConnection：candidate 直测（向导场景）+ capabilities 实测', async () => {
    const { service } = makeService();
    const credentialToken = service.submitCredential('sk-cand', `${mock.url}/v1`);
    const result = await service.testConnection({
      candidate: { kind: 'openai-compatible', baseUrl: `${mock.url}/v1`, credentialToken },
    });
    expect(result.reachable).toBe(true);
    expect(result.capabilities.chat).toBe(true);
    expect(result.capabilities.streaming).toBe(true);
    expect(result.capabilities.embeddings).toBe(true);
    expect(result.models).toContain('text-embedding-3-small');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    // 密钥以 Bearer 发往供应商（主进程网络栈）
    expect(mock.requests.some((r) => r.headers['authorization'] === 'Bearer sk-cand')).toBe(true);
  });

  it('testConnection：已保存 Profile（主进程解密密钥）', async () => {
    const { service } = makeService();
    const id = saveMockProfile(service);
    const result = await service.testConnection({ profileId: id });
    expect(result.reachable).toBe(true);
    expect(
      mock.requests.some((r) => r.headers['authorization'] === 'Bearer sk-service-secret-xyz'),
    ).toBe(true);
  });

  it('testConnection：编辑候选使用当前 baseUrl/defaultModel，并在主进程复用已存密钥', async () => {
    const { service } = makeService();
    const id = saveMockProfile(service);
    mock.requests.length = 0;
    const result = await service.testConnection({
      profileId: id,
      candidate: {
        kind: 'openai-compatible',
        baseUrl: `${mock.url}/v1`,
        defaultModel: 'gpt-4o',
      },
    });
    expect(result.reachable).toBe(true);
    expect(
      mock.requests.some((r) => r.headers['authorization'] === 'Bearer sk-service-secret-xyz'),
    ).toBe(true);
    expect(
      mock.requests.some((r) => (r.body as { model?: string } | null)?.model === 'gpt-4o'),
    ).toBe(true);
  });

  it('编辑 candidate URL 时绝不把已保存密钥发送到新 origin', async () => {
    const { service } = makeService();
    const id = saveMockProfile(service);
    mock.requests.length = 0;

    await service.testConnection({
      profileId: id,
      candidate: {
        kind: 'openai-compatible',
        baseUrl: `${mock.url}/different-v1`,
        defaultModel: 'gpt-4o-mini',
      },
    });

    expect(
      mock.requests.some(
        (request) => request.headers.authorization === 'Bearer sk-service-secret-xyz',
      ),
    ).toBe(false);
  });

  it('testConnection：不可达端点 reachable=false + 错误信息', async () => {
    const { service } = makeService();
    const result = await service.testConnection({
      candidate: {
        kind: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:1/v1',
        credentialToken: service.submitCredential('k', 'http://127.0.0.1:1/v1'),
      },
    });
    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.capabilities.chat).toBe(false);
  });

  it('credential tokens reject a different provider origin', async () => {
    const { service } = makeService();
    const token = service.submitCredential('sk-bound', `${mock.url}/v1`);
    await expect(
      service.listModels({
        candidate: {
          kind: 'openai-compatible',
          baseUrl: 'https://other.example.com/v1',
          credentialToken: token,
        },
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_SCOPE_MISMATCH' });
    expect(() => service.saveProfile(undefined, {
      name: 'Wrong operation',
      kind: 'openai-compatible',
      baseUrl: 'https://saved.example.com/v1',
      defaultModel: 'gpt-4o-mini',
      credentialToken: token,
    })).toThrow(/凭据目标不一致/);
  });

  it('authenticated provider requests never follow redirects', async () => {
    const { service } = makeService();
    const id = saveMockProfile(service);
    mock.redirectNextModels = true;
    try {
      await expect(service.listModels({ profileId: id })).rejects.toThrow('网络请求失败');
    } finally {
      mock.redirectNextModels = false;
    }
    expect(mock.requests.filter((request) => request.url === '/v1/models')).toHaveLength(1);
    expect(mock.requests.filter((request) => request.url === '/attacker/models')).toHaveLength(0);
  });

  it('系统凭据不可用时 candidate testConnection 仍可跑（不经过 store）', async () => {
    const { UnavailableSecretVault } = await import('../src/ai/secret-store');
    const sent: SentEvent[] = [];
    const store = new AiStore(path.join(tmp, 'ai-unavail.json'), new UnavailableSecretVault());
    const service = new AiService({
      store,
      sendEvent: (channel, payload) => sent.push({ channel, payload }),
    });
    // candidate 测试路径不碰 store/vault，密钥只在一次请求的内存中存在
    const result = await service.testConnection({
      candidate: {
        kind: 'openai-compatible',
        baseUrl: `${mock.url}/v1`,
        credentialToken: service.submitCredential('sk-temp-cand', `${mock.url}/v1`),
      },
    });
    expect(result.reachable).toBe(true);
    expect(mock.requests.some((r) => r.headers['authorization'] === 'Bearer sk-temp-cand')).toBe(
      true,
    );
    // 密钥没有以任何形式进入 store（store 是空的，也没有明文文件）
    expect(store.getState().profiles).toHaveLength(0);
    // 尝试保存带密钥 Profile → 必须失败
    expect(() =>
      service.saveProfile(undefined, {
        name: 'Will Fail',
        kind: 'openai-compatible',
        baseUrl: `${mock.url}/v1`,
        defaultModel: 'gpt-4o-mini',
        credentialToken: service.submitCredential(
          'sk-should-not-be-saved',
          `${mock.url}/v1`,
        ),
      }),
    ).toThrow(/凭据存储不可用/);
  });

  it('流式：streamId + 统一事件经 ai:streamEvent 推送；cancel 生效', async () => {
    const { service, sent } = makeService();
    saveMockProfile(service);
    const streamId = service.startChatStream({ messages: [{ role: 'user', content: 'hi' }] });
    expect(streamId).toBeTruthy();

    // 等待流结束
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const events = sent
        .filter((s) => s.channel === 'ai:streamEvent')
        .map((s) => s.payload as { streamId: string; event: ChatStreamEvent });
      if (events.some((e) => e.streamId === streamId && e.event.type === 'done')) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const mine = sent
      .filter((s) => s.channel === 'ai:streamEvent')
      .map((s) => s.payload as { streamId: string; event: ChatStreamEvent })
      .filter((p) => p.streamId === streamId)
      .map((p) => p.event);
    expect(mine[0]).toEqual({ type: 'start', model: 'gpt-4o-mini' });
    expect(
      mine
        .filter((e) => e.type === 'delta')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('你好，流式回复');
    expect(mine.at(-1)).toEqual({ type: 'done' });
    // 流结束后自动清理
    expect(service.activeStreamCount()).toBe(0);

    // cancel：未知 streamId 返回 false
    expect(service.cancelChatStream('no-such')).toBe(false);
  });

  it('跟随默认的 embed 首次维度回写会固化有效配置并广播变更', async () => {
    const { service, sent } = makeService();
    const id = saveMockProfile(service, { defaultModel: 'text-embedding-3-small' });
    sent.length = 0;

    await service.embed(['hello']);
    const state = service.getState();
    expect(state.features.embedding).toEqual({
      profileId: id,
      model: 'text-embedding-3-small',
      dimensions: 1536,
      metric: 'cosine',
    });
    expect(state.embeddingFingerprint).toBe(`${id}:text-embedding-3-small:1536:cosine`);
    expect(sent.filter((event) => event.channel === 'ai:configChanged')).toHaveLength(1);
  });

  it('embed 维度回写：指纹/generation 变更检测（首次回写递增）', async () => {
    const { service } = makeService();
    const id = saveMockProfile(service);
    service.setFeatureAssignment('embedding', { profileId: id, model: 'text-embedding-3-small' });
    const gen0 = service.getState().embeddingGeneration;

    await service.embed(['你好', '世界']);
    const state = service.getState();
    expect(state.features.embedding?.dimensions).toBe(1536);
    expect(state.embeddingGeneration).toBeGreaterThan(gen0); // 维度首次回写 → 指纹变化
    expect(state.embeddingFingerprint).toBe(`${id}:text-embedding-3-small:1536:cosine`);
  });

  it('embed 公共口径：返回 number[][]（规格 embed(texts): Promise<number[][]>）', async () => {
    const { service } = makeService();
    const id = saveMockProfile(service);
    service.setFeatureAssignment('embedding', { profileId: id, model: 'text-embedding-3-small' });
    const vectors = await service.embed(['你好', '世界']);
    expect(Array.isArray(vectors)).toBe(true);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(1536);
    expect(vectors.every((v) => Array.isArray(v) && v.every((n) => typeof n === 'number'))).toBe(
      true,
    );
  });

  it('embedWithMetadata：返回全量 metadata（维度/模型/profileId）', async () => {
    const { service } = makeService();
    const id = saveMockProfile(service);
    service.setFeatureAssignment('embedding', { profileId: id, model: 'text-embedding-3-small' });
    const res = await service.embedWithMetadata(['你好', '世界']);
    expect(res.vectors).toHaveLength(2);
    expect(res.dimensions).toBe(1536);
    expect(res.model).toBe('text-embedding-3-small');
    expect(res.profileId).toBe(id);
  });

  it('embed 维度回写后广播 ai:configChanged；同维度二次 embed 不再推送', async () => {
    const { service, sent } = makeService();
    const id = saveMockProfile(service);
    service.setFeatureAssignment('embedding', { profileId: id, model: 'text-embedding-3-small' });
    sent.length = 0; // 排除 setFeatureAssignment 的事件

    await service.embed(['a']);
    const afterFirst = sent.filter((s) => s.channel === 'ai:configChanged');
    expect(afterFirst).toHaveLength(1); // 首次维度回写 → 推送
    const payload = afterFirst[0]!.payload as { state: AiConfigState };
    expect(payload.state.features.embedding?.dimensions).toBe(1536);
    expect(payload.state.embeddingGeneration).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).not.toContain('sk-service-secret-xyz');

    await service.embed(['b']);
    const afterSecond = sent.filter((s) => s.channel === 'ai:configChanged');
    expect(afterSecond).toHaveLength(1); // 维度未变 → 不再推送
  });

  it('embed 大量文本：自动分批、多次请求、顺序保持', async () => {
    const { service } = makeService();
    const id = saveMockProfile(service);
    service.setFeatureAssignment('embedding', { profileId: id, model: 'text-embedding-3-small' });
    mock.requests.length = 0; // 仅统计本次 embed 的请求

    const texts = Array.from({ length: 100 }, (_, i) => `文档片段 ${i} ${'x'.repeat(100)}`);
    const vectors = await service.embed(texts);
    expect(vectors).toHaveLength(100);
    // mock 向量与 (idx + d) % 17 相关：第一条应为 batch 内 idx=0 的形状
    expect(vectors[0]![1]).toBeCloseTo(1 / 17);
    expect(vectors[99]![1]).not.toBeCloseTo(1 / 17); // 顺序未被重排的证据（非首条形状）

    const embedCalls = mock.requests.filter((r) => r.url === '/v1/embeddings');
    expect(embedCalls.length).toBeGreaterThanOrEqual(2); // 确有分批
    // 输入顺序：第一批应含「文档片段 0」
    const firstCall = embedCalls[0] as { body: { input: string[] } };
    expect(firstCall.body.input[0]!).toContain('文档片段 0');
  });

  it('配置变更推送 ai:configChanged（含脱敏 state）', () => {
    const { service, sent } = makeService();
    saveMockProfile(service);
    const pushed = sent.filter((s) => s.channel === 'ai:configChanged');
    expect(pushed.length).toBeGreaterThan(0);
    const payload = pushed.at(-1)?.payload as { state: AiConfigState };
    expect(payload.state.needsOnboarding).toBe(false);
    expect(JSON.stringify(pushed)).not.toContain('sk-service-secret-xyz');
  });

  it('导入/导出往返（导出不含密钥）', () => {
    const { service } = makeService();
    const id = saveMockProfile(service);
    service.setFeatureAssignment('chat', { profileId: id, model: 'gpt-4o-mini' });
    const exported = service.exportProfiles();
    expect(exported.count).toBe(1);
    expect(exported.json).not.toContain('sk-service-secret-xyz');

    const { service: s2 } = makeService();
    const result = s2.importProfiles(exported.json);
    expect(result.imported).toBe(1);
    expect(s2.getState().profiles[0]!.name).toBe('Mock 网关');
    expect(s2.getState().features.chat?.model).toBe('gpt-4o-mini');

    expect(() => s2.importProfiles('not json')).toThrow(/JSON/);
    expect(() => s2.importProfiles('{"app":"other"}')).toThrow(/NexNote AI Profile/);
  });
});

describe('splitEmbedBatches（token 预算分批）', () => {
  it('按注入 token 估算器而不是字符数切块', () => {
    const texts = ['a', 'bb', 'ccc'];
    expect(splitEmbedBatches(texts, 3, 10, (text) => text.length)).toEqual([['a', 'bb'], ['ccc']]);
  });

  it('按 token 预算与条目上限切块；空输入→空批', () => {
    expect(splitEmbedBatches([])).toEqual([]);
    const short = Array.from({ length: 5 }, (_, i) => `t${i}`);
    expect(splitEmbedBatches(short, 100, 10)).toEqual([short]);

    const long = Array.from({ length: 10 }, () => 'x'.repeat(30));
    const batches = splitEmbedBatches(long, 100, 3);
    expect(batches.length).toBeGreaterThanOrEqual(4);
    expect(batches.flat()).toEqual(long); // 顺序与总量保持
    for (const b of batches) {
      expect(b.length).toBeLessThanOrEqual(3);
      expect(b.reduce((n, t) => n + t.length, 0)).toBeLessThanOrEqual(100 + 30); // 单条可超预算时整条独占一批
    }
  });

  it('超长单条独占一批（不截断内容）', () => {
    const batches = splitEmbedBatches(['short', 'y'.repeat(500), 'tail'], 100, 10);
    expect(batches).toHaveLength(3);
    expect(batches[1]).toEqual(['y'.repeat(500)]);
  });
});
