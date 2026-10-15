import type { Result } from '../result';
import type {
  AiConfigState,
  AiConnectionTarget,
  AiFeatureAssignment,
  AiFeatureKey,
  AiProfileExportBundle,
  AiProfileInput,
  BuiltInEmbeddingStatus,
  ConnectionTestResult,
  EmbedResult,
} from '../../types/ai';
import type { RetrievalOptions, RetrievalResponse } from '../../types/retrieval';

/**
 * ai:* 命名空间（DEV-009 Provider Adapter 与配置系统）。
 * 密钥安全契约：任何 response/event payload 都不含密钥明文——渲染层只见 hasApiKey。
 *
 * 模型执行通道已收敛到 agent:*（AgentGateway 是唯一执行入口）：
 * ai:chat:* 不再暴露给渲染层；本命名空间仅保留配置 / 连通性 / embedding / 召回。
 */
export const AI_CHANNELS = [
  'ai:ping',
  'ai:getState',
  'ai:credential:submit',
  'ai:profile:save',
  'ai:profile:delete',
  'ai:profile:setDefault',
  'ai:features:set',
  'ai:translation:setTargetLanguage',
  'ai:setupPrompt:dismiss',
  'ai:testConnection',
  'ai:listModels',
  'ai:embed',
  'ai:embedWithMetadata',
  'ai:retrieve',
  'ai:builtInEmbedding:status',
  'ai:builtInEmbedding:download',
  'ai:builtInEmbedding:delete',
  'ai:cancelRetrievalBuild',
  'ai:export',
  'ai:import',
] as const;

export type AiChannel = (typeof AI_CHANNELS)[number];

export interface AiChannelMap {
  'ai:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'ai'; implementedBy: 'DEV-009' }>;
  };
  'ai:getState': {
    request: void;
    response: Result<AiConfigState>;
  };
  /** Input-only credential boundary. No retrieve channel exists; response contains only an opaque token. */
  'ai:credential:submit': {
    request: { secret: string; baseUrl: string };
    response: Result<{ credentialToken: string }>;
  };
  'ai:profile:save': {
    request: { id?: string; profile: AiProfileInput };
    response: Result<{ id: string; state: AiConfigState }>;
  };
  'ai:profile:delete': {
    request: { id: string };
    response: Result<{ state: AiConfigState }>;
  };
  'ai:profile:setDefault': {
    request: { id: string };
    response: Result<{ state: AiConfigState }>;
  };
  'ai:features:set': {
    request: { feature: AiFeatureKey; assignment: AiFeatureAssignment | null };
    response: Result<{ state: AiConfigState }>;
  };
  'ai:translation:setTargetLanguage': {
    request: { targetLanguage: string };
    response: Result<{ state: AiConfigState }>;
  };
  /** 用户已看过/跳过首启动 AI 引导；此后未配置入口一律跳设置页，不再自动弹向导。 */
  'ai:setupPrompt:dismiss': {
    request: void;
    response: Result<{ state: AiConfigState }>;
  };
  'ai:testConnection': {
    request: AiConnectionTarget;
    response: Result<ConnectionTestResult>;
  };
  'ai:listModels': {
    request: AiConnectionTarget;
    response: Result<{ models: string[] }>;
  };
  'ai:embed': {
    request: { texts: string[] };
    /** 公共口径：与规格 `embed(texts: string[]): Promise<number[][]>` 对齐。 */
    response: Result<number[][]>;
  };
  'ai:embedWithMetadata': {
    request: { texts: string[] };
    /** 元数据通道：返回 dimensions/model/profileId，DEV-011 召回管道使用。 */
    response: Result<EmbedResult>;
  };
  'ai:retrieve': {
    request: RetrievalOptions;
    response: Result<RetrievalResponse>;
  };
  /** 内置语义向量缓存状态：当前固定 revision、各文件校验结果与运行态。 */
  'ai:builtInEmbedding:status': {
    request: void;
    response: Result<BuiltInEmbeddingStatus>;
  };
  /**
   * 按需下载固定 revision 的模型文件。立即返回 started=true，
   * 进度与终态通过 `ai:builtInEmbeddingStatus` 事件推送，避免 IPC 长阻塞。
   */
  'ai:builtInEmbedding:download': {
    request: void;
    response: Result<{ started: true }>;
  };
  /** 删除派生缓存（应用数据目录，非 vault），可重新下载。 */
  'ai:builtInEmbedding:delete': {
    request: void;
    response: Result<{ deleted: true }>;
  };
  /** 请求取消当前后台向量索引构建；若无构建任务则返回 cancelled:false。 */
  'ai:cancelRetrievalBuild': {
    request: void;
    response: Result<{ cancelled: boolean }>;
  };
  'ai:export': {
    request: void;
    response: Result<{ json: string; count: number }>;
  };
  'ai:import': {
    request: { json: string };
    response: Result<{ imported: number; skipped: string[]; state: AiConfigState }>;
  };
}

export type { AiProfileExportBundle };
