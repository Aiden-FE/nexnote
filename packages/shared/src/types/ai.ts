/** AI 层公共类型（DEV-009）。密钥永不出现在这些类型中——渲染层只见 hasApiKey。 */

/** 供应商协议种类。azure-openai 与 openai-compatible 传输同源，仅 URL/鉴权头不同。 */
export type AiProviderKind = 'openai-compatible' | 'azure-openai' | 'local-embedding';

/** 对话消息（OpenAI roles）。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 补全参数（Profile 默认值可被请求级覆盖）。 */
export interface ChatParams {
  temperature?: number;
  maxTokens?: number;
}

/** 供应商能力探测结果。 */
export interface ProviderCapabilities {
  /** 非流式 chat/completions 可用 */
  chat: boolean;
  /** 流式可用（内部事件协议） */
  streaming: boolean;
  /** embeddings 端点可用 */
  embeddings: boolean;
  /** tools/function-calling（OpenAI 协议默认 true，探测失败可降 false） */
  tools: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * 统一内部流事件协议：隔离 OpenAI/兼容服务的 SSE 差异。
 * 渲染层只消费该协议，不接触任何 provider 原生 SSE 格式。
 */
export type ChatStreamEvent =
  | { type: 'start'; model: string }
  | { type: 'delta'; text: string }
  | { type: 'reasoningDelta'; text: string }
  | { type: 'done'; usage?: TokenUsage }
  | { type: 'error'; message: string; code?: string };

/** 渲染层可见的 Profile 视图（无密钥明文）。 */
export interface AiProfileView {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  defaultModel: string;
  params: ChatParams;
  /** 密钥是否已配置（明文永不出主进程） */
  hasApiKey: boolean;
  /** 密钥存储方式：仅原生系统凭据库；JSON 只保存 account reference。 */
  keyStorage: 'system-credential';
  createdAt: number;
  updatedAt: number;
}

/** Profile 写入输入。apiKey 省略/undefined = 编辑时保留原值；null = 清除。 */
export interface AiProfileInput {
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  defaultModel: string;
  params?: ChatParams;
  /** One-shot credential submission token issued by the main process; never credential material. */
  credentialToken?: string;
  /** Explicitly remove the stored system credential. */
  clearCredential?: boolean;
}

/** 分功能指定：写作辅助 / 对话 / embedding 三处可分别指定 Profile + 模型。 */
export type AiFeatureKey = 'writing' | 'chat' | 'embedding';

/** embedding 距离度量（不得硬编码；指纹计入）。 */
export type EmbeddingMetric = 'cosine' | 'dotProduct' | 'euclidean';

export interface AiFeatureAssignment {
  profileId: string;
  model: string;
  /** embedding 专用：上次成功 embed 探测到的维度（未探测为 null） */
  dimensions?: number | null;
  /** embedding 专用：距离度量；缺省由实现按 Provider/模型决定（默认 cosine） */
  metric?: EmbeddingMetric;
}

export type AiFeatureAssignments = Record<AiFeatureKey, AiFeatureAssignment | null>;

/** 渲染层可见的 AI 配置全量状态。 */
export interface AiConfigState {
  profiles: AiProfileView[];
  defaultProfileId: string | null;
  features: AiFeatureAssignments;
  /** 无任何 Profile → AI 空态入口仍显示配置提示 */
  needsOnboarding: boolean;
  /** 首启动引导是否已被用户看过或跳过；只控制自动弹出，不影响 AI 空态。 */
  setupPromptDismissed: boolean;
  /** embedding 配置指纹（profileId:model:dimensions:metric）。变更 = 向量索引需重建 */
  embeddingFingerprint: string | null;
  /** embedding generation 单调递增；指纹每次变化 +1。DEV-011 以此标记索引重建 */
  embeddingGeneration: number;
}

/** 连通性测试目标：已保存 Profile（id）或未保存候选（向导测试）。 */
export interface AiConnectionTarget {
  profileId?: string;
  candidate?: {
    kind: AiProviderKind;
    baseUrl: string;
    /** One-shot main-process credential submission token. */
    credentialToken?: string;
    defaultModel?: string;
  };
}

export interface ConnectionTestResult {
  reachable: boolean;
  capabilities: ProviderCapabilities;
  models: string[];
  latencyMs: number;
  error?: string;
}

/** 单次补全结果（非流式）。 */
export interface ChatCompletionResult {
  content: string;
  model: string;
  usage?: TokenUsage;
}

/** embed 结果：向量按输入顺序对齐。 */
export interface EmbedResult {
  vectors: number[][];
  dimensions: number;
  model: string;
  profileId: string;
}

/** Profile 导出捆绑（永不含密钥）。 */
export interface AiProfileExportBundle {
  app: 'nexnote';
  kind: 'ai-profiles';
  version: 1;
  exportedAt: string;
  profiles: Array<{
    /** Export-scoped stable reference for default/feature assignment restoration. */
    id?: string;
    name: string;
    providerKind: AiProviderKind;
    baseUrl: string;
    defaultModel: string;
    params: ChatParams;
  }>;
  features: {
    writing: { profileRef?: string; name: string; model: string } | null;
    chat: { profileRef?: string; name: string; model: string } | null;
    embedding: {
      profileRef?: string;
      name: string;
      model: string;
      metric?: EmbeddingMetric;
    } | null;
  };
  defaultProfileRef?: string | null;
  defaultProfileName: string | null;
}
