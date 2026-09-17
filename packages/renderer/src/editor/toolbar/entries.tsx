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
} from '../interactions/formatting';

/**
 * DEV-035 编辑器工具栏的动作表（声明式，ADR-0006）。
 *
 * 规格里只有 id / 文案 / 图标，不含处理函数：两种编辑模式共用同一套动作定义，
 * 命令由各自的 `onCommand(id)` 分发（块编辑走内核，源码模式走 CodeMirror）。
 * 这样工具栏组件不需要知道编辑器类型，模式差异只落在分发函数里。
 */

export interface ToolbarSubItemSpec {
  id: string;
  label: string;
  icon?: ReactNode;
  /** 快捷键提示（菜单右侧展示） */
  shortcut?: string;
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
}

export interface ToolbarActionSpec {
  kind: 'action';
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: ReactNode;
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
  overflowGroup?: string;
}

export interface ToolbarMenuSpec {
  kind: 'menu';
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: ReactNode;
  items: ToolbarSubItemSpec[];
  disabledReason?: string | (() => string | undefined);
  overflowGroup?: string;
}

export type ToolbarEntrySpec = ToolbarActionSpec | ToolbarMenuSpec;

/** AI 入口 id（整体折叠单元：空间不足时连同子动作一起进「更多」）。 */
export const AI_ENTRY_ID = 'ai';
/** 询问 AI 子动作 id（送入对话）。 */
export const AI_ASK_ID = 'ai:ask';
/** 明确的光标处 AI 插入入口，与斜杠菜单「AI 插入」同语义。 */
export const AI_INSERT_ID = 'ai:insert';
export const FORMAT_MENU_ID = 'menu:format';
export const INSERT_MENU_ID = 'menu:insert';
export const BLOCK_TYPE_MENU_ID = 'block:type';
export const PARAGRAPH_ID = 'block:paragraph';
export const headingId = (level: number): string => `block:heading:${level}`;
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

export interface EditorActionDefinition {
  id: string;
  label: string;
  group: EditorActionGroup;
  modes: readonly EditorActionMode[];
}

/** 无 UI 依赖的稳定语义/能力目录，供工具栏、划词与快捷输入逐步复用。 */
export const EDITOR_ACTION_MODEL: readonly EditorActionDefinition[] = [
  { id: UNDO_ID, label: '撤销', group: 'primary', modes: ['block', 'source'] },
  { id: REDO_ID, label: '重做', group: 'primary', modes: ['block', 'source'] },
  { id: BLOCK_TYPE_MENU_ID, label: '标题/段落', group: 'primary', modes: ['block', 'source'] },
  { id: FORMAT_BOLD, label: '粗体', group: 'primary', modes: ['block', 'source'] },
  { id: FORMAT_ITALIC, label: '斜体', group: 'primary', modes: ['block', 'source'] },
  { id: FORMAT_WIKILINK, label: '双链', group: 'primary', modes: ['block', 'source'] },
  { id: FORMAT_STRIKE, label: '删除线', group: 'format', modes: ['block', 'source'] },
  { id: FORMAT_CODE, label: '行内代码', group: 'format', modes: ['block', 'source'] },
  { id: FORMAT_LINK, label: '外链', group: 'format', modes: ['block', 'source'] },
  { id: INSERT_TABLE_ID, label: '表格', group: 'insert', modes: ['block', 'source'] },
  { id: INSERT_IMAGE_ID, label: '图片', group: 'insert', modes: ['block'] },
  { id: INSERT_ATTACHMENT_ID, label: '附件', group: 'insert', modes: ['block'] },
  { id: INSERT_FLOWCHART_ID, label: '流程图', group: 'insert', modes: ['block', 'source'] },
  { id: INSERT_GANTT_ID, label: '甘特图', group: 'insert', modes: ['block', 'source'] },
  { id: INSERT_TOC_ID, label: '正文目录', group: 'insert', modes: ['block', 'source'] },
  { id: AI_ENTRY_ID, label: 'AI', group: 'ai', modes: ['block', 'source'] },
  {
    id: TOGGLE_OUTLINE_ID,
    label: '悬浮目录',
    group: 'navigation',
    modes: ['block', 'source', 'preview'],
  },
];

export function editorActionsForMode(mode: EditorActionMode): EditorActionDefinition[] {
  return EDITOR_ACTION_MODEL.filter((action) => action.modes.includes(mode));
}

/**
 * AI 入口的子动作：询问 AI + 六个白名单写作动作 + 全文翻译（子动作必须键盘可达）。
 * DEV-041 全文翻译只打开临时只读视图，不写回正文。
 */
export function aiSubItems(): ToolbarSubItemSpec[] {
  return [
    { id: AI_ASK_ID, label: '询问 AI（送入对话）' },
    { id: AI_INSERT_ID, label: 'AI 插入（光标处）' },
    ...WRITING_ACTIONS.map((action) => ({
      id: toAiActionId(action.id),
      label: `AI · ${action.label}`,
      shortcut: `⌘⌥${action.modKey.toUpperCase()}`,
    })),
    { id: TRANSLATE_DOCUMENT_ID, label: '翻译全文（临时视图）' },
  ];
}

/** AI 写作子动作 id（不含「询问 AI」）。 */
export function aiSubActionIds(): string[] {
  return WRITING_ACTIONS.map((action) => toAiActionId(action.id));
}

/** 格式动作（两种模式同 id、同文案；块编辑映射 TipTap 命令，源码映射 Markdown 包裹）。 */
function formatEntries(): ToolbarEntrySpec[] {
  return [
    {
      kind: 'action',
      id: FORMAT_BOLD,
      label: '粗体',
      hint: '粗体（⌘B）',
      shortcut: '⌘B',
      icon: <Bold className="size-3.5" />,
    },
    {
      kind: 'action',
      id: FORMAT_ITALIC,
      label: '斜体',
      hint: '斜体（⌘I）',
      shortcut: '⌘I',
      icon: <Italic className="size-3.5" />,
    },
    {
      kind: 'action',
      id: FORMAT_STRIKE,
      label: '删除线',
      hint: '删除线（⌘⇧X）',
      shortcut: '⌘⇧X',
      icon: <Strikethrough className="size-3.5" />,
    },
    {
      kind: 'action',
      id: FORMAT_CODE,
      label: '代码',
      hint: '行内代码',
      icon: <Code className="size-3.5" />,
    },
    {
      kind: 'action',
      id: FORMAT_LINK,
      label: '链接',
      hint: '外链（⌘K）',
      shortcut: '⌘K',
      icon: <Link className="size-3.5" />,
    },
    {
      kind: 'action',
      id: FORMAT_WIKILINK,
      label: '双链',
      hint: '双链 [[页面名]]',
      icon: <span className="text-[10px] font-semibold">[[]]</span>,
    },
  ];
}

/** 撤销/重做（分别由 TipTap 与 CodeMirror 分发）。 */
function historyEntries(): ToolbarEntrySpec[] {
  return [
    {
      kind: 'action',
      id: UNDO_ID,
      label: '撤销',
      hint: '撤销（⌘Z）',
      shortcut: '⌘Z',
      icon: <Undo2 className="size-3.5" />,
    },
    {
      kind: 'action',
      id: REDO_ID,
      label: '重做',
      hint: '重做（⌘⇧Z）',
      shortcut: '⌘⇧Z',
      icon: <Redo2 className="size-3.5" />,
    },
  ];
}

/** 两种编辑模式都支持的结构插入动作。 */
function structuralEntries(): ToolbarEntrySpec[] {
  return [
    {
      kind: 'action',
      id: INSERT_TABLE_ID,
      label: '表格',
      hint: '插入 2×2 Markdown 表格',
      icon: <Table className="size-3.5" />,
    },
    {
      kind: 'action',
      id: INSERT_FLOWCHART_ID,
      label: '流程图',
      hint: '插入 Mermaid 流程图',
      icon: <Workflow className="size-3.5" />,
    },
    {
      kind: 'action',
      id: INSERT_GANTT_ID,
      label: '甘特图',
      hint: '插入 Mermaid 甘特图',
      icon: <ChartGantt className="size-3.5" />,
    },
    {
      kind: 'action',
      id: INSERT_TOC_ID,
      label: '正文目录',
      hint: '在正文中插入目录',
      icon: <ListTree className="size-3.5" />,
    },
  ];
}

/** 源码 Markdown 的格式整理动作。 */
function sourceFormatEntries(): ToolbarEntrySpec[] {
  return [
    {
      kind: 'action',
      id: FORMAT_SELECTION_ID,
      label: '格式化选区',
      icon: <TextSelect className="size-3.5" />,
    },
    {
      kind: 'action',
      id: FORMAT_DOCUMENT_ID,
      label: '格式化全文',
      icon: <WandSparkles className="size-3.5" />,
    },
  ];
}

function outlineEntry(): ToolbarActionSpec {
  return {
    kind: 'action',
    id: TOGGLE_OUTLINE_ID,
    label: '悬浮目录',
    hint: '显示或隐藏悬浮目录',
    icon: <PanelRight className="size-3.5" />,
  };
}

/** AI 入口（两种模式共用）。 */
function aiEntry(): ToolbarMenuSpec {
  return {
    kind: 'menu',
    id: AI_ENTRY_ID,
    label: 'AI',
    hint: 'AI 写作与对话入口',
    icon: <Sparkles className="size-3.5" />,
    items: aiSubItems(),
  };
}

export interface HeadingActionState {
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
}

function headingEntry(state: HeadingActionState = {}): ToolbarMenuSpec {
  const common = { disabled: state.disabled, disabledReason: state.disabledReason };
  return {
    kind: 'menu',
    id: BLOCK_TYPE_MENU_ID,
    label: '标题/段落',
    hint: '转换当前块或当前 Markdown 行',
    icon: <Heading className="size-3.5" />,
    items: [
      { id: PARAGRAPH_ID, label: '正文', icon: <Pilcrow className="size-3.5" />, ...common },
      ...Array.from({ length: 6 }, (_, index) => {
        const level = index + 1;
        return {
          id: headingId(level),
          label: level === 1 ? '页面标题 H1 · 首个正文 H1 与文件名同步' : `标题 H${level}`,
          icon: <span className="w-3.5 text-center text-[10px] font-semibold">H{level}</span>,
          ...common,
        };
      }),
    ],
  };
}

function menuItem(entry: ToolbarEntrySpec): ToolbarSubItemSpec {
  return {
    id: entry.id,
    label: entry.label,
    icon: entry.icon,
    shortcut: entry.shortcut,
    disabled: entry.kind === 'action' ? entry.disabled : undefined,
    disabledReason: entry.kind === 'action' ? entry.disabledReason : undefined,
  };
}

function entryById(id: string, entries: ToolbarEntrySpec[]): ToolbarEntrySpec {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown toolbar entry: ${id}`);
  return entry;
}

function formatMenu(source: boolean): ToolbarMenuSpec {
  const formats = formatEntries();
  const items = [FORMAT_STRIKE, FORMAT_CODE, FORMAT_LINK].map((id) =>
    menuItem(entryById(id, formats)),
  );
  if (source) items.push(...sourceFormatEntries().map(menuItem));
  return {
    kind: 'menu',
    id: FORMAT_MENU_ID,
    label: '格式',
    icon: <TextSelect className="size-3.5" />,
    items,
  };
}

function insertMenu(mode: 'block' | 'source'): ToolbarMenuSpec {
  const entries: ToolbarEntrySpec[] = [...structuralEntries()];
  if (mode === 'block')
    entries.splice(
      1,
      0,
      { kind: 'action', id: INSERT_IMAGE_ID, label: '图片', icon: <Image className="size-3.5" /> },
      {
        kind: 'action',
        id: INSERT_ATTACHMENT_ID,
        label: '附件',
        icon: <Paperclip className="size-3.5" />,
      },
    );
  return {
    kind: 'menu',
    id: INSERT_MENU_ID,
    label: '插入',
    icon: <Table className="size-3.5" />,
    items: entries.map(menuItem),
  };
}

function editableEntries(
  mode: 'block' | 'source',
  headingState?: HeadingActionState,
): ToolbarEntrySpec[] {
  const formats = formatEntries();
  return [
    ...historyEntries(),
    headingEntry(headingState),
    entryById(FORMAT_BOLD, formats),
    entryById(FORMAT_ITALIC, formats),
    entryById(FORMAT_WIKILINK, formats),
    formatMenu(mode === 'source'),
    insertMenu(mode),
    aiEntry(),
  ];
}

/** 块编辑工具栏动作：格式 + 插入（图片/附件）+ AI 入口（+ Markdown 页的源码入口）。 */
export function blockToolbarEntries(options: {
  sourceModeToggle: boolean;
  headingState?: HeadingActionState;
}): ToolbarEntrySpec[] {
  const entries = editableEntries('block', options.headingState);
  if (options.sourceModeToggle) {
    entries.push({
      kind: 'action',
      id: VIEW_SOURCE_ID,
      label: '源码',
      hint: '打开源码模式（⌘/Ctrl+E）',
      shortcut: '⌘E',
      icon: <FileCode2 className="size-3.5" />,
      overflowGroup: 'view-switcher',
    });
  }
  entries.push(outlineEntry());
  return entries;
}

/** 源码模式工具栏动作：格式 + AI 入口 + Markdown 三态视图切换。 */
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
  if (!options.isMarkdown && !options.previewOnly) {
    entries.push({
      kind: 'action',
      id: VIEW_BLOCK_ID,
      label: '块编辑',
      hint: '切回块编辑模式（⌘/Ctrl+E）',
      shortcut: '⌘E',
      icon: <Code className="size-3.5" />,
      overflowGroup: 'view-switcher',
    });
  }
  if (options.isMarkdown) {
    entries.push(
      {
        kind: 'action',
        id: VIEW_SOURCE_ID,
        label: '源码',
        hint: '仅显示 Markdown 源码',
        icon: <FileCode2 className="size-3.5" />,
        overflowGroup: 'view-switcher',
      },
      {
        kind: 'action',
        id: VIEW_SPLIT_ID,
        label: '分栏',
        hint: '源码与实时预览',
        icon: <Columns2 className="size-3.5" />,
        overflowGroup: 'view-switcher',
      },
      {
        kind: 'action',
        id: VIEW_PREVIEW_ID,
        label: '预览',
        hint: '仅显示只读预览',
        icon: view === 'preview' ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />,
        overflowGroup: 'view-switcher',
      },
    );
  }
  entries.push(outlineEntry());
  return entries;
}
