/**
 * AI 写作辅助六动作（DEV-010）的渲染层定义：仅 UI 元数据（菜单/快捷键/diff 形态）。
 * prompt 模板（system/user）由主进程 scenario profile 持有；渲染层只传
 * 白名单 actionId + 选区/上下文，不再构造任何 system prompt。
 * - replace 类（改写/润色/缩写）：原地替换选区/块，diff 高亮增删
 * - append 类（扩写/查漏补缺/补充论据）：插入新块，diff 标注新增
 */

export type WritingActionId =
  'rewrite' | 'expand' | 'condense' | 'polish' | 'fillgaps' | 'evidence';

export type WritingKind = 'replace' | 'append';

export interface WritingActionDef {
  id: WritingActionId;
  /** 按钮/菜单显示名 */
  label: string;
  /** 斜杠菜单过滤关键词（含拼音） */
  keywords: string[];
  kind: WritingKind;
  /** 快捷键字母（⌘⌥+<key>） */
  modKey: string;
}

export const WRITING_ACTIONS: WritingActionDef[] = [
  {
    id: 'rewrite',
    label: '改写',
    keywords: ['gaixie', 'rewrite', '重写'],
    kind: 'replace',
    modKey: 'r',
  },
  {
    id: 'polish',
    label: '润色',
    keywords: ['runse', 'polish', '润色', '校对'],
    kind: 'replace',
    modKey: 'p',
  },
  {
    id: 'condense',
    label: '缩写',
    keywords: ['suoxie', 'condense', '精简', '摘要'],
    kind: 'replace',
    modKey: 'c',
  },
  {
    id: 'expand',
    label: '扩写',
    keywords: ['kuoxie', 'expand', '展开', '丰富'],
    kind: 'append',
    modKey: 'e',
  },
  {
    id: 'fillgaps',
    label: '查漏补缺',
    keywords: ['chalou', 'fillgaps', '补全', 'gap'],
    kind: 'append',
    modKey: 'f',
  },
  {
    id: 'evidence',
    label: '补充论据',
    keywords: 'lunju,evidence,论据,举例'.split(','),
    kind: 'append',
    modKey: 'a',
  },
];

export const WRITING_ACTION_MAP: Record<WritingActionId, WritingActionDef> = WRITING_ACTIONS.reduce(
  (acc, action) => {
    acc[action.id] = action;
    return acc;
  },
  {} as Record<WritingActionId, WritingActionDef>,
);

/** 内核 UI（bubble/context/slash）使用的动作 id 编码。 */
export const AI_ACTION_PREFIX = 'ai:';
export function toAiActionId(id: WritingActionId): string {
  return `${AI_ACTION_PREFIX}${id}`;
}
export function fromAiActionId(raw: string): WritingActionId | null {
  if (!raw.startsWith(AI_ACTION_PREFIX)) return null;
  const id = raw.slice(AI_ACTION_PREFIX.length) as WritingActionId;
  return WRITING_ACTION_MAP[id] ? id : null;
}
