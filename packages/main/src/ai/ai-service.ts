import { randomUUID } from 'node:crypto';
import type {
  AiConfigState,
  AiConnectionTarget,
  AiProfileInput,
  ChatCompletionResult,
  ChatMessage,
  ChatParams,
  ChatStreamEvent,
  ConnectionTestResult,
  EmbedResult,
  IpcEventChannel,
  IpcEventMap,
} from '@nexnote/shared';
import { OpenAIProtocolAdapter } from './provider/openai';
import { LocalEmbeddingAdapter } from './provider/local-embedding';
import type { ChatStreamHandle, ProviderAdapter } from './provider/types';
import { ProviderError } from './provider/types';
import type { AiStoredProfile, AiStore } from './ai-store';

/** embedding 分批默认：token 预算与每批条目上限（可用 tokenEstimator 覆盖）。 */
export const EMBED_DEFAULT_MAX_TOKENS_PER_BATCH = 8_192;
export const EMBED_MAX_ITEMS_PER_BATCH = 64;
/** 4 char/token 的保守估算（无真实 tokenizer 时的默认）。 */
export function defaultTokenEstimator(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Credential tokens are portable only within one normalized provider origin. */
function credentialOrigin(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new ProviderError('Base URL 必须是有效的 http(s) URL', 'BAD_BASE_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderError('Base URL 必须使用 http(s) 协议', 'BAD_BASE_URL');
  }
  if (url.username || url.password)
    throw new ProviderError('Base URL 不得包含凭据', 'BAD_BASE_URL');
  return `${url.protocol}//${url.host}`;
}

export interface AiServiceDeps {
  store: AiStore;
  /** 主进程 → 渲染层事件推送（ai:streamEvent / ai:configChanged） */
  sendEvent<C extends IpcEventChannel>(channel: C, payload: IpcEventMap[C]): void;
  /** 注入 fetch（mock 服务器测试）。缺省用全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** embedding token 估算器（按模型 token limit 分批；可注入真实 tokenizer）。 */
  embedTokenEstimator?: (text: string) => number;
}

interface ResolvedTarget {
  profile: AiStoredProfile;
  adapter: ProviderAdapter;
  model: string;
  params: ChatParams;
}

/** embed 分批策略：顺序切块，批内不跨条目拆分。 */
export function splitEmbedBatches(
  texts: string[],
  maxTokens = EMBED_DEFAULT_MAX_TOKENS_PER_BATCH,
  maxItems = EMBED_MAX_ITEMS_PER_BATCH,
  estimateTokens: (text: string) => number = defaultTokenEstimator,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const text of texts) {
    // Never split an input: a single over-budget item occupies its own batch.
    const itemTokens = Math.max(1, estimateTokens(text));
    if (current.length >= maxItems || (tokens + itemTokens > maxTokens && current.length > 0)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(text);
    tokens += itemTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * AI 组装层：Profile 解析 → Adapter 获取 → 统一业务 API（chat / stream / embed / test）。
 * 所有网络请求都发生在主进程 node 网络栈；渲染层只收脱敏事件与结果。
 */
export class AiService {
  private readonly streams = new Map<string, { abort(): void; done: Promise<void> }>();
  /** Renderer-submitted credentials: opaque-token keyed, main-process only, short lived. */
  private readonly pendingCredentials = new Map<
    string,
    { secret: string; origin: string; expiresAt: number }
  >();

  constructor(private readonly deps: AiServiceDeps) {}

  private createAdapter(profile: AiStoredProfile): ProviderAdapter {
    if (profile.kind === 'local-embedding') return new LocalEmbeddingAdapter();
    return new OpenAIProtocolAdapter({
      baseUrl: profile.baseUrl,
      apiKey: this.deps.store.getApiKey(profile.id),
      kind: profile.kind,
      fetchImpl: this.deps.fetchImpl,
    });
  }

  /** 解析目标：显式 profileId > feature 指定 > 全局默认。 */
  private resolve(options: {
    profileId?: string;
    feature?: 'writing' | 'chat' | 'embedding';
    model?: string;
    params?: ChatParams;
  }): ResolvedTarget {
    const state = this.deps.store.get();
    let profile: AiStoredProfile | undefined;
    if (options.profileId) profile = this.deps.store.getProfile(options.profileId);
    if (!profile && options.feature) {
      const assignment = state.features[options.feature];
      if (assignment) profile = this.deps.store.getProfile(assignment.profileId);
    }
    if (!profile && state.defaultProfileId) {
      profile = this.deps.store.getProfile(state.defaultProfileId);
      if (options.feature === 'chat' && profile?.kind === 'local-embedding') profile = undefined;
    }
    if (!profile) {
      throw new ProviderError(
        '未配置 AI Profile（或指定 Profile 不存在），请先完成 AI 引导',
        'AI_NOT_CONFIGURED',
      );
    }

    let model = options.model?.trim();
    if (!model && options.feature) {
      const assignment = state.features[options.feature];
      if (assignment?.profileId === profile.id) model = assignment.model;
    }
    model = model || profile.defaultModel;

    return {
      profile,
      adapter: this.createAdapter(profile),
      model,
      params: { ...profile.params, ...options.params },
    };
  }

  // ── 配置 ────────────────────────────────────────────

  submitCredential(secret: string, baseUrl: string): string {
    if (!secret.trim()) throw new ProviderError('凭据不能为空', 'BAD_REQUEST');
    this.sweepCredentials();
    const token = randomUUID();
    this.pendingCredentials.set(token, {
      secret,
      origin: credentialOrigin(baseUrl),
      expiresAt: Date.now() + 10 * 60_000,
    });
    return token;
  }

  private credential(
    token: string | undefined,
    context: { origin: string; consume?: boolean },
  ): string | undefined {
    if (!token) return undefined;
    this.sweepCredentials();
    const pending = this.pendingCredentials.get(token);
    if (!pending) throw new ProviderError('凭据提交已过期，请重新输入', 'CREDENTIAL_EXPIRED');
    if (pending.origin !== context.origin) {
      throw new ProviderError('凭据目标不一致，请重新输入', 'CREDENTIAL_SCOPE_MISMATCH');
    }
    if (context.consume) this.pendingCredentials.delete(token);
    return pending.secret;
  }

  private sweepCredentials(): void {
    const now = Date.now();
    for (const [token, pending] of this.pendingCredentials) {
      if (pending.expiresAt <= now) this.pendingCredentials.delete(token);
    }
  }

  getState(): AiConfigState {
    return this.deps.store.getState();
  }

  private emitConfigChanged(): void {
    this.deps.sendEvent('ai:configChanged', { state: this.deps.store.getState() });
  }

  saveProfile(id: string | undefined, input: AiProfileInput): { id: string; state: AiConfigState } {
    const apiKey = input.credentialToken
      ? this.credential(input.credentialToken, {
          origin: credentialOrigin(input.baseUrl),
          consume: true,
        })
      : undefined;
    const saved = this.deps.store.saveProfile(id, {
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      defaultModel: input.defaultModel,
      params: input.params,
      apiKey: input.clearCredential ? null : apiKey,
    });
    this.emitConfigChanged();
    return { id: saved.id, state: this.deps.store.getState() };
  }

  deleteProfile(id: string): { state: AiConfigState } {
    this.deps.store.deleteProfile(id);
    this.emitConfigChanged();
    return { state: this.deps.store.getState() };
  }

  setDefaultProfile(id: string): { state: AiConfigState } {
    this.deps.store.setDefaultProfile(id);
    this.emitConfigChanged();
    return { state: this.deps.store.getState() };
  }

  setFeatureAssignment(
    feature: 'writing' | 'chat' | 'embedding',
    assignment: { profileId: string; model: string; dimensions?: number | null } | null,
  ): { state: AiConfigState } {
    this.deps.store.setFeatureAssignment(feature, assignment);
    this.emitConfigChanged();
    return { state: this.deps.store.getState() };
  }

  dismissSetupPrompt(): { state: AiConfigState } {
    this.deps.store.dismissSetupPrompt();
    this.emitConfigChanged();
    return { state: this.deps.store.getState() };
  }

  // ── 连通性 / 模型 ──────────────────────────────────

  /**
   * 解析测试目标：
   * - candidate 可与 profileId 同时出现（编辑场景），使用候选 kind/baseUrl/model；
   * - candidate 仅在 kind/baseUrl 与已保存 Profile 完全一致时可复用已存密钥；编辑 URL 必须提交新凭据；
   * - 纯 profileId 则测试完整已保存配置。
   */
  private targetAdapter(target: AiConnectionTarget): {
    adapter: ProviderAdapter;
    defaultModel: string;
  } {
    const saved = target.profileId ? this.deps.store.getProfile(target.profileId) : undefined;
    if (target.profileId && !saved) {
      throw new ProviderError(`Profile 不存在: ${target.profileId}`, 'PROFILE_NOT_FOUND');
    }
    if (target.candidate) {
      const c = target.candidate;
      return {
        adapter:
          c.kind === 'local-embedding'
            ? new LocalEmbeddingAdapter()
            : new OpenAIProtocolAdapter({
                baseUrl: c.baseUrl,
                apiKey:
                  this.credential(c.credentialToken, {
                    origin: credentialOrigin(c.baseUrl),
                  }) ??
                  (saved &&
                  saved.kind === c.kind &&
                  saved.baseUrl === c.baseUrl.trim().replace(/\/+$/, '')
                    ? this.deps.store.getApiKey(saved.id)
                    : ''),
                kind: c.kind,
                fetchImpl: this.deps.fetchImpl,
              }),
        defaultModel: c.defaultModel ?? saved?.defaultModel ?? '',
      };
    }
    if (saved) {
      return { adapter: this.createAdapter(saved), defaultModel: saved.defaultModel };
    }
    throw new ProviderError('测试目标缺失（profileId 或 candidate）', 'BAD_REQUEST');
  }

  async listModels(target: AiConnectionTarget): Promise<string[]> {
    return this.targetAdapter(target).adapter.listModels();
  }

  /**
   * 连通性测试 + capabilities 独立探测：
   * 1. GET /models（best-effort；失败不阻断——Azure 部分部署不可列模型）
   * 2. 非流式 chat、SSE streaming、tools/function-calling 分别发送最小请求实测
   * 3. 模型列表含 embed 类模型 → 最小 embeddings 请求实测（得到维度）
   */
  async testConnection(target: AiConnectionTarget): Promise<ConnectionTestResult> {
    const { adapter, defaultModel } = this.targetAdapter(target);
    return adapter.testConnection(defaultModel);
  }

  // ── 对话 ────────────────────────────────────────────

  async chatCompletion(options: {
    messages: ChatMessage[];
    profileId?: string;
    feature?: 'writing' | 'chat' | 'embedding';
    model?: string;
    params?: ChatParams;
  }): Promise<ChatCompletionResult> {
    const { adapter, model, params } = this.resolve(options);
    return adapter.chatCompletion({ model, messages: options.messages, params });
  }

  /** Main-process-only stream seam consumed by AgentGateway; never exposed through IPC. */
  openChatStream(
    options: {
      messages: ChatMessage[];
      profileId?: string;
      feature?: 'writing' | 'chat' | 'embedding';
      model?: string;
      params?: ChatParams;
    },
    onEvent: (event: ChatStreamEvent) => void,
  ): ChatStreamHandle {
    const { adapter, model, params } = this.resolve(options);
    return adapter.chatCompletionStream({ model, messages: options.messages, params }, onEvent);
  }

  /**
   * 启动流式补全（主进程内部使用，AgentGateway 是唯一调用方）：
   * streamId 立即返回，事件经回调推送，支持取消与活跃计数（审计/测试用）。
   */
  startChatStream(
    options: {
      messages: ChatMessage[];
      profileId?: string;
      feature?: 'writing' | 'chat' | 'embedding';
      model?: string;
      params?: ChatParams;
    },
    onEvent?: (event: ChatStreamEvent) => void,
  ): string {
    const streamId = randomUUID();
    const handle = this.openChatStream(options, (event) => {
      if (onEvent) onEvent(event);
      this.deps.sendEvent('ai:streamEvent', { streamId, event });
    });
    this.streams.set(streamId, handle);
    void handle.done.finally(() => this.streams.delete(streamId));
    return streamId;
  }

  cancelChatStream(streamId: string): boolean {
    const handle = this.streams.get(streamId);
    if (!handle) return false;
    handle.abort();
    return true;
  }

  activeStreamCount(): number {
    return this.streams.size;
  }

  // ── Embedding ───────────────────────────────────────

  /**
   * 公共 embed 接口（规格对齐：`embed(texts: string[]) → number[][]`）。
   * embedding 分功能指定（缺省回退默认 Profile 的 embed 模型）。
   * 按 token 预算自动分批；维度探测成功后回写（指纹/generation 变更检测）。
   */
  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.embedWithMetadata(texts);
    return res.vectors;
  }

  /**
   * 内部 embed 全量返回（含 metadata）。供 IPC 与需要 model/dimensions/profileId 的业务方用。
   * 维度回写 + configChanged 事件在此统一触发。
   */
  async embedWithMetadata(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      throw new ProviderError('embed 输入不能为空', 'BAD_REQUEST');
    }
    const { profile, adapter, model } = this.resolve({ feature: 'embedding' });

    const batches = splitEmbedBatches(
      texts,
      EMBED_DEFAULT_MAX_TOKENS_PER_BATCH,
      EMBED_MAX_ITEMS_PER_BATCH,
      this.deps.embedTokenEstimator ?? defaultTokenEstimator,
    );
    const vectors: number[][] = [];
    for (const batch of batches) {
      const res = await adapter.embeddings({ model, inputs: batch });
      vectors.push(...res.vectors);
    }

    const dimensions = vectors[0]?.length ?? 0;
    if (dimensions === 0) throw new ProviderError('embeddings 返回空向量', 'BAD_EMBEDDING');
    if (vectors.some((v) => v.length !== dimensions)) {
      throw new ProviderError('embeddings 返回维度不一致', 'BAD_EMBEDDING');
    }

    // 维度回写 → embedding 指纹/generation 变更检测（索引重建标记，DEV-011 消费）
    // 仅在 state 实际变化时广播 ai:configChanged，保证已打开窗口同步 dimensions/generation
    const changed = this.deps.store.recordEmbeddingDimensions(dimensions);
    if (changed) this.emitConfigChanged();

    return { vectors, dimensions, model, profileId: profile.id };
  }

  // ── 导入/导出 ───────────────────────────────────────

  exportProfiles(): { json: string; count: number } {
    const bundle = this.deps.store.exportBundle();
    return { json: `${JSON.stringify(bundle, null, 2)}\n`, count: bundle.profiles.length };
  }

  importProfiles(json: string): { imported: number; skipped: string[]; state: AiConfigState } {
    let bundle: unknown;
    try {
      bundle = JSON.parse(json);
    } catch {
      throw new ProviderError('导入文件不是合法 JSON', 'BAD_IMPORT');
    }
    if (
      typeof bundle !== 'object' ||
      bundle === null ||
      (bundle as { app?: string }).app !== 'nexnote' ||
      (bundle as { kind?: string }).kind !== 'ai-profiles'
    ) {
      throw new ProviderError('导入文件不是 NexNote AI Profile 导出格式', 'BAD_IMPORT');
    }
    const result = this.deps.store.importBundle(bundle as Parameters<AiStore['importBundle']>[0]);
    this.emitConfigChanged();
    return { ...result, state: this.deps.store.getState() };
  }
}
