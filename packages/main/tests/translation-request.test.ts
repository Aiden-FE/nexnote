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
    embedding: null,
  },
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
  options: { stream?: () => ChatStreamHandle; tools?: AgentTool[]; emitted?: AgentRunEvent[] } = {},
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
      return options.stream ? options.stream() : immediateStream();
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
  it('主进程组装 prompt、复用 writing profile，并强制关闭 reasoning', async () => {
    const { gateway, calls, events } = setup();
    await gateway.run('translation', {
      translation,
      // 渲染层试图打开 reasoning：主进程必须覆盖
      params: { temperature: 0.2, reasoningEffort: 'high' },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.feature).toBe('writing');
    expect(call.params).toEqual({
      temperature: 0.2,
      reasoningEffort: TRANSLATION_REASONING_EFFORT,
    });
    expect(call.params?.reasoningEffort).toBe('none');
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

  it('翻译消息模板区分划词与全文，均不注入上下文/技能', async () => {
    const { gateway, calls } = setup();
    await gateway.run('translation', {
      translation: { mode: 'document', targetLanguage: '日本語', text: '# 标题\n\n正文' },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(calls[0]?.messages).toHaveLength(2);
    expect(calls[0]?.messages[1]?.content).toContain('整篇文档');
    expect(calls[0]?.messages[0]?.content).toContain('日本語');
  });
});

describe('DEV-041 IPC 边界', () => {
  it('接受合法翻译请求，拒绝非法字段与 reasoning 覆盖', () => {
    expect(
      validatePayload('agent:run:translation', {
        translation: { mode: 'selection', targetLanguage: 'English', text: 'hi' },
      }),
    ).toBeNull();

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

  it('sanitizeReasoningArtifacts 同时去除 think 与 analysis 残留（含未闭合块）', () => {
    const filter = createReasoningStreamFilter();
    expect(filter.push('A<think>hidden</think>B') + filter.finish()).toBe('AB');
    expect(filter.push('A<analysis>internal</analysis>B') + filter.finish()).toBe('AB');
    expect(filter.push('<think>未结束') + filter.finish()).toBe('');
    expect(filter.push('前缀<thi') + filter.finish()).toBe('前缀');
  });

  it('sanitizeReasoningArtifacts 单函数版本去除跨片段的 think 块', () => {
    expect(sanitizeReasoningArtifacts('<think>hidden</think>可见')).toBe('可见');
    expect(sanitizeReasoningArtifacts('<analysis>hidden</analysis>')).toBe('');
    expect(sanitizeReasoningArtifacts('普通<think>跨片段尾巴')).toBe('普通');
  });

  it('适配层把关闭值翻译为 provider reasoning_effort', async () => {
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
    const req = mock.requests.at(-1) as { body: { reasoning_effort?: string } };
    expect(req.body.reasoning_effort).toBe('none');
  });
});
