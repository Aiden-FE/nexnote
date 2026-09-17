/**
 * 快捷插入的跨编辑器语义定义。
 *
 * 此模型不携带 UI 或 TipTap 实现；块编辑和其他编辑形态可从这里投影名称、
 * 别名、分组与能力边界，而各自保留自己的输入与执行适配器。
 */
export type SlashActionGroup = '基础块' | '插入' | 'AI' | '插件';
export type SlashActionKind = 'block-type' | 'structure' | 'inline' | 'ai' | 'plugin';

export interface SharedSlashAction {
  id: string;
  label: string;
  aliases: readonly string[];
  group: SlashActionGroup;
  kind: SlashActionKind;
  modes: readonly ('block' | 'source')[];
}

export const SLASH_ACTION_GROUP_ORDER: readonly SlashActionGroup[] = [
  '基础块',
  '插入',
  'AI',
  '插件',
];

/** 基础动作名称、中文/英文/Markdown 记号别名的单一事实来源。 */
export const SHARED_SLASH_ACTIONS: readonly SharedSlashAction[] = [
  {
    id: 'paragraph',
    label: '正文',
    aliases: ['paragraph', 'text', 'p', '正文', '段落'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'heading1',
    label: '页面标题 H1',
    aliases: ['heading', 'heading 1', 'h1', '#', '一级标题', '标题 1'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'heading2',
    label: '标题 H2',
    aliases: ['heading 2', 'h2', '##', '二级标题', '标题 2'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'heading3',
    label: '标题 H3',
    aliases: ['heading 3', 'h3', '###', '三级标题', '标题 3'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'heading4',
    label: '标题 H4',
    aliases: ['heading 4', 'h4', '####', '四级标题', '标题 4'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'heading5',
    label: '标题 H5',
    aliases: ['heading 5', 'h5', '#####', '五级标题', '标题 5'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'heading6',
    label: '标题 H6',
    aliases: ['heading 6', 'h6', '######', '六级标题', '标题 6'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'bulletList',
    label: '无序列表',
    aliases: ['list', 'bullet', 'ul', '-', '*', '无序列表'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'orderedList',
    label: '有序列表',
    aliases: ['list', 'ordered', 'ol', '1.', '有序列表'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'taskList',
    label: '任务列表',
    aliases: ['task', 'todo', 'checkbox', '- [ ]', '任务', '待办'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'blockquote',
    label: '引用',
    aliases: ['quote', 'blockquote', '>', '引用'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'codeBlock',
    label: '代码块',
    aliases: ['code', 'code block', '```', '代码'],
    group: '基础块',
    kind: 'block-type',
    modes: ['block', 'source'],
  },
  {
    id: 'horizontalRule',
    label: '分隔线',
    aliases: ['hr', 'rule', '---', '分隔线'],
    group: '插入',
    kind: 'structure',
    modes: ['block', 'source'],
  },
  {
    id: 'table',
    label: '表格',
    aliases: ['table', 'grid', '|', '表格'],
    group: '插入',
    kind: 'structure',
    modes: ['block', 'source'],
  },
  {
    id: 'tableOfContents',
    label: '正文目录',
    aliases: ['toc', 'table of contents', '目录', '正文目录'],
    group: '插入',
    kind: 'structure',
    modes: ['block', 'source'],
  },
  {
    id: 'wikilink',
    label: '双链',
    aliases: ['wikilink', 'link', '[[', '双链'],
    group: '插入',
    kind: 'inline',
    modes: ['block', 'source'],
  },
];

export function sharedSlashAction(id: string): SharedSlashAction | undefined {
  return SHARED_SLASH_ACTIONS.find((action) => action.id === id);
}
