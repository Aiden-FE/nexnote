import type { Result } from '../result';
import type {
  AiConfigState,
  AiConnectionTarget,
  AiFeatureAssignment,
  AiFeatureKey,
  AiProfileExportBundle,
  AiProfileInput,
  ChatCompletionResult,
  ChatMessage,
  ChatParams,
  ConnectionTestResult,
  EmbedResult,
} from '../../types/ai';

/**
 * ai:* 命名空间（DEV-009 Provider Adapter 与配置系统；DEV-010/011/012 在此追加业务通道）。
 * 密钥安全契约：任何 response/event payload 都不含密钥明文——渲染层只见 hasApiKey。
 */
export const AI_CHANNELS = [
  'ai:ping',
  'ai:getState',
  'ai:profile:save',
  'ai:profile:delete',
  'ai:profile:setDefault',
  'ai:features:set',
  'ai:testConnection',
  'ai:listModels',
  'ai:chat:complete',
  'ai:chat:stream:start',
  'ai:chat:stream:cancel',
  'ai:embed',
  'ai:embedWithMetadata',
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
  'ai:testConnection': {
    request: AiConnectionTarget;
    response: Result<ConnectionTestResult>;
  };
  'ai:listModels': {
    request: AiConnectionTarget;
    response: Result<{ models: string[] }>;
  };
  'ai:chat:complete': {
    request: {
      messages: ChatMessage[];
      /** 解析优先级：profileId > feature > 全局默认 */
      profileId?: string;
      feature?: AiFeatureKey;
      model?: string;
      params?: ChatParams;
    };
    response: Result<ChatCompletionResult>;
  };
  'ai:chat:stream:start': {
    request: {
      messages: ChatMessage[];
      profileId?: string;
      feature?: AiFeatureKey;
      model?: string;
      params?: ChatParams;
    };
    response: Result<{ streamId: string }>;
  };
  'ai:chat:stream:cancel': {
    request: { streamId: string };
    response: Result<{ cancelled: boolean }>;
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
