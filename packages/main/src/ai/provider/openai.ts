import type {
  ChatStreamEvent,
  TokenUsage,
} from '@nexnote/shared';
import { createSseParser } from './sse';
import {
  ProviderError,
  type AdapterOptions,
  type ChatRequest,
  type ChatStreamHandle,
  type EmbedRequest,
  type EmbedResponse,
  type ProviderAdapter,
} from './types';

const REQUEST_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_MS = 15_000;

/** 规范化 base URL：去尾部斜杠。 */
function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function joinUrl(base: string, path: string): string {
  return `${base}${path}`;
}

interface OpenAiChatChunkChoiceDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: unknown[];
}

interface OpenAiChatChunk {
  model?: string;
  choices?: Array<{
    delta?: OpenAiChatChunkChoiceDelta;
    finish_reason?: string | null;
  }>;
  usage?: TokenUsage | null;
}

function extractUsage(raw: unknown): TokenUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const u = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  if (!('total_tokens' in u)) return undefined;
  return {
    promptTokens: num(u.prompt_tokens),
    completionTokens: num(u.completion_tokens),
    totalTokens: num(u.total_tokens),
  };
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

function messageFromStatus(status: number, body: string): string {
  const hint =
    status === 401 || status === 403
      ? '（密钥无效或无权限）'
      : status === 404
        ? '（路径不存在：请检查 base-url 是否包含 /v1、模型名是否正确）'
        : status === 429
          ? '（限流或额度不足）'
          : '';
  return `供应商返回 HTTP ${status}${hint}${body ? `: ${body}` : ''}`;
}

/**
 * OpenAI 协议适配器：
 * - openai-compatible：OpenAI 官方 / Ollama / 中转站等一切 OpenAI 协议端点（Bearer 鉴权）
 * - azure-openai：Azure OpenAI（deployment 路径 + api-key 头）
 * SSE 流被解析为统一内部事件协议（ChatStreamEvent），隔离各 provider 差异。
 */
export class OpenAIProtocolAdapter implements ProviderAdapter {
  readonly kind: AdapterOptions['kind'];
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(opts: AdapterOptions) {
    this.kind = opts.kind;
    this.baseUrl = opts.baseUrl;
    this.base = normalizeBase(opts.baseUrl);
    this.apiKey = opts.apiKey.trim();
    this.apiVersion = opts.apiVersion ?? '2024-10-21';
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers['Content-Type'] = 'application/json';
    if (this.apiKey) {
      if (this.kind === 'azure-openai') headers['api-key'] = this.apiKey;
      else headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private chatUrl(model: string, stream: boolean): string {
    if (this.kind === 'azure-openai') {
      const q = `api-version=${this.apiVersion}${stream ? '&stream=true' : ''}`;
      return joinUrl(this.base, `/openai/deployments/${encodeURIComponent(model)}/chat/completions?${q}`);
    }
    return joinUrl(this.base, '/chat/completions');
  }

  private embeddingsUrl(model: string): string {
    if (this.kind === 'azure-openai') {
      return joinUrl(
        this.base,
        `/openai/deployments/${encodeURIComponent(model)}/embeddings?api-version=${this.apiVersion}`,
      );
    }
    return joinUrl(this.base, '/embeddings');
  }

  private modelsUrl(): string {
    if (this.kind === 'azure-openai') {
      return joinUrl(this.base, `/openai/models?api-version=${this.apiVersion}`);
    }
    return joinUrl(this.base, '/models');
  }

  declaredCapabilities() {
    return { chat: true, streaming: true, embeddings: true, tools: true };
  }

  async listModels(): Promise<string[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.modelsUrl(), {
        method: 'GET',
        headers: this.headers(false),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
    } catch (e) {
      throw this.networkError(e);
    }
    if (!res.ok) throw new ProviderError(messageFromStatus(res.status, await readErrorBody(res)), 'PROVIDER_HTTP', res.status);
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? [])
      .map((m) => (typeof m?.id === 'string' ? m.id : ''))
      .filter((id) => id.length > 0)
      .sort();
  }

  async chatCompletion(req: ChatRequest): Promise<{ content: string; model: string; usage?: TokenUsage }> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.chatUrl(req.model, false), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          ...(req.params?.temperature !== undefined && { temperature: req.params.temperature }),
          ...(req.params?.maxTokens !== undefined && { max_tokens: req.params.maxTokens }),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw this.networkError(e);
    }
    if (!res.ok) throw new ProviderError(messageFromStatus(res.status, await readErrorBody(res)), 'PROVIDER_HTTP', res.status);
    const body = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: unknown;
    };
    const content = body.choices?.[0]?.message?.content ?? '';
    return { content, model: body.model ?? req.model, usage: extractUsage(body.usage) };
  }

  chatCompletionStream(req: ChatRequest, onEvent: (event: ChatStreamEvent) => void): ChatStreamHandle {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(new Error('timeout')), REQUEST_TIMEOUT_MS);
    let settled = false;

    const finish = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
      }
    };

    const done = (async (): Promise<void> => {
      let res: Response;
      try {
        res = await this.fetchImpl(this.chatUrl(req.model, true), {
          method: 'POST',
          headers: this.headers(true),
          body: JSON.stringify({
            model: req.model,
            messages: req.messages,
            stream: true,
            ...(req.params?.temperature !== undefined && { temperature: req.params.temperature }),
            ...(req.params?.maxTokens !== undefined && { max_tokens: req.params.maxTokens }),
          }),
          signal: abort.signal,
        });
      } catch (e) {
        finish();
        if (abort.signal.aborted) {
          onEvent({ type: 'error', message: '已取消', code: 'CANCELLED' });
        } else {
          const netErr = this.networkError(e);
          onEvent({ type: 'error', message: netErr.message, code: netErr.code });
        }
        return;
      }
      if (!res.ok) {
        finish();
        onEvent({ type: 'error', message: messageFromStatus(res.status, await readErrorBody(res)), code: 'PROVIDER_HTTP' });
        return;
      }
      if (!res.body) {
        finish();
        onEvent({ type: 'error', message: '供应商未返回流式响应体', code: 'EMPTY_BODY' });
        return;
      }

      let streamDone = false;
      const parser = createSseParser((data) => {
        if (streamDone) return;
        if (data === '[DONE]') {
          streamDone = true;
          onEvent({ type: 'done' });
          void abort.abort(new Error('done'));
          return;
        }
        let chunk: OpenAiChatChunk;
        try {
          chunk = JSON.parse(data) as OpenAiChatChunk;
        } catch {
          return; // 非 JSON 心跳等，忽略
        }
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.reasoning_content) onEvent({ type: 'reasoningDelta', text: delta.reasoning_content });
        if (delta?.content) onEvent({ type: 'delta', text: delta.content });
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done: readerDone, value } = await reader.read();
          if (readerDone) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
        parser.feed(decoder.decode());
        parser.flush();
        if (!streamDone) {
          streamDone = true;
          onEvent({ type: 'done' });
        }
      } catch (e) {
        if (!streamDone) {
          streamDone = true;
          const msg = abort.signal.aborted ? '已取消' : e instanceof Error ? e.message : String(e);
          onEvent({ type: 'error', message: msg, code: abort.signal.aborted ? 'CANCELLED' : 'STREAM_READ' });
        }
      } finally {
        finish();
      }
    })();

    return {
      abort: () => {
        void abort.abort(new Error('aborted'));
      },
      done,
    };
  }

  async embeddings(req: EmbedRequest): Promise<EmbedResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.embeddingsUrl(req.model), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ model: req.model, input: req.inputs }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw this.networkError(e);
    }
    if (!res.ok) {
      throw new ProviderError(messageFromStatus(res.status, await readErrorBody(res)), 'PROVIDER_HTTP', res.status);
    }
    const body = (await res.json()) as {
      model?: string;
      data?: Array<{ index?: number; embedding?: number[] }>;
      usage?: unknown;
    };
    const items = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = items.map((d) => {
      if (!Array.isArray(d.embedding)) {
        throw new ProviderError('embeddings 响应缺少向量数据', 'BAD_EMBEDDING');
      }
      return d.embedding.map((v) => (typeof v === 'number' ? v : Number(v)));
    });
    if (vectors.length !== req.inputs.length) {
      throw new ProviderError(
        `embeddings 返回数量不匹配（期望 ${req.inputs.length}，收到 ${vectors.length}）`,
        'BAD_EMBEDDING',
      );
    }
    return { vectors, model: body.model ?? req.model, usage: extractUsage(body.usage) };
  }

  private networkError(e: unknown): ProviderError {
    const msg = e instanceof Error ? e.message : String(e);
    return new ProviderError(`网络请求失败：${msg}`, 'NETWORK');
  }
}
