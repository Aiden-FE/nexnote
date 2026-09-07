import StarterKit from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
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
import { SlashMenu, defaultSlashMenuItems, dedupeSlashItems, sortSlashItemsByGroup } from './slash-menu';
import type { SlashMenuItem } from './slash-menu';
import { createKernelDragHandle } from './drag-handle';
import { Fold } from './fold';
import { SelectionBubble } from './selection-bubble';
import type { BubbleAction } from './selection-bubble';
import { ContextMenu } from './context-menu';
import type { ContextMenuItem } from './context-menu';
import { BlockMenu, blockMenuPluginKey } from './block-menu';
import type { BlockMenuContext, BlockMenuState } from './block-menu';
import type { EditorActionContext } from './action-context';
import { PluginBlock } from './plugin-block';
import { MermaidBlock } from './mermaid';
import { MathBlock, MathInline } from './math';
import { SuggestionMenu, type SuggestionItem, type SuggestionTrigger } from './suggestion-menu';
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
  extraSlashItems?: SlashMenuItem[] | (() => SlashMenuItem[]);
  /**
   * 渲染层追加扩展（DEV-015 内置插件 NodeView 等）：同名扩展后注册者覆盖
   * addNodeView 等字段，内核始终保留 schema/Markdown 往返能力。
   */
  extraExtensions?: Extensions;
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
  /** DEV-017 wikilink 补全候选（query=已输入；渲染层注入 vault 页面）。 */
  wikilinkSuggestions?: (query: string) => SuggestionItem[];
  /** DEV-017 wikilink 补全选中后的回调（红链创建页面等副作用由渲染层执行）。 */
  onWikilinkSuggestionPick?: (item: SuggestionItem) => void;
  /** DEV-017 标签补全候选（query=已输入；渲染层注入已知标签）。 */
  hashtagSuggestions?: (query: string) => SuggestionItem[];
  /** DEV-017 块菜单（点击块拖拽手柄弹出；false/缺省关闭）。 */
  blockMenu?:
    | false
    | {
        build: (ctx: BlockMenuContext) => ContextMenuItem[];
        onAction: (id: string, ctx: BlockMenuContext) => void;
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
      link: false, // 由下方独立 Link 配置（支持 setLink/unsetLink 命令）
      trailingNode: {},
      undoRedo: { depth: 200, newGroupDelay: 400 },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
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
    // DEV-015：Obsidian 方言内置块（Mermaid/KaTeX），往返能力始终在线，
    // 富预览 NodeView 由渲染层经 extraExtensions 叠加。
    MermaidBlock,
    MathBlock,
    MathInline,
    Fold,
    ...createBlockIdExtensions(),
    Markdown.configure({ marked: createObsidianMarked() }),
  ];

  if (options.extraExtensions) extensions.push(...options.extraExtensions);

  // DEV-017：wikilink（[[）/ 标签（#）补全菜单。候选由渲染层注入，节点插入由内核负责。
  const triggers: SuggestionTrigger[] = [];
  if (options.wikilinkSuggestions) {
      triggers.push({
        name: 'wikilink',
        kind: 'wikilink',
        trigger: '[[',
        className: 'nexnote-suggestion',
        modifierClassName: 'nexnote-suggestion--wikilink',
        suggestions: options.wikilinkSuggestions,
        onPick: options.onWikilinkSuggestionPick,
      });
    }
    if (options.hashtagSuggestions) {
      triggers.push({
        name: 'hashtag',
        kind: 'hashtag',
        trigger: '#',
        requireWhitespaceBefore: true,
        className: 'nexnote-suggestion',
        modifierClassName: 'nexnote-suggestion--hashtag',
        suggestions: options.hashtagSuggestions,
      });
    }
  if (triggers.length > 0) extensions.push(SuggestionMenu.configure({ triggers }));

  if (options.slashMenu !== false) {
    const extra = options.extraSlashItems ?? [];
    extensions.push(
      SlashMenu.configure({
        items: (query: string) => {
          const q = query.trim().toLowerCase();
          // 函数式 extraSlashItems 在每次打开菜单时实时求值（跟踪插件启停）
          const extraItems = typeof extra === 'function' ? extra() : extra;
          // 合并后按 id 去重（渲染层/插件覆盖同名内核默认项）并按分组排序（同组连续）
          const merged = sortSlashItemsByGroup(
            dedupeSlashItems([...defaultSlashMenuItems(query), ...extraItems]),
          );
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
  if (options.dragHandle !== false) {
    extensions.push(
      createKernelDragHandle((_e, pos, blockId, editor) => {
        // 点击手柄 → 打开块菜单（存储 showAt 经扩展名取，菜单配置由渲染层注入）
        if (!options.blockMenu || !blockId) return;
        const menu = blockMenuPluginKey.getState(editor.state) as BlockMenuState | undefined;
        const view = editor.view;
        const coords = view.coordsAtPos(pos);
        menu?.showAt(view, coords.left, coords.bottom, blockId);
      }),
    );
  }
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
  if (options.blockMenu) {
    extensions.push(
      BlockMenu.configure({
        build: options.blockMenu.build,
        onAction: options.blockMenu.onAction,
        className: 'nexnote-block-menu',
      }),
    );
  }

  return extensions;
}

export { createObsidianMarked };
