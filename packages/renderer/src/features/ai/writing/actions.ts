import type { ChatMessage } from '@nexnote/shared';

/**
 * AI 写作辅助六动作（DEV-010）。
 * - replace 类（改写/润色/缩写）：原地替换选区/块，diff 高亮增删
 * - append 类（扩写/查漏补缺/补充论据）：插入新块，diff 标注新增
 * Prompt 全部要求模型只输出正文（Markdown），不解释；不依赖真实 provider 即可单测。
 */

export type WritingActionId =
  | 'rewrite'
  | 'expand'
  | 'condense'
  | 'polish'
  | 'fillgaps'
  | 'evidence';

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
  systemPrompt: string;
  /** 组装用户提示：target=选区/块文本（cursor 时为空），contextBlock=文档+反链上下文 */
  buildUserPrompt: (target: string, contextBlock: string) => string;
}

const SYSTEM_BASE =
  '你是 NexNote 内置的 Markdown 笔记写作助手。' +
  '严格只输出处理后的正文（Obsidian 方言 Markdown），不要任何解释、前后缀或代码围栏。' +
  '保持原文语言，保留其中的双链 [[...]]、标签 #tag 与 ^id 块锚点语法。';

const contextSection = (contextBlock: string): string =>
  contextBlock.trim()
    ? `\n\n【参考上下文（可能已被截断，仅供理解，不要照抄）】\n${contextBlock.trim()}`
    : '';

export const WRITING_ACTIONS: WritingActionDef[] = [
  {
    id: 'rewrite',
    label: '改写',
    keywords: ['gaixie', 'rewrite', '重写'],
    kind: 'replace',
    modKey: 'r',
    systemPrompt: `${SYSTEM_BASE}\n任务：在保持原意的前提下改写文本，使表达更清晰流畅，可调整句式但不增删观点。`,
    buildUserPrompt: (target, ctx) =>
      `请改写下面的文本，输出改写后的完整正文。\n\n【待改写文本】\n${target}${contextSection(ctx)}`,
  },
  {
    id: 'polish',
    label: '润色',
    keywords: ['runse', 'polish', '润色', '校对'],
    kind: 'replace',
    modKey: 'p',
    systemPrompt: `${SYSTEM_BASE}\n任务：润色文本，修正语病、错别字与标点，提升措辞，尽量不改变结构与长度。`,
    buildUserPrompt: (target, ctx) =>
      `请润色下面的文本，输出润色后的完整正文。\n\n【待润色文本】\n${target}${contextSection(ctx)}`,
  },
  {
    id: 'condense',
    label: '缩写',
    keywords: ['suoxie', 'condense', '精简', '摘要'],
    kind: 'replace',
    modKey: 'c',
    systemPrompt: `${SYSTEM_BASE}\n任务：缩写文本，保留核心观点，去除冗余，输出更精炼的正文。`,
    buildUserPrompt: (target, ctx) =>
      `请缩写下面的文本，保留要点，输出缩写后的正文。\n\n【待缩写文本】\n${target}${contextSection(ctx)}`,
  },
  {
    id: 'expand',
    label: '扩写',
    keywords: ['kuoxie', 'expand', '展开', '丰富'],
    kind: 'append',
    modKey: 'e',
    systemPrompt: `${SYSTEM_BASE}\n任务：基于给定文本扩写，补充细节与阐释，输出要新增的正文段落，不要重复原文。`,
    buildUserPrompt: (target, ctx) =>
      `请基于下面的文本扩写，输出要新增的正文（Markdown），不要重复已有内容。\n\n【当前文本】\n${target || '（空块，请基于上文自由展开）'}${contextSection(ctx)}`,
  },
  {
    id: 'fillgaps',
    label: '查漏补缺',
    keywords: ['chalou', 'fillgaps', '补全', 'gap'],
    kind: 'append',
    modKey: 'f',
    systemPrompt: `${SYSTEM_BASE}\n任务：检查文本的论证/信息缺口，补充缺失的衔接、前提或必要说明，输出要新增的正文。`,
    buildUserPrompt: (target, ctx) =>
      `请检查下面文本的缺漏并补充，输出要新增的正文（Markdown），不要重复原文。\n\n【当前文本】\n${target}${contextSection(ctx)}`,
  },
  {
    id: 'evidence',
    label: '补充论据',
    keywords: 'lunju,evidence,论据,举例'.split(','),
    kind: 'append',
    modKey: 'a',
    systemPrompt: `${SYSTEM_BASE}\n任务：为文本的观点补充支撑论据、例子或说明，输出要新增的正文，使用列表组织多条论据。`,
    buildUserPrompt: (target, ctx) =>
      `请为下面文本的观点补充论据/例子，输出要新增的正文（Markdown，列表为佳）。\n\n【当前文本】\n${target}${contextSection(ctx)}`,
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

/** 组装一次写作请求的消息（system + user）。 */
export function buildWritingMessages(
  action: WritingActionDef,
  args: { target: string; contextBlock: string },
): ChatMessage[] {
  return [
    { role: 'system', content: action.systemPrompt },
    { role: 'user', content: action.buildUserPrompt(args.target, args.contextBlock) },
  ];
}
