import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockOpenAiServer, type MockOpenAiServer } from './helpers/mock-openai';
import { OpenAIProtocolAdapter } from '../src/ai/provider/openai';
import type { ChatStreamEvent } from '@nexnote/shared';

let mock: MockOpenAiServer;

beforeAll(async () => {
  mock = await startMockOpenAiServer();
});

afterAll(async () => {
  await mock.close();
});

function adapter(apiKey = 'sk-mock-key'): OpenAIProtocolAdapter {
  return new OpenAIProtocolAdapter({
    baseUrl: `${mock.url}/v1`,
    apiKey,
    kind: 'openai-compatible',
  });
}

function collectStream(
  a: OpenAIProtocolAdapter,
  events: ChatStreamEvent[],
): ReturnType<OpenAIProtocolAdapter['chatCompletionStream']> {
  return a.chatCompletionStream(
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: '打个招呼' }] },
    (e) => events.push(e),
  );
}

describe('OpenAI 协议适配器', () => {
  it('chatCompletion（非流式）返回内容与 usage', async () => {
    const res = await adapter().chatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('你好，我是 mock 助手。');
    expect(res.model).toBe('gpt-4o-mini');
    expect(res.usage?.totalTokens).toBe(12);
  });

  it('chatCompletion 请求带 Bearer 密钥 + 模型 + 参数', async () => {
    await adapter('sk-mock-key').chatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      params: { temperature: 0.2, maxTokens: 8 },
    });
    const req = mock.requests.at(-1) as {
      headers: Record<string, string>;
      body: { model?: string; temperature?: number; max_tokens?: number };
    };
    expect(req.headers['authorization']).toBe('Bearer sk-mock-key');
    expect(req.body.model).toBe('gpt-4o-mini');
    expect(req.body.temperature).toBe(0.2);
    expect(req.body.max_tokens).toBe(8);
  });

  it('chatCompletionStream 发出统一内部事件协议（start→delta*→done）', async () => {
    const events: ChatStreamEvent[] = [];
    const handle = collectStream(adapter(), events);
    await handle.done;
    expect(events[0]).toEqual({ type: 'start', model: 'gpt-4o-mini' });
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.map((e) => (e as { text: string }).text).join('')).toBe('你好，流式回复');
    expect(events.at(-1)).toEqual({ type: 'done' });
    // 无 error 事件
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('HTTP 错误映射为 error 事件（含状态提示）', async () => {
    mock.failNextChatWith = 401;
    const events: ChatStreamEvent[] = [];
    const handle = collectStream(adapter('sk-wrong'), events);
    await handle.done;
    const err = events.find((e) => e.type === 'error') as {
      type: 'error';
      message: string;
      code?: string;
    };
    expect(err).toBeDefined();
    expect(err.message).toContain('HTTP 401');
    expect(err.message).toContain('密钥无效');
  });

  it('embeddings 返回按输入顺序、指定维度的向量', async () => {
    const res = await adapter().embeddings({
      model: 'text-embedding-3-small',
      inputs: ['第一条', '第二条', '第三条'],
    });
    expect(res.vectors).toHaveLength(3);
    expect(res.vectors[0]).toHaveLength(1536);
    expect(res.vectors.every((v) => v.every((n) => typeof n === 'number' && n >= 0 && n < 1))).toBe(
      true,
    );
    // 顺序可区分：不同输入 → 不同向量
    expect(res.vectors[0]).not.toEqual(res.vectors[1]);
  });

  it('testConnection：实测 chat/streaming/embeddings/tools 各能力', async () => {
    const a = adapter();
    const models = await a.listModels();
    expect(models).toContain('gpt-4o-mini');

    const connection = await a.testConnection();
    expect(connection.reachable).toBe(true);
    expect(connection.capabilities).toMatchObject({
      chat: true,
      streaming: true,
      embeddings: true,
      tools: true,
    });
    // capabilities 由各自独立 probe 得出（不应仅靠 chat 推断）
    // 验证：测试期间产生多个非流式 + 1 个流式 + 1 个带 tools 的 chat + 1 个 embedding 请求
    const after = mock.requests.length;
    const urls = mock.requests.map((r) => r.url);
    const stream = mock.requests.find(
      (r) =>
        r.url === '/v1/chat/completions' &&
        (r.body as { stream?: boolean } | null)?.stream === true,
    );
    const tools = mock.requests.find(
      (r) =>
        r.url === '/v1/chat/completions' &&
        Array.isArray((r.body as { tools?: unknown[] } | null)?.tools),
    );
    expect(stream).toBeDefined();
    expect(tools).toBeDefined();
    expect(urls).toContain('/v1/embeddings');
    expect(after).toBeGreaterThan(0);
  });

  it('testConnection：streaming 不被支持时 capabilities.streaming=false', async () => {
    mock.streamingUnsupported = true;
    try {
      const a = adapter();
      const connection = await a.testConnection();
      expect(connection.reachable).toBe(true); // 非流式仍可达
      expect(connection.capabilities.chat).toBe(true);
      expect(connection.capabilities.streaming).toBe(false); // 实测失败
    } finally {
      mock.streamingUnsupported = false;
    }
  });

  it('testConnection：tools 不被支持时 capabilities.tools=false', async () => {
    mock.toolsUnsupported = true;
    try {
      const a = adapter();
      const connection = await a.testConnection();
      expect(connection.reachable).toBe(true);
      expect(connection.capabilities.chat).toBe(true);
      expect(connection.capabilities.tools).toBe(false);
    } finally {
      mock.toolsUnsupported = false;
    }
  });

  it('testConnection：embeddings 不被支持时 capabilities.embeddings=false', async () => {
    mock.embeddingsUnsupported = true;
    try {
      const a = adapter();
      const connection = await a.testConnection();
      expect(connection.reachable).toBe(true);
      expect(connection.capabilities.embeddings).toBe(false);
    } finally {
      mock.embeddingsUnsupported = false;
    }
  });

  it('Azure 变体：deployment 路径 + api-key 头', async () => {
    const azure = new OpenAIProtocolAdapter({
      baseUrl: `${mock.url}`,
      apiKey: 'az-key',
      kind: 'azure-openai',
    });
    const res = await azure.chatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toContain('mock 助手');
    const req = mock.requests.at(-1);
    expect(req?.url).toBe(
      '/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21',
    );
    expect(req?.headers['api-key']).toBe('az-key');
    expect(req?.headers['authorization']).toBeUndefined();
  });

  it('Ollama 场景：无密钥时不发 Authorization 头', async () => {
    await new OpenAIProtocolAdapter({
      baseUrl: `${mock.url}/v1`,
      apiKey: '  ',
      kind: 'openai-compatible',
    }).chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
    expect(mock.requests.at(-1)?.headers['authorization']).toBeUndefined();
  });

  it('不可达端点抛 NETWORK 错误', async () => {
    const dead = new OpenAIProtocolAdapter({
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'k',
      kind: 'openai-compatible',
    });
    await expect(
      dead.chatCompletion({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/网络请求失败/);
  });
});
