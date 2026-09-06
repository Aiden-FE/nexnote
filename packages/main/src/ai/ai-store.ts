import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  AiConfigState,
  AiFeatureAssignment,
  AiFeatureKey,
  AiProfileExportBundle,
  AiProfileInput,
  AiProfileView,
} from '@nexnote/shared';
import { SecretStorageUnavailableError, type SecretVault } from './secret-store';

/** 主进程持久化形态（userData/nexnote-ai.json）。keyBlob = SecretVault 加密后的密钥。 */
export interface AiStoredProfile {
  id: string;
  name: string;
  kind: 'openai-compatible' | 'azure-openai';
  baseUrl: string;
  defaultModel: string;
  params: { temperature?: number; maxTokens?: number };
  keyBlob: string | null;
  keyStorage: 'safestorage';
  createdAt: number;
  updatedAt: number;
}

export interface AiStoreData {
  version: 1;
  profiles: AiStoredProfile[];
  defaultProfileId: string | null;
  features: Record<AiFeatureKey, AiFeatureAssignment | null>;
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
    embeddingFingerprint: null,
    embeddingGeneration: 0,
  };
}

const EMBEDDING_METRIC = 'cosine';

function coerceParams(raw: unknown): AiStoredProfile['params'] {
  if (typeof raw !== 'object' || raw === null) return {};
  const p = raw as Record<string, unknown>;
  return {
    ...(typeof p.temperature === 'number' && { temperature: p.temperature }),
    ...(typeof p.maxTokens === 'number' && { maxTokens: p.maxTokens }),
  };
}

function coerceAssignment(raw: unknown): AiFeatureAssignment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.profileId !== 'string' || typeof a.model !== 'string') return null;
  return {
    profileId: a.profileId,
    model: a.model,
    ...(typeof a.dimensions === 'number' && { dimensions: a.dimensions }),
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
    if (p.keyBlob && p.keyBlob.startsWith('plain:')) {
      changed = true;
      return { ...p, keyBlob: null, keyStorage: 'safestorage' };
    }
    if (p.keyStorage !== 'safestorage') {
      changed = true;
      return { ...p, keyStorage: 'safestorage' };
    }
    return p;
  });
  if (!changed) return data;
  return { ...data, profiles };
}

/**
 * AI 配置存储：Profile（密钥仅加密 blob）+ 分功能指定 + embedding generation。
 * 视图转换（toView）保证渲染层永远拿不到密钥明文。
 */
export class AiStore {
  private data: AiStoreData;

  constructor(
    private readonly filePath: string,
    private readonly secrets: SecretVault,
  ) {
    this.data = this.load();
  }

  private load(): AiStoreData {
    try {
      const raw = coerce(JSON.parse(readFileSync(this.filePath, 'utf8')));
      const scrubbed = scrubLegacyPlaintext(raw);
      // 若发现旧版明文回退，立即覆盖磁盘，不能只在内存中隐藏。
      if (scrubbed !== raw) this.persistData(scrubbed);
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
    if (!p || !p.keyBlob) return '';
    try {
      return this.secrets.decrypt(p.keyBlob);
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
      hasApiKey: !!p.keyBlob,
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
      embeddingFingerprint: this.data.embeddingFingerprint,
      embeddingGeneration: this.data.embeddingGeneration,
    };
  }

  /** 当前 embedding 指纹（dimensions 已知时由 refreshEmbeddingFingerprint 更新）。 */
  static fingerprintOf(assignment: AiFeatureAssignment | null): string | null {
    if (!assignment) return null;
    const dims = assignment.dimensions ?? 'auto';
    return `${assignment.profileId}:${assignment.model}:${dims}:${EMBEDDING_METRIC}`;
  }

  /** embedding 指纹变化检测：变更 → generation+1（DEV-011 消费：标记索引重建）。 */
  refreshEmbeddingFingerprint(): boolean {
    const next = AiStore.fingerprintOf(this.data.features.embedding);
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

  saveProfile(id: string | undefined, input: AiProfileInput): AiStoredProfile {
    const now = Date.now();
    const existing = id ? this.getProfile(id) : undefined;
    if (id && !existing) throw new Error(`Profile 不存在: ${id}`);

    // 密钥合并语义：undefined=保留；null=清除；字符串=覆盖
    // 加密失败（系统凭据不可用）直接抛错，绝不写入明文。
    let keyBlob = existing?.keyBlob ?? null;
    let keyStorage: 'safestorage' = existing?.keyStorage ?? 'safestorage';
    if (input.apiKey === null) {
      keyBlob = null;
    } else if (typeof input.apiKey === 'string' && input.apiKey.length > 0) {
      if (!this.secrets.available) {
        throw new SecretStorageUnavailableError();
      }
      keyBlob = this.secrets.encrypt(input.apiKey);
      keyStorage = 'safestorage';
    }

    const profile: AiStoredProfile = {
      id: existing?.id ?? randomUUID(),
      name: input.name.trim(),
      kind: input.kind,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
      defaultModel: input.defaultModel.trim(),
      params: coerceParams(input.params ?? existing?.params ?? {}),
      keyBlob,
      keyStorage,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (!profile.name) throw new Error('Profile 名称不能为空');
    if (!/^https?:\/\//i.test(profile.baseUrl)) throw new Error('base-url 必须以 http(s):// 开头');
    if (!profile.defaultModel) throw new Error('默认模型不能为空');

    const profiles = existing
      ? this.data.profiles.map((p) => (p.id === existing.id ? profile : p))
      : [...this.data.profiles, profile];
    const first = this.data.profiles.length === 0;
    this.data = { ...this.data, profiles };
    if (first || !this.data.defaultProfileId) {
      this.data = { ...this.data, defaultProfileId: profile.id };
    }
    this.persist();
    return profile;
  }

  deleteProfile(id: string): void {
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
      defaultProfileId: this.data.defaultProfileId === id ? null : this.data.defaultProfileId,
    };
    this.persist();
    this.refreshEmbeddingFingerprint();
  }

  setDefaultProfile(id: string): void {
    if (!this.getProfile(id)) throw new Error(`Profile 不存在: ${id}`);
    this.data = { ...this.data, defaultProfileId: id };
    this.persist();
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
   * embedding 维度探测回写（首次 embed 成功后调用）。
   * 返回 true 表示 state 实际变更（调用方据此广播 ai:configChanged）。
   */
  recordEmbeddingDimensions(dimensions: number): boolean {
    const assignment = this.data.features.embedding;
    if (!assignment || assignment.dimensions === dimensions) return false;
    this.data = {
      ...this.data,
      features: {
        ...this.data.features,
        embedding: { ...assignment, dimensions },
      },
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
        name: p.name,
        providerKind: p.kind,
        baseUrl: p.baseUrl,
        defaultModel: p.defaultModel,
        params: { ...p.params },
      })),
      features: {
        writing: f.writing
          ? { name: nameOf(f.writing.profileId) ?? '', model: f.writing.model }
          : null,
        chat: f.chat ? { name: nameOf(f.chat.profileId) ?? '', model: f.chat.model } : null,
        embedding: f.embedding
          ? { name: nameOf(f.embedding.profileId) ?? '', model: f.embedding.model }
          : null,
      },
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
    for (const p of bundle.profiles) {
      if (!p.name || !p.baseUrl) {
        skipped.push(p.name || '(未命名)');
        continue;
      }
      const existing = this.data.profiles.find((x) => x.name === p.name);
      try {
        this.saveProfile(existing?.id, {
          name: p.name,
          kind: p.providerKind ?? 'openai-compatible',
          baseUrl: p.baseUrl,
          defaultModel: p.defaultModel || '',
          params: p.params,
          // 已存在 → 保留密钥（undefined）；新建 → 无密钥
          apiKey: existing ? undefined : null,
        });
        imported += 1;
      } catch {
        skipped.push(p.name);
      }
    }
    // 恢复分功能指定与默认 Profile（按名称回查）
    const resolve = (a: { name: string; model: string } | null): AiFeatureAssignment | null => {
      if (!a || !a.name) return null;
      const p = this.data.profiles.find((x) => x.name === a.name);
      return p ? { profileId: p.id, model: a.model } : null;
    };
    const features = {
      writing: resolve(bundle.features.writing),
      chat: resolve(bundle.features.chat),
      embedding: resolve(bundle.features.embedding),
    };
    this.data = { ...this.data, features };
    const def = bundle.defaultProfileName
      ? this.data.profiles.find((x) => x.name === bundle.defaultProfileName)
      : undefined;
    if (def && !this.data.defaultProfileId) {
      this.data = { ...this.data, defaultProfileId: def.id };
    }
    this.persist();
    this.refreshEmbeddingFingerprint();
    return { imported, skipped };
  }
}

export function aiStoreFileExists(filePath: string): boolean {
  return existsSync(filePath);
}
