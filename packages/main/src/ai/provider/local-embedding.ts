import { createHash } from 'node:crypto';
import { tCurrent, type ChatStreamEvent, type ProviderCapabilities } from '@nexnote/shared';
import {
  ProviderError,
  type ChatRequest,
  type ChatStreamHandle,
  type EmbedRequest,
  type EmbedResponse,
  type ProviderAdapter,
} from './types';

/**
 * Functional, dependency-free local embedding backend. It produces deterministic signed hashing
 * vectors locally (no network, no credentials) and is selectable as `local-hash-384` by the
 * embedding pipeline. A semantic ONNX model can replace this backend without changing the contract.
 */
export class LocalEmbeddingAdapter implements ProviderAdapter {
  readonly kind = 'openai-compatible' as const;
  readonly baseUrl = 'local://embedding';
  static readonly model = 'local-hash-384';
  static readonly dimensions = 384;

  declaredCapabilities(): ProviderCapabilities {
    return { chat: false, streaming: false, embeddings: true, tools: false };
  }

  async testConnection(_defaultModel?: string) {
    return {
      reachable: true,
      capabilities: this.declaredCapabilities(),
      models: [LocalEmbeddingAdapter.model],
      latencyMs: 0,
    };
  }

  async chatCompletion(_req: ChatRequest): Promise<{ content: string; model: string }> {
    throw new ProviderError(tCurrent('ai.error.LOCAL_EMBEDDING_NO_CHAT'), 'UNSUPPORTED_CAPABILITY');
  }

  chatCompletionStream(
    _req: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
  ): ChatStreamHandle {
    onEvent({
      type: 'error',
      message: tCurrent('ai.error.LOCAL_EMBEDDING_NO_CHAT'),
      code: 'UNSUPPORTED_CAPABILITY',
    });
    return { abort: () => undefined, done: Promise.resolve() };
  }

  async embeddings(req: EmbedRequest): Promise<EmbedResponse> {
    if (req.model !== LocalEmbeddingAdapter.model) {
      throw new ProviderError(
        tCurrent('ai.error.LOCAL_EMBEDDING_UNKNOWN_MODEL', { model: req.model }),
        'MODEL_NOT_FOUND',
      );
    }
    return { vectors: req.inputs.map((text) => this.embedText(text)), model: req.model };
  }

  async listModels(): Promise<string[]> {
    return [LocalEmbeddingAdapter.model];
  }

  private embedText(text: string): number[] {
    const vector = new Array<number>(LocalEmbeddingAdapter.dimensions).fill(0);
    for (const token of text.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []) {
      const digest = createHash('sha256').update(token).digest();
      const index = digest.readUInt16BE(0) % vector.length;
      vector[index] = (vector[index] ?? 0) + (digest[2]! & 1 ? 1 : -1);
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  }
}
