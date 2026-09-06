import type { ChatStreamEvent, ProviderCapabilities } from '@nexnote/shared';
import {
  ProviderError,
  type ChatRequest,
  type ChatStreamHandle,
  type EmbedRequest,
  type EmbedResponse,
  type ProviderAdapter,
} from './types';

/**
 * 本地 embedding 模型预留适配器（DEV-011 召回管道降级路径）。
 *
 * 设计预留：当在线 embedding 不可用或用户选择本地小模型时，
 * 该适配器将承载本地推理（如 onnxruntime-web 的 bge-small 等）。
 * 当前阶段所有方法均抛 `NOT_IMPLEMENTED`，仅作为明确的 seam / 降级接口存在。
 *
 * 构造函数不依赖任何外部二进制；接入时在此处加载本地模型。
 */
export class LocalEmbeddingAdapter implements ProviderAdapter {
  readonly kind = 'openai-compatible' as const;
  readonly baseUrl = 'local://embedding';

  private notImplemented(): never {
    throw new ProviderError('本地 embedding 模型未接入', 'NOT_IMPLEMENTED');
  }

  declaredCapabilities(): ProviderCapabilities {
    // 预留：本地 embedding 只提供 embeddings 能力
    return { chat: false, streaming: false, embeddings: true, tools: false };
  }

  async testConnection(_defaultModel?: string): Promise<{
    reachable: boolean;
    capabilities: ProviderCapabilities;
    models: string[];
    latencyMs: number;
    error?: string;
  }> {
    return {
      reachable: false,
      capabilities: { chat: false, streaming: false, embeddings: false, tools: false },
      models: [],
      latencyMs: 0,
      error: '本地 embedding 模型未接入',
    };
  }

  async chatCompletion(_req: ChatRequest): Promise<{ content: string; model: string }> {
    this.notImplemented();
  }

  chatCompletionStream(
    _req: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
  ): ChatStreamHandle {
    // 预留 seam：以统一内部事件协议报"未接入"，而非抛异常
    const err = new ProviderError('本地 embedding 模型未接入', 'NOT_IMPLEMENTED');
    onEvent({ type: 'error', message: err.message, code: err.code });
    return { abort: () => undefined, done: Promise.resolve() };
  }

  async embeddings(_req: EmbedRequest): Promise<EmbedResponse> {
    this.notImplemented();
  }

  async listModels(): Promise<string[]> {
    return [];
  }
}
