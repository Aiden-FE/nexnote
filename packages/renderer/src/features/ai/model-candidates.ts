import type { AiConfigState, AiConnectionTarget, AiProfileView } from '@nexnote/shared';
import { invoke } from '../../lib/ipc';

/**
 * 分功能模型候选缓存（模块级）。
 *
 * 「设置页分功能下拉」与「编辑 AI Profile」必须读到同一份候选：两处都走主进程同一条
 * 实时查询链路（`ai:listModels` / `ai:testConnection` → adapter.listModels() → `GET /models`），
 * 且都传**候选形态**的连接目标（kind + baseUrl + defaultModel）。凭据由主进程按已存
 * profile 复用（kind/baseUrl 一致时），渲染层不持有密钥。
 *
 * 两个关键约束：
 * 1. 只有「成功且非空」的结果才算有效缓存。空列表与失败都不写缓存，下次聚焦 / 点刷新
 *    可重试；失败时调用方降级为自由输入。
 * 2. 缓存键含连接签名（kind / 解析后 baseUrl / 凭据有无 / updatedAt），profile 保存
 *    （含改密钥）后键即变化；配置变更时还会按当前 state 淘汰失效条目。
 */
const MODEL_CANDIDATES_CACHE = new Map<string, string[]>();

/** 连接签名：任一影响连接的字段变化都视为另一个条目，避免旧 profile 的候选串到新 profile。 */
export function modelCandidateCacheKey(
  profileId: string,
  profile: AiProfileView | undefined,
): string {
  if (!profile) return `${profileId}|unknown`;
  return [
    profile.id,
    profile.kind,
    profile.baseUrl.replace(/\/+$/, ''),
    // 凭据指纹：渲染层拿不到密钥明文，用「是否已配置 + 最后更新时间」表达。
    profile.hasApiKey ? 'key' : 'nokey',
    profile.updatedAt,
  ].join('|');
}

/**
 * 与「编辑 AI Profile」同形的查询目标：都用 candidate 描述当前连接。
 * 未保存的 URL/密钥改动因此在两处产生同样的候选；保存后签名变化触发重拉。
 */
export function modelCandidateTarget(
  profileId: string,
  profile: AiProfileView | undefined,
): AiConnectionTarget {
  if (!profile) return { profileId };
  return {
    profileId: profile.id,
    candidate: {
      kind: profile.kind,
      baseUrl: profile.baseUrl,
      defaultModel: profile.defaultModel,
    },
  };
}

/** 读取缓存；空结果不会写入，因此这里返回的非空列表一定是成功拉取过的。 */
export function peekModelCandidates(cacheKey: string): string[] {
  return MODEL_CANDIDATES_CACHE.get(cacheKey) ?? [];
}

/** 淘汰签名已失效的条目（配置变更后由 store 的 apply/load 调用）。 */
export function pruneModelCandidatesCache(state: AiConfigState | null): void {
  const valid = new Set((state?.profiles ?? []).map((p) => modelCandidateCacheKey(p.id, p)));
  for (const key of [...MODEL_CANDIDATES_CACHE.keys()]) {
    if (!valid.has(key)) MODEL_CANDIDATES_CACHE.delete(key);
  }
}

/** 清空全部候选缓存（单测用；生产路径走 prune）。 */
export function clearModelCandidatesCache(): void {
  MODEL_CANDIDATES_CACHE.clear();
}

/**
 * 拉取模型候选。force=true 越过缓存（「刷新」按钮）。
 * 成功但为空 → 不写缓存；失败 → 不写缓存并返回空数组 + 错误信息（自由输入降级）。
 */
export async function fetchModelCandidates(
  profileId: string,
  profile: AiProfileView | undefined,
  cacheKey: string,
  force = false,
): Promise<{ models: string[]; error: string | null }> {
  if (!force) {
    const cached = MODEL_CANDIDATES_CACHE.get(cacheKey);
    if (cached) return { models: cached, error: null };
  }
  try {
    const result = await invoke('ai:listModels', modelCandidateTarget(profileId, profile));
    const models = Array.isArray(result.models) ? result.models : [];
    if (models.length > 0) MODEL_CANDIDATES_CACHE.set(cacheKey, models);
    else MODEL_CANDIDATES_CACHE.delete(cacheKey);
    return { models, error: null };
  } catch (e) {
    // 失败不缓存错误态：下次聚焦可重试；当前返回空列表走「自由输入」降级。
    MODEL_CANDIDATES_CACHE.delete(cacheKey);
    const message = e instanceof Error ? e.message : String(e);
    return { models: [], error: message };
  }
}
