import type { ReactNode } from 'react';
import type { BubbleIconName } from '@nexnote/kernel';
import { EDITOR_ACTION_CATALOG } from '@nexnote/shared';
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
  Paperclip,
  Pilcrow,
  Puzzle,
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
export const TABLE_ROW_BELOW_ID = 'table:row-below';
export const TABLE_COLUMN_RIGHT_ID = 'table:column-right';
export const TABLE_ROW_DELETE_ID = 'table:row-delete';
export const TABLE_COLUMN_DELETE_ID = 'table:column-delete';
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
  selectionIcon?: BubbleIconName;
  selectionOrder?: number;
}

/** 唯一共享动作定义：名称、图标、分组、模式能力、优先级和执行语义均在此声明。 */
const ICONS: Record<string, ReactNode> = {
  undo: <Undo2 className="size-3.5" />,
  redo: <Redo2 className="size-3.5" />,
  heading: <Heading className="size-3.5" />,
  paragraph: <Pilcrow className="size-3.5" />,
  bold: <Bold className="size-3.5" />,
  italic: <Italic className="size-3.5" />,
  strike: <Strikethrough className="size-3.5" />,
  code: <Code className="size-3.5" />,
  link: <Link className="size-3.5" />,
  wikilink: <span className="text-[10px] font-semibold">[[]]</span>,
  selection: <TextSelect className="size-3.5" />,
  wand: <WandSparkles className="size-3.5" />,
  table: <Table className="size-3.5" />,
  image: <Image className="size-3.5" />,
  attachment: <Paperclip className="size-3.5" />,
  flowchart: <Workflow className="size-3.5" />,
  gantt: <ChartGantt className="size-3.5" />,
  outline: <ListTree className="size-3.5" />,
  plugin: <Puzzle className="size-3.5" />,
  sparkles: <Sparkles className="size-3.5" />,
};

const SELECTION_ACTIONS: Readonly<Record<string, { icon: BubbleIconName; order: number }>> = {
  'format:bold': { icon: 'bold', order: 1 },
  'format:italic': { icon: 'italic', order: 2 },
  'format:strike': { icon: 'strike', order: 3 },
  'format:code': { icon: 'code', order: 4 },
  'format:link': { icon: 'link', order: 5 },
  'format:wikilink': { icon: 'wikilink', order: 6 },
};

/** Renderer 只把 shared catalog 的 icon semantic key 映射为 React component。 */
export const EDITOR_ACTION_MODEL: readonly EditorActionDefinition[] = EDITOR_ACTION_CATALOG.filter(
  (action) =>
    !action.id.startsWith('block:heading:') &&
    ![
      'block:paragraph',
      'block:bullet-list',
      'block:ordered-list',
      'block:task-list',
      'block:blockquote',
      'block:code',
      'insert:horizontal-rule',
    ].includes(action.id),
).map((action) => ({
  id: action.id,
  label: action.name,
  hint: action.hint,
  shortcut: action.shortcut,
  icon: ICONS[action.icon] ?? <Sparkles className="size-3.5" />,
  group: action.group,
  semantic: action.semantic,
  modes: action.modes,
  selectionIcon: SELECTION_ACTIONS[action.id]?.icon,
  selectionOrder: SELECTION_ACTIONS[action.id]?.order,
  priority:
    action.group === 'primary' || action.group === 'ai'
      ? 'persistent'
      : action.group === 'navigation'
        ? 'supplementary'
        : 'secondary',
}));

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
  inTable?: boolean;
}): ToolbarEntrySpec[] {
  const entries = editableEntries('block', options.headingState);
  // DEV-086：光标位于表格内时，把 4 个表格上下文动作折叠为单一「表格」菜单（替代 DEV-070 的平铺）。
  if (options.inTable) {
    const tableMenu: ToolbarMenuSpec = {
      kind: 'menu',
      id: 'toolbar-table-menu',
      label: '表格',
      icon: <Table className="size-3.5" />,
      hint: '表格内行/列操作',
      priority: 'secondary',
      overflowGroup: 'table-ops',
      items: [
        { id: 'table:row-below', label: '在下方插入行', icon: subItemIcon() },
        { id: 'table:column-right', label: '在右侧插入列', icon: subItemIcon() },
        { id: 'table:row-delete', label: '删除行', icon: subItemIcon() },
        { id: 'table:column-delete', label: '删除列', icon: subItemIcon() },
      ],
    };
    const insertMenuIdx = entries.findIndex((e) => e.id === INSERT_MENU_ID);
    entries.splice(insertMenuIdx, 0, tableMenu);
  }
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

/** DEV-086：表格子菜单子项占位图标，避免空 icon 与现有菜单风格不一致。 */
function subItemIcon(): ReactNode {
  return <span className="block size-3.5 rounded-sm border border-current" aria-hidden="true" />;
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
