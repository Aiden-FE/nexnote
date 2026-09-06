import type { RetrievalOptions, RetrievalResponse, RetrievalSource } from '@nexnote/shared';
import type { RetrievalService } from './retrieval-service';

/**
 * 内置检索 Skill（DEV-011 交付内容 3）。
 *
 * 官方默认检索能力，也是插件系统的第一个 Skill（DEV-014 将其注册为可被插件调用的能力）。
 * 接口与规格一致：`search(query, options) → Promise<SearchResult[]>`；
 * topK / 阶段开关 / 置信度权重 / token 预算均可配置；embedding 不可用时结果自动降级标注。
 */
export interface BuiltinRetrievalSkillConfig {
  topK?: number;
  confidenceWeight?: number;
  budgetChars?: number;
  disableVector?: boolean;
}

export class BuiltinRetrievalSkill {
  readonly id = 'builtin.retrieval';
  readonly name = '内置检索';
  readonly version = 1;

  constructor(private readonly retrieval: RetrievalService) {}

  /** Skill 规格接口：返回排序后的来源块。 */
  async search(query: string, options?: BuiltinRetrievalSkillConfig): Promise<RetrievalSource[]> {
    const res = await this.retrieve({ query, ...options });
    return res.sources;
  }

  /** 完整召回（含分阶段统计/降级/打包上下文），供对话上下文注入。 */
  retrieve(options: RetrievalOptions): Promise<RetrievalResponse> {
    return this.retrieval.retrieve(options);
  }
}
