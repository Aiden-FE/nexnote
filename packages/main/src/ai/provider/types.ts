import type {
  ChatMessage,
  ChatParams,
  ChatStreamEvent,
  ProviderCapabilities,
  TokenUsage,
} from '@nexnote/shared';
import type { AiProviderKind } from '@nexnote/shared';

/** Provider 适配层错误：携带可读消息 + 稳定 code（渲染层重试提示用）。 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** HTTP 状态码（网络层错误时无） */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** 适配器统一请求（模型解析已在 AiService 完成）。 */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  params?: ChatParams;
}

export interface ChatStreamHandle {
  /** 请求中止（幂等；中止后流以 error(CANCELLED) 事件收尾） */
  abort(): void;
  /** 流自然结束（done/error 已发出）。abort 后也会 resolve */
  done: Promise<void>;
}

export interface EmbedRequest {
  model: string;
  inputs: string[];
}

export interface EmbedResponse {
  vectors: number[][];
  model: string;
  usage?: TokenUsage;
}

/**
 * Provider Adapter 接口（DEV-009 自有协议面）。
 * 新供应商 = 新增实现（如 anthropic.ts）；渲染层与业务层只依赖本接口。
 * 本地小模型 embedding 的预留位：后续以独立 EmbeddingAdapter 实现接入（DEV-011 降级路径）。
 */
export interface ProviderAdapter {
  readonly kind: AiProviderKind;
  readonly baseUrl: string;

  chatCompletion(req: ChatRequest): Promise<{ content: string; model: string; usage?: TokenUsage }>;

  /** 启动流式补全：立即返回 handle，事件异步送达 onEvent。 */
  chatCompletionStream(req: ChatRequest, onEvent: (event: ChatStreamEvent) => void): ChatStreamHandle;

  embeddings(req: EmbedRequest): Promise<EmbedResponse>;

  listModels(): Promise<string[]>;

  /** Adapter 级连通性/能力探测（最小协议实测；AiService 再封装为 Profile/candidate API）。 */
  testConnection(defaultModel?: string): Promise<{
    reachable: boolean;
    capabilities: ProviderCapabilities;
    models: string[];
    latencyMs: number;
    error?: string;
  }>;

  /** 协议级能力声明（tools 等）；连接相关能力由 testConnection 实测 */
  declaredCapabilities(): ProviderCapabilities;
}

export interface AdapterOptions {
  baseUrl: string;
  apiKey: string;
  kind: AiProviderKind;
  /** Azure api-version（默认 2024-10-21） */
  apiVersion?: string;
  /** 注入 fetch（测试/mock 用；默认全局 fetch） */
  fetchImpl?: typeof fetch;
}
