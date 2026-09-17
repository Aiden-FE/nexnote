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
export type QuickInsertGroup = '基础块' | '插入' | 'AI' | '插件';
export type QuickInsertKind = 'block-type' | 'structure' | 'inline' | 'ai' | 'plugin';
export type QuickInsertExecution =
  | 'convert-empty-block'
  | 'insert-safe-block'
  | 'insert-at-cursor'
  | 'explicit-ai'
  | 'external-command';
export type QuickInsertCapability =
  'empty-block' | 'editable-line' | 'explicit-ai' | 'plugin-defined';

export const SLASH_ACTION_GROUP_ORDER: readonly QuickInsertGroup[] = [
  '基础块',
  '插入',
  'AI',
  '插件',
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
  name: string;
  icon: EditorActionIconKey;
  semantic: EditorActionSemantic;
  group: EditorActionGroup;
  modes: readonly EditorActionMode[];
  hint?: string;
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
    name: '撤销',
    icon: 'undo',
    semantic: 'history',
    hint: '撤销（⌘Z）',
    shortcut: '⌘Z',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'edit:redo',
    name: '重做',
    icon: 'redo',
    semantic: 'history',
    hint: '重做（⌘⇧Z）',
    shortcut: '⌘⇧Z',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'block:type',
    name: '标题/段落',
    icon: 'heading',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'block:paragraph',
    name: '正文',
    icon: 'paragraph',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('基础块', 'block-type', 'convert-empty-block', 'empty-block', [
      'paragraph',
      'text',
      'p',
      '正文',
      '段落',
    ]),
  },
  ...([1, 2, 3, 4, 5, 6] as const).map((level): EditorActionCatalogEntry => ({
    id: `block:heading:${level}`,
    name: level === 1 ? '页面标题 H1' : `标题 H${level}`,
    icon: 'heading',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('基础块', 'block-type', 'convert-empty-block', 'empty-block', [
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
    name: '无序列表',
    icon: 'list',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('基础块', 'block-type', 'convert-empty-block', 'empty-block', [
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
    name: '有序列表',
    icon: 'list',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('基础块', 'block-type', 'convert-empty-block', 'empty-block', [
      'list',
      'ordered',
      'ol',
      '1.',
      '有序列表',
    ]),
  },
  {
    id: 'block:task-list',
    name: '任务列表',
    icon: 'task',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('基础块', 'block-type', 'convert-empty-block', 'empty-block', [
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
    name: '引用',
    icon: 'quote',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('基础块', 'block-type', 'convert-empty-block', 'empty-block', [
      'quote',
      'blockquote',
      '>',
      '引用',
    ]),
  },
  {
    id: 'block:code',
    name: '代码块',
    icon: 'code',
    semantic: 'block-type',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('基础块', 'block-type', 'convert-empty-block', 'empty-block', [
      'code',
      'code block',
      '```',
      '代码',
    ]),
  },
  {
    id: 'format:bold',
    name: '粗体',
    icon: 'bold',
    semantic: 'format',
    hint: '粗体（⌘B）',
    shortcut: '⌘B',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'format:italic',
    name: '斜体',
    icon: 'italic',
    semantic: 'format',
    hint: '斜体（⌘I）',
    shortcut: '⌘I',
    group: 'primary',
    modes: ['block', 'source'],
  },
  {
    id: 'format:wikilink',
    name: '双链',
    icon: 'wikilink',
    semantic: 'format',
    hint: '双链 [[页面名]]',
    group: 'primary',
    modes: ['block', 'source'],
    quickInsert: quick('插入', 'inline', 'insert-at-cursor', 'editable-line', [
      'wikilink',
      'link',
      '[[',
      '双链',
    ]),
  },
  {
    id: 'format:strike',
    name: '删除线',
    icon: 'strike',
    semantic: 'format',
    hint: '删除线（⌘⇧X）',
    shortcut: '⌘⇧X',
    group: 'format',
    modes: ['block', 'source'],
  },
  {
    id: 'format:code',
    name: '行内代码',
    icon: 'code',
    semantic: 'format',
    hint: '行内代码（⌘E）',
    shortcut: '⌘E',
    group: 'format',
    modes: ['block', 'source'],
  },
  {
    id: 'format:link',
    name: '外链',
    icon: 'link',
    semantic: 'format',
    hint: '外链（⌘K）',
    shortcut: '⌘K',
    group: 'format',
    modes: ['block', 'source'],
  },
  {
    id: 'format:selection',
    name: '格式化选区',
    icon: 'selection',
    semantic: 'format',
    group: 'format',
    modes: ['source'],
  },
  {
    id: 'format:document',
    name: '格式化全文',
    icon: 'wand',
    semantic: 'format',
    group: 'format',
    modes: ['source'],
  },
  {
    id: 'insert:horizontal-rule',
    name: '分隔线',
    hint: '在当前块后插入分隔线',
    icon: 'rule',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('插入', 'structure', 'insert-safe-block', 'editable-line', [
      'hr',
      'rule',
      '---',
      '分隔线',
    ]),
  },
  {
    id: 'insert:table',
    name: '表格',
    hint: '插入 2×2 Markdown 表格',
    icon: 'table',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('插入', 'structure', 'insert-safe-block', 'editable-line', [
      'table',
      'grid',
      '|',
      '表格',
    ]),
  },
  {
    id: 'insert:image',
    name: '图片',
    hint: '导入图片并插入安全块边界',
    icon: 'image',
    semantic: 'insert',
    group: 'insert',
    modes: ['block'],
    quickInsert: quick('插入', 'structure', 'insert-safe-block', 'editable-line', [
      'image',
      'img',
      'picture',
      '图片',
    ]),
  },
  {
    id: 'insert:attachment',
    name: '附件',
    hint: '导入附件并插入安全块边界',
    icon: 'attachment',
    semantic: 'insert',
    group: 'insert',
    modes: ['block'],
    quickInsert: quick('插入', 'structure', 'insert-safe-block', 'editable-line', [
      'attachment',
      'file',
      '附件',
    ]),
  },
  {
    id: 'insert:mermaid-flowchart',
    name: '流程图',
    hint: '插入 Mermaid 流程图',
    icon: 'flowchart',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('插入', 'structure', 'insert-safe-block', 'editable-line', [
      'mermaid',
      '流程',
      'flow',
      'flowchart',
      'chart',
    ]),
  },
  {
    id: 'insert:mermaid-gantt',
    name: '甘特图',
    hint: '插入 Mermaid 甘特图',
    icon: 'gantt',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('插入', 'structure', 'insert-safe-block', 'editable-line', [
      'mermaid',
      '甘特',
      'gantt',
    ]),
  },
  {
    id: 'insert:toc',
    name: '正文目录',
    hint: '在正文中插入目录',
    icon: 'outline',
    semantic: 'insert',
    group: 'insert',
    modes: ['block', 'source'],
    quickInsert: quick('插入', 'structure', 'insert-safe-block', 'editable-line', [
      'toc',
      'table of contents',
      '目录',
      '正文目录',
    ]),
  },
  {
    id: 'ai:insert',
    name: 'AI 插入',
    hint: '指令…',
    icon: 'sparkles',
    semantic: 'ai',
    group: 'ai',
    modes: ['block', 'source'],
    quickInsert: quick('AI', 'ai', 'explicit-ai', 'explicit-ai', [
      'ai',
      'insert',
      'prompt',
      '生成',
      '插入',
    ]),
  },
  {
    id: 'ai',
    name: 'AI',
    icon: 'sparkles',
    semantic: 'ai',
    group: 'ai',
    modes: ['block', 'source'],
  },
  {
    id: 'view:outline',
    name: '悬浮目录',
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
      '插件',
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

export function quickInsertCatalog(mode: EditorActionMode): EditorActionCatalogEntry[] {
  return EDITOR_ACTION_CATALOG.filter(
    (action) => action.quickInsert && action.modes.includes(mode),
  );
}
