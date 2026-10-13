import { CATALOGS, translate as translateMessage, type UiLanguage } from '../i18n/message-catalog';

export type EditorActionMode = 'block' | 'source' | 'preview';
export type EditorActionGroup = 'primary' | 'format' | 'insert' | 'ai' | 'view' | 'navigation';
export type EditorActionSemantic =
  'history' | 'format' | 'insert' | 'block-type' | 'ai' | 'view' | 'navigation';
export type EditorActionIconKey =
  | 'undo'
  | 'redo'
  | 'heading'
  | 'paragraph'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'link'
  | 'text-color'
  | 'background-color'
  | 'wikilink'
  | 'selection'
  | 'wand'
  | 'table'
  | 'image'
  | 'attachment'
  | 'flowchart'
  | 'gantt'
  | 'outline'
  | 'rule'
  | 'quote'
  | 'list'
  | 'task'
  | 'sparkles'
  | 'plugin';
export type QuickInsertGroup = 'basic' | 'insert' | 'ai' | 'plugin';
export type QuickInsertKind = 'block-type' | 'structure' | 'inline' | 'ai' | 'plugin';
export type QuickInsertExecution =
  | 'convert-empty-block'
  | 'insert-safe-block'
  | 'insert-at-cursor'
  | 'explicit-ai'
  | 'external-command';
export type QuickInsertCapability =
  'empty-block' | 'editable-line' | 'explicit-ai' | 'plugin-defined' | 'table-cursor';

export const SLASH_ACTION_GROUP_ORDER: readonly QuickInsertGroup[] = [
  'basic',
  'insert',
  'ai',
  'plugin',
];

export interface QuickInsertMetadata {
  group: QuickInsertGroup;
  aliases: readonly string[];
  kind: QuickInsertKind;
  execution: QuickInsertExecution;
  capability: QuickInsertCapability;
}

/**
 * 编辑器动作的框架无关单一事实来源。React 图标与具体 handler 由 renderer/kernel
 * 适配；shared 仅声明稳定语义、能力和快捷插入执行契约。
 */
export interface EditorActionCatalogEntry {
  id: string;
  nameKey: string;
  icon: EditorActionIconKey;
  semantic: EditorActionSemantic;
  group: EditorActionGroup;
  modes: readonly EditorActionMode[];
  hintKey?: string;
  shortcut?: string;
  quickInsert?: QuickInsertMetadata;
}

const quick = (
  group: QuickInsertGroup,
  kind: QuickInsertKind,
  execution: QuickInsertExecution,
  capability: QuickInsertCapability,
  aliases: readonly string[],
): QuickInsertMetadata => ({ group, kind, execution, capability, aliases });

export const EDITOR_ACTION_CATALOG: readonly EditorActionCatalogEntry[] = [
  {
    id: 'edit:undo',
    nameKey: 'editorAction.edit:undo.name',
    icon: 'undo',
    semantic: 'history',
    hintKey: 'editorAction.edit:undo.hint',
    shortcut: '⌘Z',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'edit:redo',
    nameKey: 'editorAction.edit:redo.name',
    icon: 'redo',
    semantic: 'history',
    hintKey: 'editorAction.edit:redo.hint',
    shortcut: '⌘⇧Z',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'block:type',
    nameKey: 'editorAction.block:type.name',
    icon: 'heading',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'block:paragraph',
    nameKey: 'editorAction.block:paragraph.name',
    icon: 'paragraph',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('basic', 'block-type', 'convert-empty-block', 'empty-block', [
      'paragraph',
      'text',
      'p',
      '正文',
      '段落',
    ]),
  },
  ...([1, 2, 3, 4, 5, 6] as const).map((level): EditorActionCatalogEntry => ({
    id: `block:heading:${level}`,
    nameKey:
      level === 1
        ? 'editorAction.block:heading:1.name'
        : `editorAction.block:heading:${level}.name`,
    icon: 'heading',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('basic', 'block-type', 'convert-empty-block', 'empty-block', [
      ...(level === 1 ? ['heading'] : []),
      `heading ${level}`,
      `h${level}`,
      '#'.repeat(level),
      `${['一', '二', '三', '四', '五', '六'][level - 1]}级标题`,
      `标题 ${level}`,
    ]),
  })),
  {
    id: 'block:bullet-list',
    nameKey: 'editorAction.block:bullet-list.name',
    icon: 'list',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('basic', 'block-type', 'convert-empty-block', 'empty-block', [
      'list',
      'bullet',
      'ul',
      '-',
      '*',
      '无序列表',
    ]),
  },
  {
    id: 'block:ordered-list',
    nameKey: 'editorAction.block:ordered-list.name',
    icon: 'list',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('basic', 'block-type', 'convert-empty-block', 'empty-block', [
      'list',
      'ordered',
      'ol',
      '1.',
      '有序列表',
    ]),
  },
  {
    id: 'block:task-list',
    nameKey: 'editorAction.block:task-list.name',
    icon: 'task',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('basic', 'block-type', 'convert-empty-block', 'empty-block', [
      'task',
      'todo',
      'checkbox',
      '- [ ]',
      '任务',
      '待办',
    ]),
  },
  {
    id: 'block:blockquote',
    nameKey: 'editorAction.block:blockquote.name',
    icon: 'quote',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('basic', 'block-type', 'convert-empty-block', 'empty-block', [
      'quote',
      'blockquote',
      '>',
      '引用',
    ]),
  },
  {
    id: 'block:code',
    nameKey: 'editorAction.block:code.name',
    icon: 'code',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('basic', 'block-type', 'convert-empty-block', 'empty-block', [
      'code',
      'code block',
      '```',
      '代码',
    ]),
  },
  {
    id: 'format:bold',
    nameKey: 'editorAction.format:bold.name',
    icon: 'bold',
    semantic: 'format',
    hintKey: 'editorAction.format:bold.hint',
    shortcut: '⌘B',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'format:italic',
    nameKey: 'editorAction.format:italic.name',
    icon: 'italic',
    semantic: 'format',
    hintKey: 'editorAction.format:italic.hint',
    shortcut: '⌘I',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'format:wikilink',
    nameKey: 'editorAction.format:wikilink.name',
    icon: 'wikilink',
    semantic: 'format',
    hintKey: 'editorAction.format:wikilink.hint',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('insert', 'inline', 'insert-at-cursor', 'editable-line', [
      'wikilink',
      'link',
      '[[',
      '双链',
    ]),
  },
  {
    id: 'format:strike',
    nameKey: 'editorAction.format:strike.name',
    icon: 'strike',
    semantic: 'format',
    hintKey: 'editorAction.format:strike.hint',
    shortcut: '⌘⇧X',
    group: 'format',
    modes: ['block', 'source'],
  },
  {
    id: 'format:code',
    nameKey: 'editorAction.format:code.name',
    icon: 'code',
    semantic: 'format',
    hintKey: 'editorAction.format:code.hint',
    shortcut: '⌘E',
    group: 'format',
    modes: ['block', 'source'],
  },
  {
    id: 'format:link',
    nameKey: 'editorAction.format:link.name',
    icon: 'link',
    semantic: 'format',
    hintKey: 'editorAction.format:link.hint',
    shortcut: '⌘K',
    group: 'format',
    modes: ['block', 'source'],
  },
  {
    id: 'format:text-color',
    nameKey: 'editorAction.format:text-color.name',
    icon: 'text-color',
    semantic: 'format',
    hintKey: 'editorAction.format:text-color.hint',
    group: 'format',
    // 颜色走 HTML span 落盘，源码视图手写 span 同样可解析，故两个模式都在
    modes: ['block', 'source'],
  },
  {
    id: 'format:background-color',
    nameKey: 'editorAction.format:background-color.name',
    icon: 'background-color',
    semantic: 'format',
    hintKey: 'editorAction.format:background-color.hint',
    group: 'format',
    modes: ['block', 'source'],
  },
  {
    id: 'format:selection',
    nameKey: 'editorAction.format:selection.name',
    icon: 'selection',
    semantic: 'format',
    group: 'format',
    modes: ['source'],
  },
  {
    id: 'format:document',
    nameKey: 'editorAction.format:document.name',
    icon: 'wand',
    semantic: 'format',
    group: 'format',
    modes: ['source'],
  },
  {
    id: 'insert:horizontal-rule',
    nameKey: 'editorAction.insert:horizontal-rule.name',
    hintKey: 'editorAction.insert:horizontal-rule.hint',
    icon: 'rule',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('insert', 'structure', 'insert-safe-block', 'editable-line', [
      'hr',
      'rule',
      '---',
      '分隔线',
    ]),
  },
  {
    id: 'insert:table',
    nameKey: 'editorAction.insert:table.name',
    hintKey: 'editorAction.insert:table.hint',
    icon: 'table',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('insert', 'structure', 'insert-safe-block', 'editable-line', [
      'table',
      'grid',
      '|',
      '表格',
    ]),
  },
  {
    id: 'table:row-below',
    nameKey: 'editorAction.table:row-below.name',
    hintKey: 'editorAction.table:row-below.hint',
    icon: 'table',
    semantic: 'insert',
    group: 'insert',
    modes: ['block'],
    quickInsert: quick('insert', 'structure', 'insert-at-cursor', 'table-cursor', [
      'row',
      '行',
      '插入行',
    ]),
  },
  {
    id: 'table:column-right',
    nameKey: 'editorAction.table:column-right.name',
    hintKey: 'editorAction.table:column-right.hint',
    icon: 'table',
    semantic: 'insert',
    group: 'insert',
    modes: ['block'],
    quickInsert: quick('insert', 'structure', 'insert-at-cursor', 'table-cursor', [
      'column',
      '列',
      '插入列',
    ]),
  },
  {
    id: 'table:row-delete',
    nameKey: 'editorAction.table:row-delete.name',
    hintKey: 'editorAction.table:row-delete.hint',
    icon: 'table',
    semantic: 'insert',
    group: 'insert',
    modes: ['block'],
    quickInsert: quick('insert', 'structure', 'insert-at-cursor', 'table-cursor', [
      '删除行',
      'delete row',
    ]),
  },
  {
    id: 'table:column-delete',
    nameKey: 'editorAction.table:column-delete.name',
    hintKey: 'editorAction.table:column-delete.hint',
    icon: 'table',
    semantic: 'insert',
    group: 'insert',
    modes: ['block'],
    quickInsert: quick('insert', 'structure', 'insert-at-cursor', 'table-cursor', [
      '删除列',
      'delete column',
    ]),
  },
  {
    id: 'insert:image',
    nameKey: 'editorAction.insert:image.name',
    hintKey: 'editorAction.insert:image.hint',
    icon: 'image',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('insert', 'structure', 'insert-safe-block', 'editable-line', [
      'image',
      'img',
      'picture',
      '图片',
    ]),
  },
  {
    id: 'insert:attachment',
    nameKey: 'editorAction.insert:attachment.name',
    hintKey: 'editorAction.insert:attachment.hint',
    icon: 'attachment',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('insert', 'structure', 'insert-safe-block', 'editable-line', [
      'attachment',
      'file',
      '附件',
    ]),
  },
  {
    id: 'insert:mermaid-flowchart',
    nameKey: 'editorAction.insert:mermaid-flowchart.name',
    hintKey: 'editorAction.insert:mermaid-flowchart.hint',
    icon: 'flowchart',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('insert', 'structure', 'insert-safe-block', 'editable-line', [
      'mermaid',
      '流程',
      'flow',
      'flowchart',
      'chart',
    ]),
  },
  {
    id: 'insert:mermaid-gantt',
    nameKey: 'editorAction.insert:mermaid-gantt.name',
    hintKey: 'editorAction.insert:mermaid-gantt.hint',
    icon: 'gantt',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('insert', 'structure', 'insert-safe-block', 'editable-line', [
      'mermaid',
      '甘特',
      'gantt',
    ]),
  },
  {
    id: 'insert:toc',
    nameKey: 'editorAction.insert:toc.name',
    hintKey: 'editorAction.insert:toc.hint',
    icon: 'outline',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('insert', 'structure', 'insert-safe-block', 'editable-line', [
      'toc',
      'table of contents',
      '目录',
      '正文目录',
    ]),
  },
  {
    id: 'ai:insert',
    nameKey: 'editorAction.ai:insert.name',
    hintKey: 'editorAction.ai:insert.hint',
    icon: 'sparkles',
    semantic: 'ai',
    group: 'ai',
    modes: ['block', 'source'],
    quickInsert: quick('ai', 'ai', 'explicit-ai', 'explicit-ai', [
      'ai',
      'insert',
      'prompt',
      '生成',
      '插入',
    ]),
  },
  {
    id: 'ai',
    nameKey: 'editorAction.ai.name',
    icon: 'sparkles',
    semantic: 'ai',
    group: 'ai',
    modes: ['block', 'source'],
  },
  {
    id: 'view:outline',
    nameKey: 'editorAction.view:outline.name',
    icon: 'outline',
    semantic: 'navigation',
    group: 'navigation',
    modes: ['block', 'source', 'preview'],
  },
];

const catalogById = new Map(EDITOR_ACTION_CATALOG.map((action) => [action.id, action]));

/** Dynamic plugin contributions share one host-owned slash metadata contract. */
export function pluginQuickInsertMetadata(
  kind: 'block' | 'command',
): Pick<EditorActionCatalogEntry, 'icon'> & { quickInsert: QuickInsertMetadata } {
  return {
    icon: 'plugin',
    quickInsert: quick(
      'plugin',
      'plugin',
      kind === 'block' ? 'insert-safe-block' : 'external-command',
      'plugin-defined',
      ['插件', 'plugin', kind],
    ),
  };
}

export function editorActionCatalogEntry(id: string): EditorActionCatalogEntry | undefined {
  return catalogById.get(id);
}

/** 按界面语言取快捷插入分组标题（ADR-0023）。 */
export function quickInsertGroupName(group: QuickInsertGroup, language: UiLanguage): string {
  return translateMessage(CATALOGS[language], `editorAction.group.${group}.name`, language);
}

/** 按界面语言取动作显示名（ADR-0023）。key 缺失时回退动作 id，保证可见。 */
export function editorActionName(entry: EditorActionCatalogEntry, language: UiLanguage): string {
  const text = translateMessage(CATALOGS[language], entry.nameKey, language);
  return text === entry.nameKey ? entry.id : text;
}

/** 按界面语言取动作提示；无 hintKey 时返回 undefined。 */
export function editorActionHint(
  entry: EditorActionCatalogEntry,
  language: UiLanguage,
): string | undefined {
  if (!entry.hintKey) return undefined;
  const text = translateMessage(CATALOGS[language], entry.hintKey, language);
  return text === entry.hintKey ? undefined : text;
}

export interface QuickInsertCandidate<T> {
  item: T;
  id: string;
  title: string;
  aliases?: readonly string[];
  keywords?: readonly string[];
  contract?: Pick<QuickInsertMetadata, 'execution' | 'capability'>;
  group?: string;
  available?: boolean;
}

/** One framework-independent search and authorization policy for both editing surfaces. */
export function filterQuickInsertCandidates<T>(
  candidates: readonly QuickInsertCandidate<T>[],
  query: string,
  capabilities: ReadonlySet<QuickInsertCapability>,
  emptyBlock: boolean,
): T[] {
  const q = query.trim().toLocaleLowerCase();
  const groupRank = (group?: string) => {
    const index = (SLASH_ACTION_GROUP_ORDER as readonly string[]).indexOf(group ?? '');
    return index < 0 ? SLASH_ACTION_GROUP_ORDER.length : index;
  };
  return candidates
    .map((candidate, index) => {
      const terms = [
        candidate.title,
        candidate.id,
        ...(candidate.aliases ?? []),
        ...(candidate.keywords ?? []),
      ];
      const score = !q
        ? 0
        : terms.reduce<number | null>((best, value) => {
            const term = value.toLocaleLowerCase();
            const next = term === q ? 0 : term.startsWith(q) ? 1 : term.includes(q) ? 2 : null;
            return next === null || (best !== null && best <= next) ? best : next;
          }, null);
      return { candidate, index, score };
    })
    .filter(
      (entry): entry is { candidate: QuickInsertCandidate<T>; index: number; score: number } =>
        entry.score !== null &&
        entry.candidate.available !== false &&
        !!entry.candidate.contract &&
        capabilities.has(entry.candidate.contract.capability) &&
        (entry.candidate.contract.execution !== 'convert-empty-block' || emptyBlock),
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        groupRank(a.candidate.group) - groupRank(b.candidate.group) ||
        a.index - b.index,
    )
    .map(({ candidate }) => candidate.item);
}

export function quickInsertCatalog(mode: EditorActionMode): EditorActionCatalogEntry[] {
  return EDITOR_ACTION_CATALOG.filter(
    (action) => action.quickInsert && action.modes.includes(mode),
  );
}
