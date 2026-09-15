import type { ChatStreamEvent, ProviderCapabilities, TokenUsage } from '@nexnote/shared';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
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

/** 规范化 base URL：去尾部斜杠 + 拒绝 userinfo（URL 中嵌入凭据会泄漏到请求头/日志）。 */
function normalizeBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ProviderError('Base URL 必须是有效的 http(s) URL', 'BAD_BASE_URL');
  }
  if (url.username || url.password) {
    throw new ProviderError(
      'Base URL 不得包含用户名/密码（凭据应通过 API Key 字段传入）',
      'BAD_BASE_URL',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderError('Base URL 必须使用 http(s) 协议', 'BAD_BASE_URL');
  }
  return trimmed;
}

function joinUrl(base: string, path: string): string {
  return `${base}${path}`;
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

/**
 * Provider bodies are untrusted and may echo credentials or document content. Never copy them to
 * errors, IPC, or logs; only retain the status and operation for diagnostics.
 */
function logRedactedProviderError(res: Response, op: string): void {
  console.warn(`[ai:${op}] HTTP ${res.status} (provider response body redacted)`);
}

/** 通用状态消息：仅状态 + 静态提示词（不含 body），安全进入 IPC。 */
function safeMessageFromStatus(status: number): string {
  const hint =
    status === 401 || status === 403
      ? '（密钥无效或无权限）'
      : status === 404
        ? '（路径不存在：请检查 base-url 是否包含 /v1、模型名是否正确）'
        : status === 429
          ? '（限流或额度不足）'
          : '';
  return `供应商返回 HTTP ${status}${hint}`;
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

  private request(url: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, { ...init, redirect: 'error' });
  }

  private chatUrl(model: string, stream: boolean): string {
    if (this.kind === 'azure-openai') {
      const q = `api-version=${this.apiVersion}${stream ? '&stream=true' : ''}`;
      return joinUrl(
        this.base,
        `/openai/deployments/${encodeURIComponent(model)}/chat/completions?${q}`,
      );
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

  async testConnection(defaultModel = ''): Promise<{
    reachable: boolean;
    capabilities: ProviderCapabilities;
    models: string[];
    latencyMs: number;
    error?: string;
  }> {
    const started = Date.now();
    let models: string[] = [];
    try {
      models = await this.listModels();
    } catch {
      // 列模型失败不视为不可达（Azure 部分部署不可列模型）
    }

    const chatModel = defaultModel || models.find((m) => !m.toLowerCase().includes('embed')) || '';

    // 1. chat 实测（非流式）
    const chatOk = chatModel
      ? await (async () => {
          try {
            await this.chatCompletion({
              model: chatModel,
              messages: [{ role: 'user', content: 'ping' }],
              params: { maxTokens: 1 },
            });
            return true;
          } catch {
            return false;
          }
        })()
      : false;

    // 2. streaming 实测：发起一次 SSE 流，收到首个非 error 事件即判成功
    const streamingOk = chatModel
      ? await new Promise<boolean>((resolve) => {
          try {
            let settled = false;
            const finish = (ok: boolean) => {
              if (settled) return;
              settled = true;
              handle.abort();
              resolve(ok);
            };
            const handle = this.chatCompletionStream(
              {
                model: chatModel,
                messages: [{ role: 'user', content: 'ping' }],
                params: { maxTokens: 1 },
              },
              (event) => {
                // Only the protocol sentinel produces `done`; a start/delta followed by EOF
                // is a truncated stream and must not be advertised as streaming-capable.
                if (event.type === 'done') finish(true);
                else if (event.type === 'error') finish(false);
              },
            );
            // 超时保护：8 秒内没开始流则判失败
            const t = setTimeout(() => finish(false), 8000);
            void handle.done.finally(() => {
              clearTimeout(t);
              if (!settled) finish(false);
            });
          } catch {
            resolve(false);
          }
        })
      : false;

    // 3. tools 实测：发一次带空函数 schema 的 chat，非 4xx 即支持
    const toolsOk = chatModel
      ? await (async () => {
          try {
            const res = await this.request(this.chatUrl(chatModel, false), {
              method: 'POST',
              headers: this.headers(true),
              body: JSON.stringify({
                model: chatModel,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
                tools: [
                  {
                    type: 'function',
                    function: {
                      name: 'ping_noop',
                      description: 'noop',
                      parameters: { type: 'object', properties: {} },
                    },
                  },
                ],
              }),
              signal: AbortSignal.timeout(15_000),
            });
            return res.ok;
          } catch {
            return false;
          }
        })()
      : false;

    // 4. embeddings 实测
    const embeddingModel = models.find((m) => m.toLowerCase().includes('embed')) ?? '';
    const embeddingsOk = embeddingModel
      ? await (async () => {
          try {
            const r = await this.embeddings({ model: embeddingModel, inputs: ['ping'] });
            return (r.vectors[0]?.length ?? 0) > 0;
          } catch {
            return false;
          }
        })()
      : false;

    const reachable = chatOk || models.length > 0;
    return {
      reachable,
      capabilities: {
        chat: chatOk,
        streaming: streamingOk,
        embeddings: embeddingsOk,
        tools: toolsOk,
      },
      models,
      latencyMs: Date.now() - started,
      ...(reachable ? {} : { error: '无法连接供应商（模型列表与对话探测均失败）' }),
    };
  }

  async listModels(): Promise<string[]> {
    let res: Response;
    try {
      res = await this.request(this.modelsUrl(), {
        method: 'GET',
        headers: this.headers(false),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
    } catch (e) {
      throw this.networkError(e);
    }
    if (!res.ok) {
      logRedactedProviderError(res, 'provider');
      throw new ProviderError(safeMessageFromStatus(res.status), 'PROVIDER_HTTP', res.status);
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? [])
      .map((m) => (typeof m?.id === 'string' ? m.id : ''))
      .filter((id) => id.length > 0)
      .sort();
  }

  async chatCompletion(
    req: ChatRequest,
  ): Promise<{ content: string; model: string; usage?: TokenUsage }> {
    let res: Response;
    try {
      res = await this.request(this.chatUrl(req.model, false), {
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
    if (!res.ok) {
      logRedactedProviderError(res, 'provider');
      throw new ProviderError(safeMessageFromStatus(res.status), 'PROVIDER_HTTP', res.status);
    }
    const body = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: unknown;
    };
    const content = body.choices?.[0]?.message?.content ?? '';
    return { content, model: body.model ?? req.model, usage: extractUsage(body.usage) };
  }

  chatCompletionStream(
    req: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
  ): ChatStreamHandle {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(new Error('timeout')), REQUEST_TIMEOUT_MS);
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
      }
    };
    const provider = createOpenAICompatible({
      name: 'nexnote-provider',
      baseURL:
        this.kind === 'azure-openai'
          ? `${this.base}/openai/deployments/${encodeURIComponent(req.model)}`
          : this.base,
      apiKey: this.apiKey,
      queryParams: this.kind === 'azure-openai' ? { 'api-version': this.apiVersion } : undefined,
      fetch: (input, init) => this.fetchImpl(input, { ...init, redirect: 'error' }),
      includeUsage: true,
    });
    const params = req.params;
    // ai@7 不再接受 messages 里的 system 角色（AI_InvalidPromptError）：
    // 主进程 gateway 会把 scenario system prompt / 参考上下文作为 system 消息注入，
    // 这里统一提取为 SDK 的 instructions，保持既有 wire 语义（system 在前）。
    const systemMessages = req.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .filter((content) => content.trim().length > 0);
    const conversation = req.messages.filter((message) => message.role !== 'system');
    const done = (async (): Promise<void> => {
      try {
        const result = streamText({
          model: provider.chatModel(req.model),
          ...(systemMessages.length > 0 ? { instructions: systemMessages.join('\n\n') } : {}),
          messages: conversation,
          ...(params?.temperature !== undefined && { temperature: params.temperature }),
          ...(params?.maxTokens !== undefined && { maxOutputTokens: params.maxTokens }),
          ...(params?.reasoningEffort && {
            providerOptions: { 'nexnote-provider': { reasoningEffort: params.reasoningEffort } },
          }),
          abortSignal: abort.signal,
          maxRetries: 0,
        });
        let streamFailed = false;
        for await (const part of result.fullStream) {
          if (part.type === 'error' || part.type === 'abort') streamFailed = true;
          this.emitSdkPart(part, req.model, onEvent);
        }
        if (streamFailed) return;
        const usage = await result.totalUsage;
        onEvent({
          type: 'done',
          ...((usage.inputTokens ?? 0) || (usage.outputTokens ?? 0) || (usage.totalTokens ?? 0)
            ? {
                usage: {
                  promptTokens: usage.inputTokens ?? 0,
                  completionTokens: usage.outputTokens ?? 0,
                  totalTokens: usage.totalTokens ?? 0,
                },
              }
            : {}),
        });
        finish();
      } catch (error) {
        finish();
        if (abort.signal.aborted) {
          onEvent({ type: 'error', message: '已取消', code: 'CANCELLED' });
        } else {
          const providerError = this.sdkError(error);
          onEvent({ type: 'error', message: providerError.message, code: providerError.code });
        }
      }
    })();
    return { abort: () => abort.abort(new Error('aborted')), done };
  }

  private emitSdkPart(
    part: { type: string; text?: string; error?: unknown },
    model: string,
    onEvent: (event: ChatStreamEvent) => void,
  ): void {
    switch (part.type) {
      case 'start':
      case 'start-step':
        onEvent({ type: 'start', model });
        break;
      case 'text-delta':
        if (part.text) onEvent({ type: 'delta', text: part.text });
        break;
      case 'reasoning-delta':
        if (part.text) onEvent({ type: 'reasoningDelta', text: part.text });
        break;
      case 'finish':
        break;
      case 'error':
        onEvent({ type: 'error', ...this.sdkError(part.error) });
        break;
      case 'abort':
        onEvent({ type: 'error', message: '已取消', code: 'CANCELLED' });
        break;
    }
  }

  private sdkError(error: unknown): { message: string; code: string } {
    const status =
      (error as { statusCode?: number })?.statusCode ?? (error as { status?: number })?.status;
    if (typeof status === 'number') {
      return { message: safeMessageFromStatus(status), code: 'PROVIDER_HTTP' };
    }
    // SDK 校验「流结束但没有 finish_reason」的截断语义，对应内部 STREAM_TRUNCATED。
    if (error instanceof Error && error.name === 'AI_InvalidResponseDataError') {
      return { message: '流式响应在收到完成标记前结束，请重试', code: 'STREAM_TRUNCATED' };
    }
    // Provider bodies are untrusted (may echo credentials or document content) and SDK error
    // messages can carry them; only the operation name enters logs, never the message.
    console.warn('[ai:chatStream] streaming failed before completion (details redacted)');
    return { message: '供应商流式请求失败，请稍后重试', code: 'STREAM_READ' };
  }

  async embeddings(req: EmbedRequest): Promise<EmbedResponse> {
    let res: Response;
    try {
      res = await this.request(this.embeddingsUrl(req.model), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ model: req.model, input: req.inputs }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw this.networkError(e);
    }
    if (!res.ok) {
      logRedactedProviderError(res, 'embeddings');
      throw new ProviderError(safeMessageFromStatus(res.status), 'PROVIDER_HTTP', res.status);
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
      if (d.embedding.length === 0) {
        throw new ProviderError('embeddings 返回空向量', 'BAD_EMBEDDING');
      }
      return d.embedding.map((value) => {
        const vector = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(vector)) {
          throw new ProviderError('embeddings 返回非有限数值', 'BAD_EMBEDDING');
        }
        return vector;
      });
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
