import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  AiConfigState,
  AiFeatureAssignment,
  AiFeatureKey,
  AiProfileExportBundle,
  AiProfileInput,
  AiProfileView,
  AiProviderKind,
  EmbeddingMetric,
} from '@nexnote/shared';
import {
  decryptLegacySafeStorage,
  newSecretAccount,
  SecretStorageUnavailableError,
  type SafeStorageLike,
  type SecretVault,
} from './secret-store';

/** 主进程持久化形态：keyBlob 是 OS credential vault 的不透明 account reference，绝不含密钥字节。 */
export interface AiStoredProfile {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  defaultModel: string;
  params: { temperature?: number; maxTokens?: number };
  /** Opaque OS credential account; never a secret or encrypted blob. */
  keyBlob: string | null;
  keyStorage: 'system-credential';
  createdAt: number;
  updatedAt: number;
}

export interface AiStoreData {
  version: 1;
  profiles: AiStoredProfile[];
  defaultProfileId: string | null;
  features: Record<AiFeatureKey, AiFeatureAssignment | null>;
  /** 用户已看过或跳过首启动 AI 引导；不进入导出捆绑。 */
  setupPromptDismissed: boolean;
  /** embedding 配置指纹（profileId:model:dimensions:metric） */
  embeddingFingerprint: string | null;
  embeddingGeneration: number;
}

export function defaultAiStoreData(): AiStoreData {
  return {
    version: 1,
    profiles: [],
    defaultProfileId: null,
    features: { writing: null, chat: null, embedding: null },
    setupPromptDismissed: false,
    embeddingFingerprint: null,
    embeddingGeneration: 0,
  };
}

const DEFAULT_EMBEDDING_METRIC: EmbeddingMetric = 'cosine';

function coerceParams(raw: unknown): AiStoredProfile['params'] {
  if (typeof raw !== 'object' || raw === null) return {};
  const p = raw as Record<string, unknown>;
  return {
    ...(typeof p.temperature === 'number' && { temperature: p.temperature }),
    ...(typeof p.maxTokens === 'number' && { maxTokens: p.maxTokens }),
  };
}

const EMBEDDING_METRICS: readonly EmbeddingMetric[] = ['cosine', 'dotProduct', 'euclidean'];

function coerceAssignment(raw: unknown): AiFeatureAssignment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.profileId !== 'string' || typeof a.model !== 'string') return null;
  const metric =
    typeof a.metric === 'string' && EMBEDDING_METRICS.includes(a.metric as EmbeddingMetric)
      ? (a.metric as EmbeddingMetric)
      : undefined;
  return {
    profileId: a.profileId,
    model: a.model,
    ...(typeof a.dimensions === 'number' && { dimensions: a.dimensions }),
    ...(metric && { metric }),
  };
}

function coerce(raw: unknown): AiStoreData {
  const base = defaultAiStoreData();
  if (typeof raw !== 'object' || raw === null) return base;
  const d = raw as Record<string, unknown>;
  const profiles = Array.isArray(d.profiles)
    ? d.profiles.filter(
        (p): p is AiStoredProfile =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as AiStoredProfile).id === 'string' &&
          typeof (p as AiStoredProfile).name === 'string',
      )
    : [];
  const features = (
    typeof d.features === 'object' && d.features !== null ? d.features : {}
  ) as Record<string, unknown>;
  return {
    version: 1,
    profiles,
    defaultProfileId:
      typeof d.defaultProfileId === 'string' && profiles.some((p) => p.id === d.defaultProfileId)
        ? d.defaultProfileId
        : null,
    features: {
      writing: coerceAssignment(features.writing),
      chat: coerceAssignment(features.chat),
      embedding: coerceAssignment(features.embedding),
    },
    setupPromptDismissed:
      typeof d.setupPromptDismissed === 'boolean' ? d.setupPromptDismissed : false,
    embeddingFingerprint:
      typeof d.embeddingFingerprint === 'string' ? d.embeddingFingerprint : null,
    embeddingGeneration:
      typeof d.embeddingGeneration === 'number' && d.embeddingGeneration >= 0
        ? Math.floor(d.embeddingGeneration)
        : 0,
  };
}

/**
 * 加载时安全清理：任何遗留的 `plain:` 前缀密钥 blob 一律丢弃（fail-closed）。
 * 明文回退已被移除，系统凭据不可用时绝不持久化密钥。
 * keyStorage 统一规范化为 'safestorage'（仅作为 blob 格式标记，有 keyBlob 时才有效）。
 */
function scrubLegacyPlaintext(data: AiStoreData): AiStoreData {
  let changed = false;
  const profiles = data.profiles.map((p): AiStoredProfile => {
    if (p.keyBlob?.startsWith('plain:')) {
      changed = true;
      return { ...p, keyBlob: null, keyStorage: 'system-credential' };
    }
    if (p.keyBlob?.startsWith('enc:v1:')) return p;
    return p.keyStorage === 'system-credential'
      ? p
      : ((changed = true), { ...p, keyStorage: 'system-credential' });
  });
  return changed ? { ...data, profiles } : data;
}

/**
 * AI 配置存储：Profile（密钥仅加密 blob）+ 分功能指定 + embedding generation。
 * 视图转换（toView）保证渲染层永远拿不到密钥明文。
 */
export type AiProfileWriteInput = Omit<AiProfileInput, 'credentialToken' | 'clearCredential'> & {
  /** Main-process-only secret; never part of the shared renderer contract. */
  apiKey?: string | null;
};

export interface AiStoreMigrationOptions {
  /** Electron safeStorage is accepted only to migrate legacy encrypted JSON blobs. */
  safeStorage?: SafeStorageLike;
}

export class AiStore {
  private data: AiStoreData;

  constructor(
    private readonly filePath: string,
    private readonly secrets: SecretVault,
    private readonly migration: AiStoreMigrationOptions = {},
  ) {
    this.data = this.load();
  }

  private load(): AiStoreData {
    try {
      const raw = coerce(JSON.parse(readFileSync(this.filePath, 'utf8')));
      let migrated = false;
      const profiles = raw.profiles.map((p) => {
        // Legacy safeStorage blobs are decrypted only during migration. The legacy blob is
        // removed from JSON only after the OS credential write succeeds.
        if (p.keyBlob?.startsWith('enc:v1:') && this.migration.safeStorage) {
          try {
            const secret = decryptLegacySafeStorage(p.keyBlob, this.migration.safeStorage);
            const account = newSecretAccount();
            this.secrets.put(account, secret);
            migrated = true;
            return { ...p, keyBlob: account, keyStorage: 'system-credential' as const };
          } catch {
            // Preserve the encrypted legacy blob for a later migration attempt. It is never treated
            // as a system credential reference, and is removed only after the native write succeeds.
            return p;
          }
        }
        return p;
      });
      const scrubbed = scrubLegacyPlaintext({ ...raw, profiles });
      if (migrated || scrubbed !== raw) this.persistData(scrubbed);
      return scrubbed;
    } catch {
      return defaultAiStoreData();
    }
  }

  private persistData(data: AiStoreData): void {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.filePath);
  }

  private persist(): void {
    this.persistData(this.data);
  }

  // ── 读 ──────────────────────────────────────────────

  get(): Readonly<AiStoreData> {
    return this.data;
  }

  getProfile(id: string): AiStoredProfile | undefined {
    return this.data.profiles.find((p) => p.id === id);
  }

  /** 解密密钥（仅主进程内使用；渲染层永不可见）。 */
  getApiKey(profileId: string): string {
    const p = this.getProfile(profileId);
    if (!p || !p.keyBlob || p.keyBlob.startsWith('enc:v1:')) return '';
    try {
      return this.secrets.get(p.keyBlob) ?? '';
    } catch {
      return '';
    }
  }

  toView(p: AiStoredProfile): AiProfileView {
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      baseUrl: p.baseUrl,
      defaultModel: p.defaultModel,
      params: { ...p.params },
      hasApiKey: !!p.keyBlob && !p.keyBlob.startsWith('enc:v1:'),
      keyStorage: p.keyStorage,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  getState(): AiConfigState {
    return {
      profiles: this.data.profiles.map((p) => this.toView(p)),
      defaultProfileId: this.data.defaultProfileId,
      features: {
        writing: this.data.features.writing,
        chat: this.data.features.chat,
        embedding: this.data.features.embedding,
      },
      needsOnboarding: this.data.profiles.length === 0,
      setupPromptDismissed: this.data.setupPromptDismissed,
      embeddingFingerprint: this.data.embeddingFingerprint,
      embeddingGeneration: this.data.embeddingGeneration,
    };
  }

  /**
   * 当前 embedding 指纹。assignment 优先；缺省时回退到「跟随默认 Profile」的虚拟源。
   * metric 由 assignment 携带（缺省 cosine），绝不硬编码。dimensions 未知时标 'auto'。
   */
  static fingerprintOf(
    assignment: AiFeatureAssignment | null,
    fallback: { profileId: string; model: string } | null,
  ): string | null {
    const effective: {
      profileId: string;
      model: string;
      dimensions?: number | null;
      metric?: EmbeddingMetric;
    } | null = assignment ?? fallback;
    if (!effective) return null;
    const dims = effective.dimensions ?? 'auto';
    const metric = effective.metric ?? DEFAULT_EMBEDDING_METRIC;
    return `${effective.profileId}:${effective.model}:${dims}:${metric}`;
  }

  /** A global default is usable only for chat/writing; embedding-only profiles stay feature-scoped. */
  private isChatCapable(profile: AiStoredProfile): boolean {
    return profile.kind !== 'local-embedding';
  }

  private firstChatCapableProfile(profiles = this.data.profiles): AiStoredProfile | undefined {
    return profiles.find((profile) => this.isChatCapable(profile));
  }

  /** 跟随默认 Profile 的虚拟 embedding 源（无显式 assignment 时）。 */
  private defaultEmbeddingFallback(): { profileId: string; model: string } | null {
    const def = this.data.defaultProfileId
      ? this.getProfile(this.data.defaultProfileId)
      : undefined;
    if (!def || !this.isChatCapable(def)) return null;
    return { profileId: def.id, model: def.defaultModel };
  }

  /** embedding 指纹变化检测：变更 → generation+1（DEV-011 消费：标记索引重建）。 */
  refreshEmbeddingFingerprint(): boolean {
    const next = AiStore.fingerprintOf(
      this.data.features.embedding,
      this.defaultEmbeddingFallback(),
    );
    if (next === this.data.embeddingFingerprint) return false;
    this.data = {
      ...this.data,
      embeddingFingerprint: next,
      embeddingGeneration: this.data.embeddingGeneration + 1,
    };
    this.persist();
    return true;
  }

  // ── 写 ──────────────────────────────────────────────

  dismissSetupPrompt(): void {
    if (this.data.setupPromptDismissed) return;
    this.data = { ...this.data, setupPromptDismissed: true };
    this.persist();
  }

  saveProfile(id: string | undefined, input: AiProfileWriteInput): AiStoredProfile {
    const now = Date.now();
    const existing = id ? this.getProfile(id) : undefined;
    if (id && !existing) throw new Error(`Profile 不存在: ${id}`);

    const name = input.name.trim();
    const defaultModel = input.defaultModel.trim();
    const rawBaseUrl = input.baseUrl.trim();
    if (!name) throw new Error('Profile 名称不能为空');
    if (!defaultModel) throw new Error('默认模型不能为空');
    if (input.kind === 'local-embedding') {
      if (rawBaseUrl !== 'local://embedding')
        throw new Error('本地 embedding 地址必须为 local://embedding');
      if (typeof input.apiKey === 'string' && input.apiKey.length > 0) {
        throw new Error('本地 embedding 不接受凭据');
      }
    } else {
      if (!/^https?:\/\//i.test(rawBaseUrl)) throw new Error('base-url 必须以 http(s):// 开头');
      const u = new URL(rawBaseUrl);
      if (u.username || u.password) {
        throw new Error('base-url 不得包含用户名/密码（请使用 API Key 字段）');
      }
    }

    // 密钥合并语义：undefined=保留；null=清除；字符串=覆盖。
    // Local profiles always clear any credential left by a previous network profile.
    let keyBlob = existing?.keyBlob ?? null;
    const shouldClearCredential = input.kind === 'local-embedding' || input.apiKey === null;
    if (shouldClearCredential) {
      if (keyBlob) this.secrets.delete(keyBlob);
      keyBlob = null;
    } else if (typeof input.apiKey === 'string' && input.apiKey.length > 0) {
      if (!this.secrets.available) throw new SecretStorageUnavailableError();
      if (!keyBlob) keyBlob = newSecretAccount();
      this.secrets.put(keyBlob, input.apiKey);
    }

    const profile: AiStoredProfile = {
      id: existing?.id ?? randomUUID(),
      name,
      kind: input.kind,
      baseUrl: input.kind === 'local-embedding' ? rawBaseUrl : rawBaseUrl.replace(/\/+$/, ''),
      defaultModel,
      params: coerceParams(input.params ?? existing?.params ?? {}),
      keyBlob,
      keyStorage: 'system-credential',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const profiles = existing
      ? this.data.profiles.map((p) => (p.id === existing.id ? profile : p))
      : [...this.data.profiles, profile];
    const firstChat = !this.firstChatCapableProfile();
    this.data = { ...this.data, profiles };
    const currentDefault = this.data.defaultProfileId
      ? this.getProfile(this.data.defaultProfileId)
      : undefined;
    if (this.isChatCapable(profile) && (firstChat || !currentDefault)) {
      this.data = { ...this.data, defaultProfileId: profile.id };
    } else if (!currentDefault || !this.isChatCapable(currentDefault)) {
      // Editing a former default into embedding-only must not leave a chat-invalid global default.
      this.data = { ...this.data, defaultProfileId: this.firstChatCapableProfile()?.id ?? null };
    }
    this.persist();
    // 首个 Profile 自动成为默认，以及默认 Profile 的模型被编辑时，都会改变跟随默认的 embedding 源。
    this.refreshEmbeddingFingerprint();
    return profile;
  }

  deleteProfile(id: string): void {
    const removed = this.getProfile(id);
    if (removed?.keyBlob) this.secrets.delete(removed.keyBlob);
    const profiles = this.data.profiles.filter((p) => p.id !== id);
    if (profiles.length === this.data.profiles.length) return;
    const features = { ...this.data.features };
    for (const key of Object.keys(features) as AiFeatureKey[]) {
      if (features[key]?.profileId === id) features[key] = null;
    }
    this.data = {
      ...this.data,
      profiles,
      features,
      defaultProfileId:
        this.data.defaultProfileId === id
          ? (this.firstChatCapableProfile(profiles)?.id ?? null)
          : this.data.defaultProfileId,
    };
    this.persist();
    this.refreshEmbeddingFingerprint();
  }

  setDefaultProfile(id: string): void {
    const profile = this.getProfile(id);
    if (!profile) throw new Error(`Profile 不存在: ${id}`);
    if (!this.isChatCapable(profile))
      throw new Error('本地 embedding Profile 不能作为全局聊天默认');
    this.data = { ...this.data, defaultProfileId: id };
    this.persist();
    // 默认 Profile 变化 → embedding「跟随默认」的虚拟源变 → 指纹刷新
    this.refreshEmbeddingFingerprint();
  }

  setFeatureAssignment(feature: AiFeatureKey, assignment: AiFeatureAssignment | null): void {
    if (assignment) {
      if (!this.getProfile(assignment.profileId)) {
        throw new Error(`Profile 不存在: ${assignment.profileId}`);
      }
      if (!assignment.model.trim()) throw new Error('模型不能为空');
    }
    this.data = {
      ...this.data,
      features: { ...this.data.features, [feature]: assignment },
    };
    this.persist();
    this.refreshEmbeddingFingerprint();
  }

  /**
   * embedding 维度/度量探测回写（首次 embed 成功后调用）。
   * 返回 true 表示 state 实际变更（调用方据此广播 ai:configChanged）。
   * 无显式 assignment 时返回 false（调用方负责先提升为跟随默认的显式 assignment）。
   */
  recordEmbeddingDimensions(
    dimensions: number,
    metric: EmbeddingMetric = DEFAULT_EMBEDDING_METRIC,
  ): boolean {
    const assignment = this.data.features.embedding;
    const fallback = this.defaultEmbeddingFallback();
    const effective = assignment ?? fallback;
    if (!effective) return false;
    const next: AiFeatureAssignment = {
      profileId: effective.profileId,
      model: effective.model,
      dimensions,
      metric,
    };
    const unchanged =
      assignment?.profileId === next.profileId &&
      assignment.model === next.model &&
      assignment.dimensions === next.dimensions &&
      (assignment.metric ?? DEFAULT_EMBEDDING_METRIC) === next.metric;
    if (unchanged) return false;
    this.data = {
      ...this.data,
      features: { ...this.data.features, embedding: next },
    };
    this.persist();
    this.refreshEmbeddingFingerprint();
    return true;
  }

  // ── 导入/导出（永不含密钥） ──────────────────────────

  exportBundle(): AiProfileExportBundle {
    const nameOf = (id: string | null): string | null => {
      if (!id) return null;
      const p = this.getProfile(id);
      return p ? p.name : null;
    };
    const f = this.data.features;
    return {
      app: 'nexnote',
      kind: 'ai-profiles',
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles: this.data.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        providerKind: p.kind,
        baseUrl: p.baseUrl,
        defaultModel: p.defaultModel,
        params: { ...p.params },
      })),
      features: {
        writing: f.writing
          ? {
              profileRef: f.writing.profileId,
              name: nameOf(f.writing.profileId) ?? '',
              model: f.writing.model,
            }
          : null,
        chat: f.chat
          ? {
              profileRef: f.chat.profileId,
              name: nameOf(f.chat.profileId) ?? '',
              model: f.chat.model,
            }
          : null,
        embedding: f.embedding
          ? {
              profileRef: f.embedding.profileId,
              name: nameOf(f.embedding.profileId) ?? '',
              model: f.embedding.model,
              ...(f.embedding.metric && { metric: f.embedding.metric }),
            }
          : null,
      },
      defaultProfileRef: this.data.defaultProfileId,
      defaultProfileName: nameOf(this.data.defaultProfileId),
    };
  }

  /**
   * 导入捆绑：按 name 匹配——同名覆盖（baseUrl/model/参数），异名新建。
   * 密钥永不导入（导入的 Profile 需用户重新填 key）。
   */
  importBundle(bundle: AiProfileExportBundle): { imported: number; skipped: string[] } {
    const skipped: string[] = [];
    let imported = 0;
    const importedRefs = new Map<string, string>();
    const duplicateNames = new Set(
      bundle.profiles
        .map((profile) => profile.name)
        .filter((name, index, names) => names.indexOf(name) !== index),
    );
    for (const p of bundle.profiles) {
      if (!p.name || !p.baseUrl) {
        skipped.push(p.name || '(未命名)');
        continue;
      }
      const existing = this.data.profiles.find((x) => x.name === p.name);
      try {
        const saved = this.saveProfile(existing?.id, {
          name: p.name,
          kind: p.providerKind ?? 'openai-compatible',
          baseUrl: p.baseUrl,
          defaultModel: p.defaultModel || '',
          params: p.params,
          // Imported profiles never carry credential material.
          apiKey: existing ? undefined : null,
        });
        if (p.id) importedRefs.set(p.id, saved.id);
        imported += 1;
      } catch {
        skipped.push(p.name);
      }
    }
    // Export-scoped references are authoritative. Legacy name-only bundles are accepted only
    // when the name is unique; otherwise assignment/default resolution fails closed.
    const resolveProfile = (
      profileRef: string | undefined,
      name: string,
    ): AiStoredProfile | undefined => {
      if (profileRef)
        return importedRefs.get(profileRef)
          ? this.getProfile(importedRefs.get(profileRef)!)
          : undefined;
      if (!name || duplicateNames.has(name)) return undefined;
      const matches = this.data.profiles.filter((profile) => profile.name === name);
      return matches.length === 1 ? matches[0] : undefined;
    };
    const resolve = (
      a: { profileRef?: string; name: string; model: string; metric?: EmbeddingMetric } | null,
    ): AiFeatureAssignment | null => {
      if (!a) return null;
      const p = resolveProfile(a.profileRef, a.name);
      return p ? { profileId: p.id, model: a.model, ...(a.metric && { metric: a.metric }) } : null;
    };
    const features = {
      writing: resolve(bundle.features.writing),
      chat: resolve(bundle.features.chat),
      embedding: resolve(bundle.features.embedding),
    };
    // 导入保持 bundle 声明的默认 Profile（SPEC-9：默认不能退化为首个）；无声明则不覆盖本地默认。
    const def = resolveProfile(
      bundle.defaultProfileRef ?? undefined,
      bundle.defaultProfileName ?? '',
    );
    let defaultProfileId = this.data.defaultProfileId;
    if (def && this.isChatCapable(def)) defaultProfileId = def.id;
    else if (!def && !defaultProfileId) {
      // 仅当本地空置且 bundle 未声明时，才以首个可聊天 Profile 作兜底。
      defaultProfileId = this.firstChatCapableProfile()?.id ?? null;
    }
    this.data = { ...this.data, features, defaultProfileId };
    this.persist();
    this.refreshEmbeddingFingerprint();
    return { imported, skipped };
  }
}

export function aiStoreFileExists(filePath: string): boolean {
  return existsSync(filePath);
}
