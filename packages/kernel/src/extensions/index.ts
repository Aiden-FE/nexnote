import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import type { Extensions } from '@tiptap/core';

import { Callout } from './callout';
import { Wikilink } from './wikilink';
import { Hashtag } from './hashtag';
import { Frontmatter } from './frontmatter';
import { KernelCodeBlock, KernelTable, KernelTableCell, KernelTableHeader, KernelTableRow } from './code-table';
import { createBlockIdExtensions } from './block-id';
import { SlashMenu, defaultSlashMenuItems } from './slash-menu';
import type { SlashMenuItem } from './slash-menu';
import { createKernelDragHandle } from './drag-handle';
import { SelectionBubble } from './selection-bubble';
import type { BubbleAction } from './selection-bubble';
import { ContextMenu } from './context-menu';
import type { ContextMenuItem } from './context-menu';
import type { EditorActionContext } from './action-context';
import { PluginBlock } from './plugin-block';
import { createObsidianMarked } from '../markdown/pipeline';

export interface KernelExtensionsOptions {
  /** 斜杠菜单是否启用（测试环境可关） */
  slashMenu?: boolean;
  /** 拖拽手柄是否启用 */
  dragHandle?: boolean;
  /** 图片允许的协议（默认全部交给渲染层 URL 处理） */
  allowBase64?: boolean;
  /** wikilink Ctrl/Cmd+点击回调 */
  onWikilinkActivate?: (target: string) => void;
  /** 斜杠菜单追加项（渲染层注入 AI 动作等），与默认结构块项合并、同口径过滤。 */
  extraSlashItems?: SlashMenuItem[];
  /** 选区浮动工具栏（false/缺省关闭）。 */
  selectionBubble?:
    | false
    | { actions: BubbleAction[]; onAction: (id: string, ctx: EditorActionContext) => void };
  /** 编辑器右键菜单（false/缺省关闭）。 */
  contextMenu?:
    | false
    | {
        build: (ctx: EditorActionContext) => ContextMenuItem[];
        onAction: (id: string, ctx: EditorActionContext) => void;
      };
}

/**
 * 内核扩展集：StarterKit 子集 + TaskList + Table + CodeBlockLowlight +
 * Blockquote(StarterKit) + 自定义 Callout + Image + HorizontalRule(StarterKit) +
 * UniqueID(^id) + Frontmatter + Wikilink + Hashtag + Markdown + SlashMenu + DragHandle。
 *
 * 注意：StarterKit 禁用其自带 codeBlock/table 相关默认（codeBlock 由 Lowlight 版替换）。
 */
export function buildKernelExtensions(options: KernelExtensionsOptions = {}): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      codeBlock: false, // 由 CodeBlockLowlight 替代
      trailingNode: {},
      undoRedo: { depth: 200, newGroupDelay: 400 },
    }),
    KernelCodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    KernelTable.configure({ resizable: true }),
    KernelTableRow,
    KernelTableHeader,
    KernelTableCell,
    Image.configure({ allowBase64: options.allowBase64 ?? true, inline: false }),
    Frontmatter,
    Callout,
    Wikilink.configure({ onActivate: options.onWikilinkActivate }),
    Hashtag,
    PluginBlock,
    ...createBlockIdExtensions(),
    Markdown.configure({ marked: createObsidianMarked() }),
  ];

  if (options.slashMenu !== false) {
    const extra = options.extraSlashItems ?? [];
    extensions.push(
      SlashMenu.configure({
        items: (query: string) => {
          const q = query.trim().toLowerCase();
          const merged = [...defaultSlashMenuItems(query), ...extra];
          if (!q) return merged;
          return merged.filter(
            (it) =>
              it.title.toLowerCase().includes(q) ||
              it.id.toLowerCase().includes(q) ||
              (it.keywords ?? []).some((k) => k.includes(q)),
          );
        },
      }),
    );
  }
  if (options.dragHandle !== false) extensions.push(createKernelDragHandle());
  if (options.selectionBubble) {
    extensions.push(
      SelectionBubble.configure({
        actions: options.selectionBubble.actions,
        onAction: options.selectionBubble.onAction,
      }),
    );
  }
  if (options.contextMenu) {
    extensions.push(
      ContextMenu.configure({
        build: options.contextMenu.build,
        onAction: options.contextMenu.onAction,
      }),
    );
  }

  return extensions;
}

export { createObsidianMarked };
