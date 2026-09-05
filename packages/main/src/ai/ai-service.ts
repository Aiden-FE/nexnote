import { randomUUID } from 'node:crypto';
import type {
  AiConfigState,
  AiConnectionTarget,
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
import type { ProviderAdapter } from './provider/types';
import { ProviderError } from './provider/types';
import type { AiStoredProfile, AiStore } from './ai-store';

/** embedding 分批上限（保守：约 6k token/批 + 每批最多条目）。 */
const EMBED_MAX_CHARS_PER_BATCH = 24_000;
const EMBED_MAX_ITEMS_PER_BATCH = 64;

export interface AiServiceDeps {
  store: AiStore;
  /** 主进程 → 渲染层事件推送（ai:streamEvent / ai:configChanged） */
  sendEvent<C extends IpcEventChannel>(channel: C, payload: IpcEventMap[C]): void;
  /** 注入 fetch（mock 服务器测试）。缺省用全局 fetch。 */
  fetchImpl?: typeof fetch;
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
  maxChars = EMBED_MAX_CHARS_PER_BATCH,
  maxItems = EMBED_MAX_ITEMS_PER_BATCH,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const text of texts) {
    if (current.length >= maxItems || (chars + text.length > maxChars && current.length > 0)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
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

  constructor(private readonly deps: AiServiceDeps) {}

  private createAdapter(profile: AiStoredProfile): ProviderAdapter {
    return new OpenAIProtocolAdapter({
      baseUrl: profile.baseUrl,
      apiKey: this.deps.store.getApiKey(profile.id),
      kind: profile.kind,
      fetchImpl: this.deps.fetchImpl,
    });
  }

  /** 解析目标：显式 profileId > feature 指定 > 全局默认。 */
  private resolve(options: { profileId?: string; feature?: 'writing' | 'chat' | 'embedding'; model?: string; params?: ChatParams }): ResolvedTarget {
    const state = this.deps.store.get();
    let profile: AiStoredProfile | undefined;
    if (options.profileId) profile = this.deps.store.getProfile(options.profileId);
    if (!profile && options.feature) {
      const assignment = state.features[options.feature];
      if (assignment) profile = this.deps.store.getProfile(assignment.profileId);
    }
    if (!profile && state.defaultProfileId) profile = this.deps.store.getProfile(state.defaultProfileId);
    if (!profile) {
      throw new ProviderError('未配置 AI Profile（或指定 Profile 不存在），请先完成 AI 引导', 'AI_NOT_CONFIGURED');
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

  getState(): AiConfigState {
    return this.deps.store.getState();
  }

  private emitConfigChanged(): void {
    this.deps.sendEvent('ai:configChanged', { state: this.deps.store.getState() });
  }

  saveProfile(id: string | undefined, input: Parameters<AiStore['saveProfile']>[1]): { id: string; state: AiConfigState } {
    const saved = this.deps.store.saveProfile(id, input);
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

  // ── 连通性 / 模型 ──────────────────────────────────

  /** 解析测试目标：candidate 直接构 adapter；profileId 取已保存（解密密钥）。 */
  private targetAdapter(target: AiConnectionTarget): { adapter: ProviderAdapter; defaultModel: string } {
    if (target.profileId) {
      const profile = this.deps.store.getProfile(target.profileId);
      if (!profile) throw new ProviderError(`Profile 不存在: ${target.profileId}`, 'PROFILE_NOT_FOUND');
      return { adapter: this.createAdapter(profile), defaultModel: profile.defaultModel };
    }
    if (target.candidate) {
      const c = target.candidate;
      return {
        adapter: new OpenAIProtocolAdapter({
          baseUrl: c.baseUrl,
          apiKey: c.apiKey ?? '',
          kind: c.kind,
          fetchImpl: this.deps.fetchImpl,
        }),
        defaultModel: c.defaultModel ?? '',
      };
    }
    throw new ProviderError('测试目标缺失（profileId 或 candidate）', 'BAD_REQUEST');
  }

  async listModels(target: AiConnectionTarget): Promise<string[]> {
    return this.targetAdapter(target).adapter.listModels();
  }

  /**
   * 连通性测试 + capabilities 探测：
   * 1. GET /models（best-effort；失败不阻断——Azure 部分部署不可列模型）
   * 2. 有可用对话模型 → 最小 chat 请求实测（max_tokens=1）
   * 3. 模型列表含 embed 类模型 → 最小 embeddings 请求实测（得到维度）
   */
  async testConnection(target: AiConnectionTarget): Promise<ConnectionTestResult> {
    const started = Date.now();
    const { adapter, defaultModel } = this.targetAdapter(target);
    const declared = adapter.declaredCapabilities();

    let models: string[] = [];
    try {
      models = await adapter.listModels();
    } catch {
      // 列模型失败不视为不可达（部分网关禁用 /models）；继续 chat 实测
    }

    const chatModel =
      defaultModel || models.find((m) => !m.toLowerCase().includes('embed')) || '';
    const chatOk = await this.probeChat(adapter, chatModel);

    const embeddingModel = models.find((m) => m.toLowerCase().includes('embed')) ?? '';
    const embeddingProbe = embeddingModel
      ? await this.probeEmbeddings(adapter, embeddingModel)
      : null;

    const reachable = chatOk || models.length > 0;
    const result: ConnectionTestResult = {
      reachable,
      capabilities: {
        chat: chatOk || (!chatModel && models.length > 0),
        streaming: chatOk || models.length > 0,
        embeddings: embeddingProbe !== null,
        tools: declared.tools && chatOk,
      },
      models,
      latencyMs: Date.now() - started,
    };
    if (!reachable) {
      result.error = '无法连接供应商（模型列表与对话探测均失败），请检查 base-url / 密钥 / 网络';
    }
    return result;
  }

  private async probeChat(adapter: ProviderAdapter, model: string): Promise<boolean> {
    if (!model) return false;
    try {
      await adapter.chatCompletion({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        params: { maxTokens: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }

  private async probeEmbeddings(
    adapter: ProviderAdapter,
    model: string,
  ): Promise<{ dimensions: number } | null> {
    try {
      const res = await adapter.embeddings({ model, inputs: ['ping'] });
      return { dimensions: res.vectors[0]?.length ?? 0 };
    } catch {
      return null;
    }
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

  /** 启动流式补全：streamId 立即返回，统一事件经 ai:streamEvent 推送。 */
  startChatStream(options: {
    messages: ChatMessage[];
    profileId?: string;
    feature?: 'writing' | 'chat' | 'embedding';
    model?: string;
    params?: ChatParams;
  }): string {
    const { adapter, model, params } = this.resolve(options);
    const streamId = randomUUID();
    const send = (event: ChatStreamEvent): void => {
      this.deps.sendEvent('ai:streamEvent', { streamId, event });
    };
    const handle = adapter.chatCompletionStream({ model, messages: options.messages, params }, send);
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
   * 统一 embed 接口：embedding 分功能指定（缺省回退默认 Profile 的 embed 模型）。
   * 按 token 预算自动分批；维度探测成功后回写（指纹/generation 变更检测）。
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      throw new ProviderError('embed 输入不能为空', 'BAD_REQUEST');
    }
    const { profile, adapter, model } = this.resolve({ feature: 'embedding' });

    const batches = splitEmbedBatches(texts);
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
    this.deps.store.recordEmbeddingDimensions(dimensions);

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
