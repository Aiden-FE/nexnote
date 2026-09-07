import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  RetrievalOptions,
  RetrievalResponse,
  RetrievalSource,
  SkillParams,
  SkillRetrieveOptions,
  SkillRetrieveResponse,
  SkillView,
} from '@nexnote/shared';
import type { PluginService } from '../plugins/plugin-service';
import { mergeSkillResults, packContextText } from './merge-rerank';

const DEFAULT_TOP_K = 8;
const DEFAULT_BUDGET = 4000;

export class SkillError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SkillError';
  }
}

/** 内置技能：参数化复用三阶段检索器（DEV-011）。 */
interface BuiltinSkill {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  order: number;
  params: SkillParams;
}

const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: 'builtin.retrieval',
    name: '内置检索',
    description: '三阶段渐进式召回：FTS 粗筛 → 双链 1 跳 → 向量重排（含置信度因子）。',
    defaultEnabled: true,
    order: 0,
    params: {},
  },
  {
    id: 'builtin.retrieval-fts',
    name: '快速关键词检索',
    description: '仅 FTS + 双链（关闭向量重排），低延迟；可与内置检索组合。',
    defaultEnabled: false,
    order: 1,
    params: { disableVector: true, topK: 6 },
  },
];

interface SkillSetting {
  enabled?: boolean;
  order?: number;
  params?: SkillParams;
}

interface PersistedSettings {
  settings: Record<string, SkillSetting>;
}

export interface SkillServiceDeps {
  /** 执行一次三阶段检索（DEV-011 RetrievalService）。 */
  retrieve: (options: RetrievalOptions) => Promise<RetrievalResponse>;
  /** 可选：插件服务，用于发现插件贡献的检索 Skill。 */
  plugins?: PluginService;
  stateFile?: string;
}

export class SkillService {
  private readonly stateFile: string;
  private settings: Record<string, SkillSetting> = {};

  constructor(private readonly deps: SkillServiceDeps) {
    this.stateFile = deps.stateFile ?? '';
    this.restore();
  }

  private builtin(id: string): BuiltinSkill {
    const skill = BUILTIN_SKILLS.find((item) => item.id === id);
    if (!skill) throw new SkillError(`内置 Skill 不存在: ${id}`, 'SKILL_NOT_FOUND');
    return skill;
  }

  /** 当前全部可用技能（内置 + 活跃插件贡献），套用用户启停/排序/参数。 */
  list(): SkillView[] {
    const pluginSkills =
      this.deps.plugins?.listPluginSkillContributions().map((item) => ({
        id: item.id,
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
        source: 'plugin' as const,
        pluginId: item.pluginId,
        baseEnabled: true,
        baseOrder: 100,
        baseParams: item.params ?? {},
        available: true,
      })) ?? [];

    const all: SkillView[] = [
      ...BUILTIN_SKILLS.map((skill) => {
        const user = this.settings[skill.id] ?? {};
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source: 'builtin' as const,
          enabled: user.enabled ?? skill.defaultEnabled,
          order: user.order ?? skill.order,
          params: { ...skill.params, ...(user.params ?? {}) },
          available: true,
        };
      }),
      ...pluginSkills.map((item) => {
        const user = this.settings[item.id] ?? {};
        return {
          id: item.id,
          name: item.name,
          ...(item.description ? { description: item.description } : {}),
          source: 'plugin' as const,
          pluginId: item.pluginId,
          enabled: user.enabled ?? item.baseEnabled,
          order: user.order ?? item.baseOrder,
          params: { ...item.baseParams, ...(user.params ?? {}) },
          available: item.available,
        };
      }),
    ];

    return all.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  private requireSkill(id: string): SkillView {
    const skill = this.list().find((item) => item.id === id);
    if (!skill) throw new SkillError(`Skill 不存在: ${id}`, 'SKILL_NOT_FOUND');
    return skill;
  }

  setEnabled(id: string, enabled: boolean): SkillView {
    this.requireSkill(id);
    this.settings[id] = { ...this.settings[id], enabled };
    this.persist();
    return this.requireSkill(id);
  }

  /** 按传入的 id 顺序整体重排；未列出的技能追加在后（保持相对顺序）。 */
  setOrder(order: string[]): SkillView[] {
    order.forEach((id, index) => {
      this.settings[id] = { ...this.settings[id], order: index };
    });
    this.persist();
    return this.list();
  }

  setParams(id: string, params: SkillParams): SkillView {
    this.requireSkill(id);
    this.settings[id] = { ...this.settings[id], params: { ...params } };
    this.persist();
    return this.requireSkill(id);
  }

  /**
   * 执行多 Skill 召回：每个选中 Skill 以自身参数检索 → 合并去重 → 跨源重排。
   * skillIds 缺省 = 全部已启用且可用 Skill。
   */
  async retrieve(options: SkillRetrieveOptions): Promise<SkillRetrieveResponse> {
    const { skillIds, query, ...rest } = options;
    const selected = this.list().filter(
      (skill) =>
        skill.available &&
        skill.enabled &&
        (skillIds === undefined || skillIds.includes(skill.id)),
    );
    if (selected.length === 0) {
      return {
        query,
        usedSkillIds: [],
        sources: [],
        degraded: false,
        contextText: '',
      };
    }

    const responses: Array<{ skillId: string; response: RetrievalResponse }> = [];
    for (const skill of selected) {
      const response = await this.deps.retrieve({
        query,
        topK: skill.params.topK ?? rest.topK ?? DEFAULT_TOP_K,
        budgetChars: skill.params.budgetChars ?? rest.budgetChars ?? DEFAULT_BUDGET,
        confidenceWeight: skill.params.confidenceWeight ?? rest.confidenceWeight,
        disableVector: skill.params.disableVector ?? rest.disableVector,
      });
      responses.push({ skillId: skill.id, response });
    }

    const runs = responses.map((entry) => ({
      skillId: entry.skillId,
      sources: entry.response.sources.map((source: RetrievalSource) => ({
        ...source,
        skillId: entry.skillId,
      })),
    }));
    const topK = rest.topK ?? DEFAULT_TOP_K;
    const sources = mergeSkillResults(runs, topK);
    const budget = rest.budgetChars ?? DEFAULT_BUDGET;
    return {
      query,
      usedSkillIds: selected.map((skill) => skill.id),
      sources,
      degraded: responses.some((entry) => entry.response.degraded),
      contextText: packContextText(sources, budget),
    };
  }

  private persist(): void {
    if (!this.stateFile) return;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify({ settings: this.settings } satisfies PersistedSettings, null, 2));
  }

  private restore(): void {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      const data = JSON.parse(readFileSync(this.stateFile, 'utf8')) as PersistedSettings;
      this.settings = data.settings ?? {};
    } catch {
      this.settings = {};
    }
  }
}
