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
import { SlashMenu } from './slash-menu';
import { createKernelDragHandle } from './drag-handle';
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
    ...createBlockIdExtensions(),
    Markdown.configure({ marked: createObsidianMarked() }),
  ];

  if (options.slashMenu !== false) extensions.push(SlashMenu);
  if (options.dragHandle !== false) extensions.push(createKernelDragHandle());

  return extensions;
}

export { createObsidianMarked };
