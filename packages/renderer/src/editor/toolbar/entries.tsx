import type { ReactNode } from 'react';
import {
  Bold,
  ChartGantt,
  Code,
  Columns2,
  Eye,
  EyeOff,
  FileCode2,
  Heading,
  Image,
  Italic,
  Link,
  ListTree,
  PanelRight,
  Paperclip,
  Pilcrow,
  Redo2,
  Sparkles,
  Strikethrough,
  Table,
  TextSelect,
  Undo2,
  WandSparkles,
  Workflow,
} from 'lucide-react';
import { WRITING_ACTIONS, toAiActionId } from '../../features/ai/writing';
import { TRANSLATE_DOCUMENT_ID } from '../../features/ai/translation/actions';
import {
  FORMAT_BOLD,
  FORMAT_CODE,
  FORMAT_ITALIC,
  FORMAT_LINK,
  FORMAT_STRIKE,
  FORMAT_WIKILINK,
} from '../interactions/format-ids';

export const AI_ENTRY_ID = 'ai';
export const AI_ASK_ID = 'ai:ask';
export const AI_INSERT_ID = 'ai:insert';
export const FORMAT_MENU_ID = 'menu:format';
export const INSERT_MENU_ID = 'menu:insert';
export const BLOCK_TYPE_MENU_ID = 'block:type';
export const PARAGRAPH_ID = 'block:paragraph';
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export const headingId = (level: HeadingLevel): string => `block:heading:${level}`;
export const INSERT_IMAGE_ID = 'insert:image';
export const INSERT_ATTACHMENT_ID = 'insert:attachment';
export const UNDO_ID = 'edit:undo';
export const REDO_ID = 'edit:redo';
export const INSERT_TABLE_ID = 'insert:table';
export const FORMAT_SELECTION_ID = 'format:selection';
export const FORMAT_DOCUMENT_ID = 'format:document';
export const INSERT_FLOWCHART_ID = 'insert:mermaid-flowchart';
export const INSERT_GANTT_ID = 'insert:mermaid-gantt';
export const INSERT_TOC_ID = 'insert:toc';
export const TOGGLE_OUTLINE_ID = 'view:outline';
export const VIEW_SOURCE_ID = 'view:source';
export const VIEW_SPLIT_ID = 'view:split';
export const VIEW_BLOCK_ID = 'view:block';
export const VIEW_PREVIEW_ID = 'view:preview';

export type EditorActionMode = 'block' | 'source' | 'preview';
export type EditorActionGroup = 'primary' | 'format' | 'insert' | 'ai' | 'view' | 'navigation';
export type EditorActionSemantic =
  'history' | 'format' | 'insert' | 'block-type' | 'ai' | 'view' | 'navigation';
export type ToolbarPriority = 'persistent' | 'secondary' | 'supplementary';

export interface EditorActionDefinition {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: ReactNode;
  group: EditorActionGroup;
  semantic: EditorActionSemantic;
  modes: readonly EditorActionMode[];
  priority: ToolbarPriority;
}

/** 唯一共享动作定义：名称、图标、分组、模式能力、优先级和执行语义均在此声明。 */
export const EDITOR_ACTION_MODEL: readonly EditorActionDefinition[] = [
  {
    id: UNDO_ID,
    label: '撤销',
    hint: '撤销（⌘Z）',
    shortcut: '⌘Z',
    icon: <Undo2 className="size-3.5" />,
    group: 'primary',
    semantic: 'history',
    modes: ['block', 'source'],
    priority: 'persistent',
  },
  {
    id: REDO_ID,
    label: '重做',
    hint: '重做（⌘⇧Z）',
    shortcut: '⌘⇧Z',
    icon: <Redo2 className="size-3.5" />,
    group: 'primary',
    semantic: 'history',
    modes: ['block', 'source'],
    priority: 'persistent',
  },
  {
    id: BLOCK_TYPE_MENU_ID,
    label: '标题/段落',
    hint: '转换当前块或当前 Markdown 行',
    icon: <Heading className="size-3.5" />,
    group: 'primary',
    semantic: 'block-type',
    modes: ['block', 'source'],
    priority: 'persistent',
  },
  {
    id: FORMAT_BOLD,
    label: '粗体',
    hint: '粗体（⌘B）',
    shortcut: '⌘B',
    icon: <Bold className="size-3.5" />,
    group: 'primary',
    semantic: 'format',
    modes: ['block', 'source'],
    priority: 'persistent',
  },
  {
    id: FORMAT_ITALIC,
    label: '斜体',
    hint: '斜体（⌘I）',
    shortcut: '⌘I',
    icon: <Italic className="size-3.5" />,
    group: 'primary',
    semantic: 'format',
    modes: ['block', 'source'],
    priority: 'persistent',
  },
  {
    id: FORMAT_WIKILINK,
    label: '双链',
    hint: '双链 [[页面名]]',
    icon: <span className="text-[10px] font-semibold">[[]]</span>,
    group: 'primary',
    semantic: 'format',
    modes: ['block', 'source'],
    priority: 'persistent',
  },
  {
    id: FORMAT_STRIKE,
    label: '删除线',
    hint: '删除线（⌘⇧X）',
    shortcut: '⌘⇧X',
    icon: <Strikethrough className="size-3.5" />,
    group: 'format',
    semantic: 'format',
    modes: ['block', 'source'],
    priority: 'secondary',
  },
  {
    id: FORMAT_CODE,
    label: '行内代码',
    hint: '行内代码',
    icon: <Code className="size-3.5" />,
    group: 'format',
    semantic: 'format',
    modes: ['block', 'source'],
    priority: 'secondary',
  },
  {
    id: FORMAT_LINK,
    label: '外链',
    hint: '外链（⌘K）',
    shortcut: '⌘K',
    icon: <Link className="size-3.5" />,
    group: 'format',
    semantic: 'format',
    modes: ['block', 'source'],
    priority: 'secondary',
  },
  {
    id: FORMAT_SELECTION_ID,
    label: '格式化选区',
    icon: <TextSelect className="size-3.5" />,
    group: 'format',
    semantic: 'format',
    modes: ['source'],
    priority: 'secondary',
  },
  {
    id: FORMAT_DOCUMENT_ID,
    label: '格式化全文',
    icon: <WandSparkles className="size-3.5" />,
    group: 'format',
    semantic: 'format',
    modes: ['source'],
    priority: 'secondary',
  },
  {
    id: INSERT_TABLE_ID,
    label: '表格',
    hint: '插入 2×2 Markdown 表格',
    icon: <Table className="size-3.5" />,
    group: 'insert',
    semantic: 'insert',
    modes: ['block', 'source'],
    priority: 'secondary',
  },
  {
    id: INSERT_IMAGE_ID,
    label: '图片',
    hint: '导入图片并插入光标处',
    icon: <Image className="size-3.5" />,
    group: 'insert',
    semantic: 'insert',
    modes: ['block'],
    priority: 'secondary',
  },
  {
    id: INSERT_ATTACHMENT_ID,
    label: '附件',
    hint: '导入附件并插入链接',
    icon: <Paperclip className="size-3.5" />,
    group: 'insert',
    semantic: 'insert',
    modes: ['block'],
    priority: 'secondary',
  },
  {
    id: INSERT_FLOWCHART_ID,
    label: '流程图',
    hint: '插入 Mermaid 流程图',
    icon: <Workflow className="size-3.5" />,
    group: 'insert',
    semantic: 'insert',
    modes: ['block', 'source'],
    priority: 'secondary',
  },
  {
    id: INSERT_GANTT_ID,
    label: '甘特图',
    hint: '插入 Mermaid 甘特图',
    icon: <ChartGantt className="size-3.5" />,
    group: 'insert',
    semantic: 'insert',
    modes: ['block', 'source'],
    priority: 'secondary',
  },
  {
    id: INSERT_TOC_ID,
    label: '正文目录',
    hint: '在正文中插入目录',
    icon: <ListTree className="size-3.5" />,
    group: 'insert',
    semantic: 'insert',
    modes: ['block', 'source'],
    priority: 'secondary',
  },
  {
    id: AI_ENTRY_ID,
    label: 'AI',
    hint: 'AI 写作与对话入口',
    icon: <Sparkles className="size-3.5" />,
    group: 'ai',
    semantic: 'ai',
    modes: ['block', 'source'],
    priority: 'persistent',
  },
  {
    id: TOGGLE_OUTLINE_ID,
    label: '悬浮目录',
    hint: '显示或隐藏悬浮目录',
    icon: <PanelRight className="size-3.5" />,
    group: 'navigation',
    semantic: 'navigation',
    modes: ['block', 'source', 'preview'],
    priority: 'supplementary',
  },
];

const actionById = new Map(EDITOR_ACTION_MODEL.map((action) => [action.id, action]));
export function editorAction(id: string): EditorActionDefinition {
  const action = actionById.get(id);
  if (!action) throw new Error(`Unknown editor action: ${id}`);
  return action;
}
export function editorActionsForMode(mode: EditorActionMode): EditorActionDefinition[] {
  return EDITOR_ACTION_MODEL.filter((action) => action.modes.includes(mode));
}

export interface ToolbarSubItemSpec {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
}
export interface ToolbarActionSpec {
  kind: 'action';
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  shortcut?: string;
  priority?: ToolbarPriority;
  overflowGroup?: string;
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
}
export interface ToolbarMenuSpec {
  kind: 'menu';
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  shortcut?: string;
  priority?: ToolbarPriority;
  overflowGroup?: string;
  items: ToolbarSubItemSpec[];
}
export type ToolbarEntrySpec = ToolbarActionSpec | ToolbarMenuSpec;

function actionEntry(id: string): ToolbarActionSpec {
  return { kind: 'action', ...editorAction(id) };
}
function subItem(id: string): ToolbarSubItemSpec {
  const action = editorAction(id);
  return { id: action.id, label: action.label, icon: action.icon, shortcut: action.shortcut };
}

export function aiSubItems(): ToolbarSubItemSpec[] {
  const icon = editorAction(AI_ENTRY_ID).icon;
  return [
    { id: AI_ASK_ID, label: '询问 AI（送入对话）', icon },
    { id: AI_INSERT_ID, label: 'AI 插入（光标处）', icon },
    ...WRITING_ACTIONS.map((action) => ({
      id: toAiActionId(action.id),
      label: `AI · ${action.label}`,
      icon,
      shortcut: `⌘⌥${action.modKey.toUpperCase()}`,
    })),
    { id: TRANSLATE_DOCUMENT_ID, label: '翻译全文（临时视图）', icon },
  ];
}
export function aiSubActionIds(): string[] {
  return WRITING_ACTIONS.map((action) => toAiActionId(action.id));
}

export interface HeadingActionState {
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
}
function headingEntry(state: HeadingActionState = {}): ToolbarMenuSpec {
  const common = { disabled: state.disabled, disabledReason: state.disabledReason };
  return {
    kind: 'menu',
    ...editorAction(BLOCK_TYPE_MENU_ID),
    items: [
      { id: PARAGRAPH_ID, label: '正文', icon: <Pilcrow className="size-3.5" />, ...common },
      ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
        id: headingId(level),
        label: level === 1 ? '页面标题 H1 · 首个正文 H1 与文件名同步' : `标题 H${level}`,
        icon: <span className="w-3.5 text-center text-[10px] font-semibold">H{level}</span>,
        ...common,
      })),
    ],
  };
}
function menuFor(mode: 'block' | 'source', group: 'format' | 'insert'): ToolbarMenuSpec {
  const menu =
    group === 'format'
      ? {
          id: FORMAT_MENU_ID,
          label: '格式',
          icon: <TextSelect className="size-3.5" />,
          hint: '更多格式动作',
        }
      : {
          id: INSERT_MENU_ID,
          label: '插入',
          icon: <Table className="size-3.5" />,
          hint: '插入结构或媒体',
        };
  return {
    kind: 'menu',
    ...menu,
    priority: 'secondary',
    items: editorActionsForMode(mode)
      .filter((action) => action.group === group)
      .map((action) => subItem(action.id)),
  };
}
function aiEntry(): ToolbarMenuSpec {
  return { kind: 'menu', ...editorAction(AI_ENTRY_ID), items: aiSubItems() };
}
function viewEntry(id: string, label: string, hint: string, icon: ReactNode): ToolbarActionSpec {
  return {
    kind: 'action',
    id,
    label,
    hint,
    icon,
    priority: 'supplementary',
    overflowGroup: 'view-switcher',
  };
}
function editableEntries(
  mode: 'block' | 'source',
  headingState?: HeadingActionState,
): ToolbarEntrySpec[] {
  const primary = editorActionsForMode(mode).filter((action) => action.group === 'primary');
  return [
    actionEntry(UNDO_ID),
    actionEntry(REDO_ID),
    headingEntry(headingState),
    ...primary
      .filter((action) => ![UNDO_ID, REDO_ID, BLOCK_TYPE_MENU_ID].includes(action.id))
      .map((action) => actionEntry(action.id)),
    menuFor(mode, 'format'),
    menuFor(mode, 'insert'),
    aiEntry(),
  ];
}
export function blockToolbarEntries(options: {
  sourceModeToggle: boolean;
  headingState?: HeadingActionState;
}): ToolbarEntrySpec[] {
  const entries = editableEntries('block', options.headingState);
  if (options.sourceModeToggle)
    entries.push(
      viewEntry(
        VIEW_SOURCE_ID,
        '源码',
        '打开源码模式（⌘/Ctrl+E）',
        <FileCode2 className="size-3.5" />,
      ),
    );
  entries.push(actionEntry(TOGGLE_OUTLINE_ID));
  return entries;
}
export function sourceToolbarEntries(options: {
  isMarkdown: boolean;
  markdownView?: 'source' | 'split' | 'preview';
  previewVisible?: boolean;
  previewOnly?: boolean;
  headingState?: HeadingActionState;
}): ToolbarEntrySpec[] {
  const view = options.markdownView ?? (options.previewVisible === false ? 'source' : 'split');
  const entries: ToolbarEntrySpec[] = options.previewOnly
    ? []
    : editableEntries('source', options.headingState);
  if (!options.isMarkdown && !options.previewOnly)
    entries.push(
      viewEntry(
        VIEW_BLOCK_ID,
        '块编辑',
        '切回块编辑模式（⌘/Ctrl+E）',
        <Code className="size-3.5" />,
      ),
    );
  if (options.isMarkdown)
    entries.push(
      viewEntry(VIEW_SOURCE_ID, '源码', '仅显示 Markdown 源码', <FileCode2 className="size-3.5" />),
      viewEntry(VIEW_SPLIT_ID, '分栏', '源码与实时预览', <Columns2 className="size-3.5" />),
      viewEntry(
        VIEW_PREVIEW_ID,
        '预览',
        '仅显示只读预览',
        view === 'preview' ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />,
      ),
    );
  entries.push(actionEntry(TOGGLE_OUTLINE_ID));
  return entries;
}
