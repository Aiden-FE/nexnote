import type { ReactNode } from 'react';
import {
  Bold,
  Code,
  Eye,
  EyeOff,
  FileCode2,
  Image,
  Italic,
  Link,
  Paperclip,
  Sparkles,
  Strikethrough,
} from 'lucide-react';
import { WRITING_ACTIONS, toAiActionId } from '../../features/ai/writing';
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
  /** 快捷键提示（菜单右侧展示） */
  shortcut?: string;
  disabled?: boolean;
}

export interface ToolbarActionSpec {
  kind: 'action';
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: ReactNode;
  disabled?: boolean;
}

export interface ToolbarMenuSpec {
  kind: 'menu';
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  items: ToolbarSubItemSpec[];
}

export type ToolbarEntrySpec = ToolbarActionSpec | ToolbarMenuSpec;

/** AI 入口 id（整体折叠单元：空间不足时连同子动作一起进「更多」）。 */
export const AI_ENTRY_ID = 'ai';
/** 询问 AI 子动作 id（送入对话）。 */
export const AI_ASK_ID = 'ai:ask';
export const INSERT_IMAGE_ID = 'insert:image';
export const INSERT_ATTACHMENT_ID = 'insert:attachment';
export const VIEW_SOURCE_ID = 'view:source';
export const VIEW_BLOCK_ID = 'view:block';
export const VIEW_PREVIEW_ID = 'view:preview';

/** AI 入口的子动作：询问 AI + 六个白名单写作动作（子动作必须键盘可达）。 */
export function aiSubItems(): ToolbarSubItemSpec[] {
  return [
    { id: AI_ASK_ID, label: '询问 AI（送入对话）' },
    ...WRITING_ACTIONS.map((action) => ({
      id: toAiActionId(action.id),
      label: `AI · ${action.label}`,
      shortcut: `⌘⌥${action.modKey.toUpperCase()}`,
    })),
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

/** 块编辑工具栏动作：格式 + 插入（图片/附件）+ AI 入口（+ Markdown 页的源码入口）。 */
export function blockToolbarEntries(options: { sourceModeToggle: boolean }): ToolbarEntrySpec[] {
  const entries: ToolbarEntrySpec[] = [
    ...formatEntries(),
    {
      kind: 'action',
      id: INSERT_IMAGE_ID,
      label: '图片',
      hint: '导入图片并插入光标处',
      icon: <Image className="size-3.5" />,
    },
    {
      kind: 'action',
      id: INSERT_ATTACHMENT_ID,
      label: '附件',
      hint: '导入附件并插入链接',
      icon: <Paperclip className="size-3.5" />,
    },
    aiEntry(),
  ];
  if (options.sourceModeToggle) {
    entries.push({
      kind: 'action',
      id: VIEW_SOURCE_ID,
      label: '源码',
      hint: '打开源码模式（⌘/Ctrl+E）',
      shortcut: '⌘E',
      icon: <FileCode2 className="size-3.5" />,
    });
  }
  return entries;
}

/** 源码模式工具栏动作：格式 + AI 入口 + 视图切换（块编辑 / 预览）。 */
export function sourceToolbarEntries(options: {
  isMarkdown: boolean;
  previewVisible: boolean;
}): ToolbarEntrySpec[] {
  const entries: ToolbarEntrySpec[] = [
    ...formatEntries(),
    aiEntry(),
    {
      kind: 'action',
      id: VIEW_BLOCK_ID,
      label: '块编辑',
      hint: '切回块编辑模式（⌘/Ctrl+E）',
      shortcut: '⌘E',
      icon: <Code className="size-3.5" />,
    },
  ];
  if (options.isMarkdown) {
    entries.push({
      kind: 'action',
      id: VIEW_PREVIEW_ID,
      label: options.previewVisible ? '隐藏预览' : '显示预览',
      hint: options.previewVisible ? '隐藏预览（⌘/Ctrl+E）' : '显示预览（⌘/Ctrl+E）',
      shortcut: '⌘E',
      icon: options.previewVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />,
    });
  }
  return entries;
}
