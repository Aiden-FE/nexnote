/**
 * 检索 Skill 系统（DEV-014）：Skill = 一类受约束的插件/内置扩展，
 * 只暴露 `retrieval:*` 召回能力。多个 Skill 各自召回 → 合并 → 跨源重排。
 */
import type { RetrievalSource } from './retrieval';

export type SkillSource = 'builtin' | 'plugin';

/** Skill 可调参数（与 RetrievalOptions 对齐，均为可选）。 */
export interface SkillParams {
  topK?: number;
  confidenceWeight?: number;
  budgetChars?: number;
  /** 关闭向量重排（FTS + 双链两阶段）。 */
  disableVector?: boolean;
}

export interface SkillManifest {
  /** 反向域名式，内置 skill 用 `<builtin>` 保留命名空间。 */
  id: string;
  name: string;
  description?: string;
  /** builtin = 宿主内置；plugin = 由已安装插件贡献（在沙箱内执行，stretch）。 */
  source: SkillSource;
  /** source=plugin 时对应插件 id。 */
  pluginId?: string;
  /** 默认可调参数；可被用户覆盖。 */
  defaults?: SkillParams;
}

export interface SkillView {
  id: string;
  name: string;
  description?: string;
  source: SkillSource;
  pluginId?: string;
  enabled: boolean;
  /** 排序权重：多 Skill 合并时的展示/调用顺序。 */
  order: number;
  params: SkillParams;
  /** true = 当前环境可执行；插件沙箱内召回（stretch）为 false。 */
  available: boolean;
}

export interface SkillRetrieveOptions extends SkillParams {
  query: string;
  /** 指定参与的 Skill；缺省 = 所有已启用且可用 Skill。 */
  skillIds?: string[];
}

export interface SkillRetrieveResponse {
  query: string;
  /** 实际参与合并的 Skill id。 */
  usedSkillIds: string[];
  /** 合并 + 跨源重排、去重后的来源块（已带 skillId 溯源）。 */
  sources: RetrievalSource[];
  /** true = 任一可用 Skill 走了降级（embedding 不可用）。 */
  degraded: boolean;
  /** 组合打包后的上下文正文（注入对话）。 */
  contextText: string;
}
