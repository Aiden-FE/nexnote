import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentRunEvent, AiConfigState } from '@nexnote/shared';
import { AgentGateway } from '../src/agent/gateway';
import { AuditStore } from '../src/agent/audit-store';
import { ToolRegistry, type AgentTool } from '../src/agent/tool-registry';
import {
  createReasoningStreamFilter,
  sanitizeReasoningArtifacts,
} from '../src/agent/reasoning-filter';
import { TRANSLATION_REASONING_EFFORT } from '../src/agent/translation';
import type { ChatStreamHandle } from '../src/ai/provider/types';
import { OpenAIProtocolAdapter } from '../src/ai/provider/openai';
import { validatePayload } from '../src/ipc/validation';
import { startMockOpenAiServer, type MockOpenAiServer } from './helpers/mock-openai';

/**
 * DEV-041 临时翻译请求层不变量：
 * - prompt 由主进程组装（目标语言进 system，原文进 user）
 * - reasoning 固定关闭：即使渲染层/Profile 指定高 reasoning 也被覆盖
 * - translation 场景没有任何文档写工具权限
 * - IPC 边界拒绝非法请求与 reasoning 覆盖字段
 */

const aiState: AiConfigState = {
  profiles: [
    {
      id: 'profile-1',
      name: 'fake',
      kind: 'openai-compatible',
      baseUrl: 'http://fake.local',
      defaultModel: 'fake-model',
      params: {},
      hasApiKey: true,
      keyStorage: 'system-credential',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  defaultProfileId: 'profile-1',
  features: {
    chat: { profileId: 'profile-1', model: 'fake-model' },
    writing: { profileId: 'profile-1', model: 'fake-model' },
    translation: null,
    embedding: null,
  },
  translationTargetLanguage: 'English',
  needsOnboarding: false,
  setupPromptDismissed: true,
  embeddingFingerprint: null,
  embeddingGeneration: 0,
};

interface StreamCall {
  messages: Array<{ role: string; content: string }>;
  feature?: string;
  params?: Record<string, unknown>;
}

const immediateStream = (): ChatStreamHandle => ({
  abort: vi.fn(),
  done: Promise.resolve(),
});

function deferredStream() {
  let resolve!: () => void;
  const done = new Promise<void>((r) => {
    resolve = r;
  });
  return { handle: { abort: vi.fn(), done } as ChatStreamHandle, resolve };
}

function setup(
  options: {
    stream?: (onEvent: (event: AgentRunEvent) => void) => ChatStreamHandle;
    tools?: AgentTool[];
    emitted?: AgentRunEvent[];
  } = {},
) {
  const calls: StreamCall[] = [];
  const events: Array<{ runId: string; scenario: string; event: AgentRunEvent }> = [];
  const ai = {
    getState: () => aiState,
    openChatStream: (
      opts: StreamCall,
      onEvent: (event: AgentRunEvent) => void,
    ): ChatStreamHandle => {
      calls.push(opts);
      for (const event of options.emitted ?? []) onEvent(event);
      return options.stream ? options.stream(onEvent) : immediateStream();
    },
  };
  const gateway = new AgentGateway({
    ai: ai as never,
    tools: options.tools ? new ToolRegistry(options.tools) : undefined,
    audit: new AuditStore(),
    sendEvent: (_channel, payload) => events.push(payload as (typeof events)[number]),
  });
  return { gateway, calls, events };
}

const translation = {
  mode: 'selection' as const,
  targetLanguage: 'English',
  text: '你好，世界',
};

describe('DEV-041 临时翻译请求层', () => {
  it('主进程组装 prompt、兼容回退 writing profile，并强制关闭 reasoning', async () => {
    const { gateway, calls, events } = setup();
    await gateway.run('translation', {
      translation,
      // 渲染层试图打开 reasoning：主进程必须覆盖
      params: { temperature: 0.2, reasoningEffort: 'high' },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.feature).toBe('translation');
    expect(call.params).toEqual({
      temperature: 0.2,
      reasoningEffort: TRANSLATION_REASONING_EFFORT,
    });
    expect(call.params?.reasoningEffort).toBe('none');
    expect((call as StreamCall & { tools?: unknown[] }).tools ?? []).toHaveLength(0);
    expect(
      events.some(
        (entry) => entry.event.type === 'fallback' && entry.event.runtime === 'builtin-fallback',
      ),
    ).toBe(true);
    // 目标语言在 system，原文在 user
    expect(call.messages[0]?.role).toBe('system');
    expect(call.messages[0]?.content).toContain('English');
    expect(call.messages.at(-1)?.role).toBe('user');
    expect(call.messages.at(-1)?.content).toContain('你好，世界');
    // scenario 归属正确（渲染层据此关联流事件）
    expect(events[0]?.scenario).toBe('translation');
    expect(events[0]?.event.type).toBe('start');
  });

  it('缺 translation 字段的翻译请求以 BAD_TRANSLATION_REQUEST 失败，不发起 provider 请求', async () => {
    const { gateway, calls, events } = setup();
    await gateway.run('translation', { messages: [] });
    expect(calls).toHaveLength(0);
    const error = events.find((e) => e.event.type === 'error');
    expect(error?.event).toMatchObject({ type: 'error', code: 'BAD_TRANSLATION_REQUEST' });
  });

  it('翻译场景没有文档写工具权限（写工具一律 TOOL_NOT_ALLOWED）', async () => {
    const deferred = deferredStream();
    const writeTool: AgentTool = {
      definition: {
        name: 'write_note',
        description: 'write',
        access: 'write',
        requiresApproval: true,
        inputSchema: {},
      },
      execute: async () => ({ written: true }),
    };
    const { gateway } = setup({ stream: () => deferred.handle, tools: [writeTool] });
    const { runId } = await gateway.run('translation', { translation });
    await expect(gateway.executeTool(runId, 'write_note', {})).rejects.toMatchObject({
      code: 'TOOL_NOT_ALLOWED',
    });
    deferred.resolve();
    await deferred.handle.done;
  });

  it('翻译消息过滤 reasoningDelta 与跨片段思考标记，只转发译文', async () => {
    const { gateway, events } = setup({
      emitted: [
        { type: 'delta', text: 'Hello ' },
        { type: 'delta', text: '<thi' },
        { type: 'delta', text: 'nk>internal' },
        { type: 'reasoningDelta', text: 'hidden reasoning' },
        { type: 'delta', text: '</think>world' },
        { type: 'done' },
      ],
    });

    await gateway.run('translation', { translation });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const forwarded = events.map((entry) => entry.event);
    expect(forwarded.filter((event) => event.type === 'reasoningDelta')).toHaveLength(0);
    expect(
      forwarded
        .filter(
          (event): event is Extract<AgentRunEvent, { type: 'delta' }> => event.type === 'delta',
        )
        .map((event) => event.text)
        .join(''),
    ).toBe('Hello world');
    expect(forwarded.at(-1)?.type).toBe('done');
  });

  it('仅 translation 清洗；普通场景原样转发 reasoningDelta 与标签文本', async () => {
    const { gateway, events } = setup({
      emitted: [
        { type: 'delta', text: '<think>normal chat text</think>' },
        { type: 'reasoningDelta', text: 'normal reasoning channel' },
        { type: 'done' },
      ],
    });

    await gateway.run('chat', { messages: [{ role: 'user', content: 'hi' }] });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(events.map((entry) => entry.event)).toContainEqual({
      type: 'delta',
      text: '<think>normal chat text</think>',
    });
    expect(events.map((entry) => entry.event)).toContainEqual({
      type: 'reasoningDelta',
      text: 'normal reasoning channel',
    });
  });

  it('正常 done flush 普通 pending 前缀，未闭合完整块不泄漏', async () => {
    const visible = setup({
      emitted: [{ type: 'delta', text: '译文<thi' }, { type: 'done' }],
    });
    await visible.gateway.run('translation', { translation });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      visible.events
        .map((entry) => entry.event)
        .filter(
          (event): event is Extract<AgentRunEvent, { type: 'delta' }> => event.type === 'delta',
        )
        .map((event) => event.text)
        .join(''),
    ).toBe('译文<thi');

    const hidden = setup({
      emitted: [{ type: 'delta', text: '译文<think>绝不能泄漏' }, { type: 'done' }],
    });
    await hidden.gateway.run('translation', { translation });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      hidden.events
        .map((entry) => entry.event)
        .filter(
          (event): event is Extract<AgentRunEvent, { type: 'delta' }> => event.type === 'delta',
        )
        .map((event) => event.text)
        .join(''),
    ).toBe('译文');
  });

  it('错误与取消保留已输出译文，丢弃隐藏缓冲及终止后的晚到事件', async () => {
    const errorCase = setup({
      emitted: [
        { type: 'delta', text: '已显示<think>隐藏' },
        { type: 'error', message: '断线', code: 'STREAM_READ' },
        { type: 'delta', text: '晚到泄漏</think>' },
        { type: 'done' },
      ],
    });
    await errorCase.gateway.run('translation', { translation });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      errorCase.events
        .map((entry) => entry.event)
        .filter(
          (event): event is Extract<AgentRunEvent, { type: 'delta' }> => event.type === 'delta',
        )
        .map((event) => event.text)
        .join(''),
    ).toBe('已显示');
    expect(errorCase.events.map((entry) => entry.event.type)).not.toContain('done');

    const deferred = deferredStream();
    let providerEmit: ((event: AgentRunEvent) => void) | undefined;
    const cancelled = setup({
      stream: (onEvent) => {
        providerEmit = onEvent;
        return deferred.handle;
      },
    });
    const { runId } = await cancelled.gateway.run('translation', { translation });
    providerEmit?.({ type: 'delta', text: '保留译文<think>隐藏' });
    expect(cancelled.gateway.cancel(runId)).toBe(true);
    providerEmit?.({ type: 'delta', text: '晚到泄漏</think>' });
    providerEmit?.({ type: 'done' });
    deferred.resolve();
    await deferred.handle.done;
    expect(
      cancelled.events
        .map((entry) => entry.event)
        .filter(
          (event): event is Extract<AgentRunEvent, { type: 'delta' }> => event.type === 'delta',
        )
        .map((event) => event.text)
        .join(''),
    ).toBe('保留译文');
    expect(cancelled.events.map((entry) => entry.event.type)).not.toContain('done');
  });

  it('翻译消息模板区分划词、全文与独立输入，均不注入上下文/技能', async () => {
    const { gateway, calls } = setup();
    await gateway.run('translation', {
      translation: { mode: 'document', targetLanguage: '日本語', text: '# 标题\n\n正文' },
    });
    await gateway.run('translation', {
      translation: { mode: 'input', targetLanguage: 'Deutsch', text: '临时粘贴内容' },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(calls[0]?.messages).toHaveLength(2);
    expect(calls[0]?.messages[1]?.content).toContain('整篇文档');
    expect(calls[0]?.messages[0]?.content).toContain('日本語');
    expect(calls[1]?.messages).toHaveLength(2);
    expect(calls[1]?.messages[1]?.content).toContain('临时输入');
    expect(calls[1]?.messages[1]?.content).toContain('临时粘贴内容');
  });

  it('translation assignment 独立路由；未设置时兼容回退 writing assignment', async () => {
    const dedicatedState: AiConfigState = {
      ...aiState,
      profiles: [
        ...aiState.profiles,
        { ...aiState.profiles[0]!, id: 'translation-profile', name: 'translation' },
      ],
      features: {
        ...aiState.features,
        translation: { profileId: 'translation-profile', model: 'translation-model' },
      },
    };
    const calls: StreamCall[] = [];
    const gateway = new AgentGateway({
      ai: {
        getState: () => dedicatedState,
        openChatStream: (opts: StreamCall) => {
          calls.push(opts);
          return immediateStream();
        },
      } as never,
      sendEvent: () => undefined,
    });
    await gateway.run('translation', { translation });
    await new Promise((r) => setTimeout(r, 5));
    expect(calls[0]?.feature).toBe('translation');
  });
});

describe('DEV-041 IPC 边界', () => {
  it('接受合法翻译请求，拒绝非法字段与 reasoning 覆盖', () => {
    for (const mode of ['selection', 'document', 'input'] as const) {
      expect(
        validatePayload('agent:run:translation', {
          translation: { mode, targetLanguage: 'English', text: 'hi' },
        }),
      ).toBeNull();
    }
    expect(
      validatePayload('agent:run:translation', {
        translation: { mode: 'input', targetLanguage: 'English', text: 'x'.repeat(200_000) },
      }),
    ).toBeNull();
    expect(
      validatePayload('agent:run:translation', {
        translation: { mode: 'input', targetLanguage: 'English', text: 'x'.repeat(200_001) },
      })?.code,
    ).toBe('IPC_PAYLOAD_INVALID');

    for (const payload of [
      { translation: { mode: 'nope', targetLanguage: 'English', text: 'hi' } },
      { translation: { mode: 'selection', targetLanguage: '', text: 'hi' } },
      { translation: { mode: 'selection', targetLanguage: 'English', text: '   ' } },
      { translation: { mode: 'selection', targetLanguage: 'English', text: 'hi', extra: 1 } },
      { translation: { mode: 'selection', targetLanguage: 'English', text: 'hi' }, unknown: 1 },
      {
        translation: { mode: 'selection', targetLanguage: 'English', text: 'hi' },
        params: { reasoningEffort: 'high' },
      },
    ]) {
      expect(validatePayload('agent:run:translation', payload)?.code).toBe('IPC_PAYLOAD_INVALID');
    }
  });
});

describe('DEV-041 reasoning 关闭值到达 provider', () => {
  let mock: MockOpenAiServer;
  beforeAll(async () => {
    mock = await startMockOpenAiServer();
  });
  afterAll(async () => {
    await mock.close();
  });

  it('仅完整 reasoning 标签触发隐藏，普通小于号、前缀与相似标签逐字保真', () => {
    for (const text of [
      '普通文本<',
      '普通文本<thi',
      '普通文本<think',
      '普通文本<analysis',
      '普通文本<thinking>正文</thinking>',
      'a < b && c <= d',
      '可见</think>尾巴',
    ]) {
      expect(sanitizeReasoningArtifacts(text)).toBe(text);
    }
  });

  it('隐藏 nested mixed think/analysis、多块、大小写和标签内空白', () => {
    expect(
      sanitizeReasoningArtifacts(
        'A< THINK >one<analysis>two</analysis>three</ THINK >B' +
          '<AnAlYsIs\n>four<think>five</think></ ANALYSIS\u00a0>C',
      ),
    ).toBe('ABC');
    expect(sanitizeReasoningArtifacts('<think><analysis>x</analysis></think>可见')).toBe('可见');
    expect(sanitizeReasoningArtifacts('前<think>未闭合')).toBe('前');
  });

  it('完整标签的每个切分点都不泄漏隐藏内容，普通前缀跨 chunk 后可恢复', () => {
    const sample = '前< ThInK >秘密<analysis>更深</analysis></ THINK >后';
    for (let split = 0; split <= sample.length; split += 1) {
      const filter = createReasoningStreamFilter();
      expect(
        filter.push(sample.slice(0, split)) + filter.push(sample.slice(split)) + filter.finish(),
      ).toBe('前后');
    }

    for (const chunks of [
      ['普通<thi', 's is text'],
      ['普通<analy', 'tics>'],
      ['普通<think', 'ing>'],
      ['普通<', 'not-a-tag>'],
    ]) {
      const filter = createReasoningStreamFilter();
      expect(chunks.map((chunk) => filter.push(chunk)).join('') + filter.finish()).toBe(
        chunks.join(''),
      );
    }
  });

  it('固定种子的随机 chunk 切分与整段清洗结果一致', () => {
    const sample =
      '可见<THINK\n>hidden<analysis>nested</analysis></ THINK >正文<analysis>x</analysis>结尾<thi';
    const expected = '可见正文结尾<thi';
    let seed = 0x5eed;
    for (let run = 0; run < 100; run += 1) {
      const filter = createReasoningStreamFilter();
      let offset = 0;
      let actual = '';
      while (offset < sample.length) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const size = (seed % 7) + 1;
        actual += filter.push(sample.slice(offset, offset + size));
        offset += size;
      }
      actual += filter.finish();
      expect(actual).toBe(expected);
    }
  });

  it('OpenAI-compatible 流式与非流式请求都发送 reasoning_effort=none', async () => {
    const adapter = new OpenAIProtocolAdapter({
      baseUrl: `${mock.url}/v1`,
      apiKey: 'sk-mock-key',
      kind: 'openai-compatible',
    });
    await adapter.chatCompletionStream(
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'translate' }],
        params: { reasoningEffort: TRANSLATION_REASONING_EFFORT },
      },
      () => undefined,
    ).done;
    expect((mock.requests.at(-1)?.body as { reasoning_effort?: string }).reasoning_effort).toBe(
      'none',
    );

    await adapter.chatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'translate fallback' }],
      params: { reasoningEffort: TRANSLATION_REASONING_EFFORT },
    });
    expect((mock.requests.at(-1)?.body as { reasoning_effort?: string }).reasoning_effort).toBe(
      'none',
    );
  });

  it('Azure 非流式路径保持 reasoning_effort=none 与 deployment 协议', async () => {
    const adapter = new OpenAIProtocolAdapter({
      baseUrl: mock.url,
      apiKey: 'azure-key',
      kind: 'azure-openai',
    });
    await adapter.chatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'translate fallback' }],
      params: { reasoningEffort: TRANSLATION_REASONING_EFFORT },
    });
    const request = mock.requests.at(-1)!;
    expect(request.url).toContain('/openai/deployments/gpt-4o-mini/chat/completions');
    expect(request.headers['api-key']).toBe('azure-key');
    expect((request.body as { reasoning_effort?: string }).reasoning_effort).toBe('none');
  });

  it('provider 拒绝 reasoning 参数时失败且不静默移除参数重试', async () => {
    const adapter = new OpenAIProtocolAdapter({
      baseUrl: `${mock.url}/v1`,
      apiKey: 'sk-mock-key',
      kind: 'openai-compatible',
    });
    const before = mock.requests.length;
    mock.failNextChatWith = 400;
    await expect(
      adapter.chatCompletion({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'translate fallback' }],
        params: { reasoningEffort: TRANSLATION_REASONING_EFFORT },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_HTTP', status: 400 });
    expect(mock.requests).toHaveLength(before + 1);
    expect((mock.requests.at(-1)?.body as { reasoning_effort?: string }).reasoning_effort).toBe(
      'none',
    );
  });
});
