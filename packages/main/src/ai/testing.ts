import { createServer, type Server } from 'node:http';

/**
 * Mock OpenAI 协议服务器（自动化测试 + NEXNOTE_SMOKE=1 GUI 冒烟共用）：
 * - GET  /v1/models
 * - POST /v1/chat/completions（stream=true → SSE 分段推送）
 * - POST /v1/embeddings（固定维度向量）
 * - POST /openai/deployments/:d/chat/completions（Azure 变体，api-key 头鉴权）
 * 记录全部请求（路径/头/体），供断言「密钥仅经主进程网络栈」与请求形状。
 */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockOpenAiServer {
  url: string;
  server: Server;
  requests: RecordedRequest[];
  failNextChatWith?: number;
  /** 模拟 provider 不支持 SSE 流式（chat stream 请求返回 400） */
  streamingUnsupported?: boolean;
  /** 模拟 SSE 在发送部分 delta 后干净 EOF，但没有 OpenAI [DONE] sentinel。 */
  streamingTruncated?: boolean;
  /** 模拟 provider 不支持 tools/function-calling（带 tools 的 chat 返回 400） */
  toolsUnsupported?: boolean;
  /** 模拟 provider 无 embeddings 端点（返回 404） */
  embeddingsUnsupported?: boolean;
  close(): Promise<void>;
}

export interface MockServerOptions {
  /** embedding 向量维度（默认 1536） */
  embeddingDimensions?: number;
  /** chat SSE 分段间延迟（默认 10ms，保证流式时序可观测） */
  chunkDelayMs?: number;
  models?: string[];
}

export async function startMockOpenAiServer(
  opts: MockServerOptions = {},
): Promise<MockOpenAiServer> {
  const dimensions = opts.embeddingDimensions ?? 1536;
  const chunkDelay = opts.chunkDelayMs ?? 10;
  const models = opts.models ?? ['gpt-4o-mini', 'gpt-4o', 'text-embedding-3-small'];
  const requests: RecordedRequest[] = [];
  const state: MockOpenAiServer = {
    url: '',
    server: null as unknown as Server,
    requests,
    close: async () => {},
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let body: unknown = null;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        body = rawBody;
      }
      // header 归一小写便于断言
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = String(v);
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers, body });

      const json = (data: unknown, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      const handleChat = () => {
        const b = (body ?? {}) as {
          stream?: boolean;
          model?: string;
          tools?: unknown[];
        };
        const isStream = !!b.stream;
        const model = b.model ?? 'gpt-4o-mini';
        if (state.failNextChatWith) {
          const status = state.failNextChatWith;
          state.failNextChatWith = undefined;
          json({ error: { message: 'mock failure' } }, status);
          return;
        }
        // 能力缺失模拟：stream 或 tools 不被支持时返回 400（带明确错误信息）
        if (isStream && state.streamingUnsupported) {
          json(
            { error: { message: 'mock: streaming not supported', type: 'invalid_request_error' } },
            400,
          );
          return;
        }
        if (Array.isArray(b.tools) && b.tools.length > 0 && state.toolsUnsupported) {
          json(
            { error: { message: 'mock: tools not supported', type: 'invalid_request_error' } },
            400,
          );
          return;
        }
        if (!isStream) {
          json({
            id: 'chatcmpl-mock',
            model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '你好，我是 mock 助手。' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
          });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const pieces = [
          { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
          { choices: [{ index: 0, delta: { content: '你好' } }] },
          { choices: [{ index: 0, delta: { content: '，' } }] },
          { choices: [{ index: 0, delta: { content: '流式' } }] },
          { choices: [{ index: 0, delta: { content: '回复' } }] },
          { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        ];
        let i = 0;
        const send = () => {
          if (i < pieces.length) {
            res.write(`data: ${JSON.stringify({ id: 'chatcmpl-mock', model, ...pieces[i] })}\n\n`);
            i += 1;
            setTimeout(send, chunkDelay);
          } else {
            if (!state.streamingTruncated) res.write('data: [DONE]\n\n');
            res.end();
          }
        };
        send();
      };

      const handleEmbeddings = () => {
        if (state.embeddingsUnsupported) {
          json(
            { error: { message: 'mock: embeddings not supported', type: 'invalid_request_error' } },
            404,
          );
          return;
        }
        const input = (body as { input?: string[] | string } | null)?.input ?? [];
        const inputs = Array.isArray(input) ? input : [input];
        const seedVec = (idx: number): number[] =>
          Array.from({ length: dimensions }, (_, d) => ((idx + d) % 17) / 17);
        json({
          model: (body as { model?: string } | null)?.model ?? 'text-embedding-3-small',
          data: inputs.map((_, idx) => ({
            object: 'embedding',
            index: idx,
            embedding: seedVec(idx),
          })),
          usage: { prompt_tokens: inputs.length * 3, total_tokens: inputs.length * 3 },
        });
      };

      if (req.method === 'GET' && req.url === '/v1/models') {
        json({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) });
      } else if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        handleChat();
      } else if (req.method === 'POST' && req.url === '/v1/embeddings') {
        handleEmbeddings();
      } else if (
        req.method === 'POST' &&
        /^\/openai\/deployments\/[^/]+\/chat\/completions/.test(req.url ?? '')
      ) {
        handleChat();
      } else if (
        req.method === 'POST' &&
        /^\/openai\/deployments\/[^/]+\/embeddings/.test(req.url ?? '')
      ) {
        handleEmbeddings();
      } else if (req.method === 'GET' && (req.url ?? '').startsWith('/openai/models')) {
        json({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) });
      } else {
        json({ error: { message: `mock: no route ${req.method} ${req.url}` } }, 404);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('mock server: no address');
  state.server = server;
  state.url = `http://127.0.0.1:${addr.port}`;
  state.close = () =>
    new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  return state;
}
