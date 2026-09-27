import { Editor } from '@tiptap/core';
import type { Extensions, JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';

import { buildKernelExtensions } from './extensions';
import type { KernelExtensionsOptions } from './extensions';
import {
  canFoldBlock,
  clearBlockFolds,
  isBlockFolded,
  toggleBlockFold,
  trustFoldIdentity,
} from './extensions/fold';
import {
  createMarkdownManager,
  parseMarkdown,
  serializeClipboardText,
  serializeMarkdown,
} from './markdown/pipeline';
import { isBlockIdInitTransaction } from './extensions/block-id';
import { createSaveScheduler } from './save';
import type { SaveScheduler } from './save';
import { Frontmatter } from './extensions/frontmatter';

/**
 * 编辑器内核工厂（框架无关）。
 *
 * - createEditor(container, config)：挂载 TipTap 3 编辑器
 * - 内容经 Obsidian 方言 Markdown 双向管道（parse/serialize）
 * - 保存防抖内置：onContentChange 在防抖后携带最新 Markdown 触发
 * - revision：单调递增文档版本号（协作预留，本票仅计数）
 */

export interface EditorKernelConfig extends KernelExtensionsOptions {
  /** 初始 Markdown 内容 */
  initialMarkdown?: string;
  /** 是否可编辑 */
  editable?: boolean;
  /** 防抖保存毫秒（默认 500） */
  saveDelayMs?: number;
  /** 防抖后回调（内容 Markdown；内核已做序列化） */
  onContentChange?: (markdown: string) => void | Promise<void>;
  /** 保存回调异常上报 */
  onSaveError?: (error: unknown) => void;
  /** 用户文档变更（含结构）后同步回调；初始挂载与 setMarkdown 重载不触发 */
  onDocChange?: (json: JSONContent) => void;
}

export interface EditorKernelInstance {
  /** 编辑器原始实例（渲染层可挂 React view 或调用命令） */
  readonly editor: Editor;
  /** 当前内容序列化为 Markdown（Obsidian 方言） */
  getMarkdown(): string;
  /** 用 Markdown 替换内容（走 parse 管道；不触发保存回调） */
  setMarkdown(markdown: string, options?: { preserveSelection?: boolean }): void;
  /** 当前文档 JSON */
  getJSON(): JSONContent;
  /** 文档首个 H1 文本（无则 null）——文件名联动用 */
  getFirstHeading(): string | null;
  /** frontmatter 原文（无则 null） */
  getFrontmatter(): string | null;
  /**
   * 静默同步 frontmatter 原文：仅替换文档首部 frontmatter 节点，保留正文选区，
   * 且不触发 onUpdate（不排盘）。用于应用自身写入后，把磁盘上被刷新过的
   * frontmatter（如 updated）回灌编辑器，避免属性面板显示过期值。DEV-092。
   */
  syncFrontmatter(yaml: string): void;
  /** revision 计数（每次文档变更 +1；协作预留） */
  getRevision(): number;
  /** 立即触发待保存内容的保存回调 */
  flushPendingSave(): Promise<void>;
  /** 是否有待保存内容 */
  hasPendingSave(): boolean;
  /**
   * 按稳定 blockId 重排顶层块（DragHandle 的可测试事务入口）。
   * target 边界 before/after；成功后可 undo/redo，保存后顺序持久化。
   */
  moveBlock(blockId: string, targetBlockId: string, side?: 'before' | 'after'): boolean;
  /**
   * 取出文档区间 [from,to] 的 Obsidian Markdown（块菜单复制/剪切用；会包含 ^id 锚点）。
   */
  getBlockMarkdown(from: number, to: number): string;
  /**
   * 用 Markdown 片段替换 [from,to]（走 parse 管道；可 undo/redo）。
   * 单块内联内容用 insertText 保留块结构；多块/整块内容替换为解析出的顶层块。
   */
  replaceRangeWithMarkdown(from: number, to: number, markdown: string): boolean;
  /**
   * 将 Markdown 片段插入为顶层块（可 undo/redo）。at 为文档任意位置，
   * 内核自动吸附到顶层块边界；side 决定插入到目标块之前/之后。
   */
  insertMarkdownBlocks(markdown: string, at: number, side?: 'before' | 'after'): boolean;
  /** 块是否可折叠（顶层标题块） */
  canFoldBlock(blockId: string): boolean;
  /** 块当前是否已折叠 */
  isBlockFolded(blockId: string): boolean;
  /** 切换标题折叠（视图层状态，不写 Markdown）；不可折叠返回 false */
  toggleBlockFold(blockId: string): boolean;
  /**
   * 块类型转换（块菜单「转换为」）：作用于 [from,to] 顶层块。
   * 支持 h1-h6/paragraph/codeBlock（setBlockType）、taskList（保留文本内容
   * 包裹为 taskList > taskItem > paragraph）、callout/blockquote（合法 wrap）。
   * 结构不合法或类型未知返回 false，不改动文档。
   */
  convertBlock(kind: string, from: number, to: number): boolean;
  /** 在 at 所在顶层块 before/after 插入空段落并把光标移入；可 undo。 */
  insertEmptyBlock(at: number, side: 'before' | 'after'): boolean;
  /** 按 blockId 删除顶层块（先重解析当前位置，避免异步后旧坐标误删）。 */
  deleteBlockById(blockId: string): boolean;
  /** 撤销 */
  undo(): boolean;
  /** 重做 */
  redo(): boolean;
  /** 销毁（取消未落盘的防抖内容） */
  destroy(): void;
}

export function createEditor(
  container: HTMLElement,
  config?: EditorKernelConfig,
): EditorKernelInstance {
  const options: EditorKernelConfig = config ?? {};

  const extensions: Extensions = buildKernelExtensions({
    slashMenu: options.slashMenu,
    dragHandle: options.dragHandle,
    allowBase64: options.allowBase64,
    onWikilinkActivate: options.onWikilinkActivate,
    extraSlashItems: options.extraSlashItems,
    selectionBubble: options.selectionBubble,
    contextMenu: options.contextMenu,
    blockMenu: options.blockMenu,
    extraExtensions: options.extraExtensions,
    wikilinkSuggestions: options.wikilinkSuggestions,
    onWikilinkSuggestionPick: options.onWikilinkSuggestionPick,
    hashtagSuggestions: options.hashtagSuggestions,
  });

  const manager = createMarkdownManager(extensions);

  const initialJson: JSONContent | undefined =
    options.initialMarkdown !== undefined
      ? parseMarkdown(manager, options.initialMarkdown)
      : undefined;

  let revision = 0;

  const scheduler: SaveScheduler = createSaveScheduler({
    delayMs: options.saveDelayMs ?? 500,
    onSave: async (markdown) => {
      await options.onContentChange?.(markdown);
    },
    onError: (e) => options.onSaveError?.(e),
  });

  const editor = new Editor({
    element: container,
    extensions,
    content: initialJson,
    editable: options.editable ?? true,
    enableContentCheck: false,
    editorProps: {
      clipboardTextSerializer: (slice) => serializeClipboardText(manager, slice),
    },
    onUpdate() {
      // 打开文件时 UniqueID 补块 ID 不是用户编辑：不得据此写盘（原文必须逐字节保持）。
      if (isBlockIdInitTransaction(editor)) return;
      // 注：静默同步 frontmatter（syncFrontmatter）用 TipTap 内置的
      // `preventUpdate` 元标记，不会进到这里，故无需额外判断。
      revision += 1;
      options.onDocChange?.(editor.getJSON());
      scheduler.schedule(kernel.getMarkdown());
    },
  });

  const kernel: EditorKernelInstance = {
    editor,
    getMarkdown() {
      return serializeMarkdown(manager, editor.getJSON());
    },
    setMarkdown(markdown: string, options?: { preserveSelection?: boolean }) {
      // 页面重载/切换开启新的编辑视图会话；临时折叠状态不得跨页面沿用。
      clearBlockFolds(editor.view);
      // DEV-092：整篇替换会把光标映射到文档末尾（ProseMirror 对被整体替换的范围
      // 取 assoc=+1）。应用自身联动改写触发重载时，用户可能正在文档中部阅读/编辑，
      // 需要按原位置恢复选区，而不是把光标顶到末尾。
      const previous = options?.preserveSelection
        ? { from: editor.state.selection.from, to: editor.state.selection.to }
        : null;
      const json = parseMarkdown(manager, markdown);
      editor.commands.setContent(json, { emitUpdate: false });
      if (!previous) return;
      const size = editor.state.doc.content.size;
      const clamp = (pos: number): number => Math.max(0, Math.min(pos, size));
      // TextSelection.between 会把位置夹到最近的合法文本位置，避免 resolve 到非法点。
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.between(
            editor.state.doc.resolve(clamp(previous.from)),
            editor.state.doc.resolve(clamp(previous.to)),
          ),
        ),
      );
    },
    getJSON() {
      return editor.getJSON();
    },
    getFirstHeading() {
      const first = editor.state.doc.content.firstChild;
      if (!first || first.type.name !== 'heading') return null;
      const text = first.textContent;
      return text.trim().length > 0 ? text.trim() : null;
    },
    getFrontmatter() {
      const first = editor.state.doc.content.firstChild;
      if (!first || first.type.name !== Frontmatter.name) return null;
      return first.textContent;
    },
    syncFrontmatter(yaml: string) {
      const first = editor.state.doc.content.firstChild;
      const type = editor.state.schema.nodes[Frontmatter.name];
      if (!type) return;
      let tr;
      if (first && first.type.name === Frontmatter.name) {
        if (first.textContent === yaml) return;
        tr =
          yaml.length > 0
            ? editor.state.tr.replaceWith(
                0,
                first.nodeSize,
                type.create(null, editor.state.schema.text(yaml)),
              )
            : editor.state.tr.delete(0, first.nodeSize);
      } else {
        if (yaml.length === 0) return;
        tr = editor.state.tr.insert(0, type.create(null, editor.state.schema.text(yaml)));
      }
      // preventUpdate：应用内部同步而非用户编辑（TipTap 内置标记，抑制 update 事件，
      // 因此不会排盘、也不会把这次同步当成用户输入）。
      editor.view.dispatch(tr.setMeta('preventUpdate', true));
    },
    getRevision() {
      return revision;
    },
    flushPendingSave() {
      return scheduler.flush();
    },
    hasPendingSave() {
      return scheduler.hasPending();
    },
    moveBlock(blockId: string, targetBlockId: string, side = 'before') {
      if (blockId === targetBlockId) return false;
      const nodes: ProseMirrorNode[] = [];
      editor.state.doc.forEach((node) => nodes.push(node));
      const from = nodes.findIndex((n) => n.attrs.blockId === blockId);
      const target = nodes.findIndex((n) => n.attrs.blockId === targetBlockId);
      if (from < 0 || target < 0) return false;
      const [moving] = nodes.splice(from, 1);
      if (!moving) return false;
      let insertAt = nodes.findIndex((n) => n.attrs.blockId === targetBlockId);
      if (insertAt < 0) return false;
      if (side === 'after') insertAt += 1;
      nodes.splice(insertAt, 0, moving);
      editor.view.dispatch(
        editor.state.tr
          .replaceWith(0, editor.state.doc.content.size, Fragment.fromArray(nodes))
          .scrollIntoView(),
      );
      return true;
    },
    getBlockMarkdown(from: number, to: number) {
      const size = editor.state.doc.content.size;
      const f = Math.max(0, Math.min(from, size));
      const t = Math.max(f, Math.min(to, size));
      const nodes: JSONContent[] = [];
      editor.state.doc.slice(f, t).content.forEach((n) => nodes.push(n.toJSON()));
      if (nodes.length === 0) return '';
      return serializeMarkdown(manager, { type: 'doc', content: nodes });
    },
    replaceRangeWithMarkdown(from: number, to: number, markdown: string) {
      const size = editor.state.doc.content.size;
      const f = Math.max(0, Math.min(from, size));
      const t = Math.max(f, Math.min(to, size));
      const json = parseMarkdown(manager, markdown);
      const nodes = (json.content ?? [])
        .filter((n) => n.type !== 'frontmatter')
        .map((n) => editor.schema.nodeFromJSON(n));
      if (nodes.length === 0) {
        editor.view.dispatch(editor.state.tr.delete(f, t).scrollIntoView());
        return true;
      }
      const $from = editor.state.doc.resolve(f);
      const partialInline =
        nodes.length === 1 &&
        nodes[0]!.isTextblock &&
        $from.depth >= 1 &&
        !(f === $from.start() && t === $from.end());
      if (partialInline) {
        const text = nodes[0]!.textContent;
        editor.view.dispatch(editor.state.tr.insertText(text, f, t).scrollIntoView());
        return true;
      }
      let blockFrom = f;
      let blockTo = t;
      if ($from.depth >= 1) blockFrom = $from.before(1);
      const $to = editor.state.doc.resolve(t);
      if ($to.depth >= 1) blockTo = $to.after(1);
      editor.view.dispatch(
        editor.state.tr.replaceWith(blockFrom, blockTo, Fragment.fromArray(nodes)).scrollIntoView(),
      );
      return true;
    },
    insertMarkdownBlocks(markdown: string, at: number, side = 'after') {
      const json = parseMarkdown(manager, markdown);
      const nodes = (json.content ?? [])
        .filter((n) => n.type !== 'frontmatter')
        .map((n) => editor.schema.nodeFromJSON(n));
      if (nodes.length === 0) return false;
      const size = editor.state.doc.content.size;
      let pos = Math.max(0, Math.min(at, size));
      const $p = editor.state.doc.resolve(pos);
      if ($p.depth >= 1) pos = side === 'after' ? $p.after(1) : $p.before(1);
      editor.view.dispatch(editor.state.tr.insert(pos, Fragment.fromArray(nodes)).scrollIntoView());
      return true;
    },
    undo() {
      return editor.chain().focus('end').undo().run();
    },
    canFoldBlock(blockId: string) {
      return canFoldBlock(editor.state, blockId);
    },
    isBlockFolded(blockId: string) {
      return isBlockFolded(editor.state, blockId);
    },
    toggleBlockFold(blockId: string) {
      return toggleBlockFold(editor.view, blockId);
    },
    convertBlock(kind: string, from: number, to: number) {
      const { schema } = editor.state;
      const size = editor.state.doc.content.size;
      const f = Math.max(0, Math.min(from, size));
      const t = Math.max(f, Math.min(to, size));
      const isHeading = /^h[1-6]$/.test(kind);
      const nodeType = schema.nodes[isHeading ? 'heading' : kind];
      if (!nodeType) return false;
      if (isHeading) {
        const level = Number(kind.slice(1));
        // DEV-054：单块升降级保留 blockId（折叠状态按新层级重算）；
        // 多块转换不携带旧 ID，交给 UniqueID 分配，避免重复 blockId。
        const fromBlock = editor.state.doc.nodeAt(f);
        const single = fromBlock && f + fromBlock.nodeSize === t ? fromBlock : null;
        if (single && single.type.name === 'heading') {
          const blockId = (single.attrs as { blockId?: string }).blockId;
          const tr = editor.state.tr.setNodeMarkup(f, undefined, {
            ...single.attrs,
            level,
          });
          if (blockId) trustFoldIdentity(tr, blockId);
          editor.view.dispatch(tr);
          return true;
        }
        editor.view.dispatch(editor.state.tr.setBlockType(f, t, nodeType, { level }));
        return true;
      }
      if (kind === 'paragraph' || kind === 'codeBlock') {
        // textblock → textblock：setBlockType 保留文本（不允许的 mark 由 schema 丢弃）
        const attrs = kind === 'codeBlock' ? { language: 'plaintext' } : {};
        editor.view.dispatch(editor.state.tr.setBlockType(f, t, nodeType, attrs));
        return true;
      }
      if (kind === 'taskList') {
        const { taskList, taskItem, paragraph } = schema.nodes;
        if (!taskList || !taskItem || !paragraph) return false;
        // 保留原块内容：textblock 内容转段落（去标题级别、留内联）；
        // 非 textblock 原样保留，taskItem 首子块必须是 paragraph。
        const content: ProseMirrorNode[] = [];
        editor.state.doc.slice(f, t).content.forEach((n) => {
          content.push(n.isTextblock ? paragraph.create(null, n.content) : n);
        });
        if (content.length === 0) content.push(paragraph.create());
        if (content[0]!.type !== paragraph) content.unshift(paragraph.create());
        editor.view.dispatch(
          editor.state.tr.replaceWith(
            f,
            t,
            taskList.create(null, [taskItem.create(null, content)]),
          ),
        );
        return true;
      }
      // 包一层（callout/blockquote）：先 findWrapping 预检，非法结构 fail closed
      const $from = editor.state.doc.resolve(f);
      const range = $from.blockRange(editor.state.doc.resolve(t));
      if (!range) return false;
      const wrapping = findWrapping(range, nodeType);
      if (!wrapping) return false;
      editor.view.dispatch(editor.state.tr.wrap(range, wrapping));
      return true;
    },
    insertEmptyBlock(at: number, side: 'before' | 'after') {
      const { schema } = editor.state;
      const paragraph = schema.nodes.paragraph;
      if (!paragraph) return false;
      const size = editor.state.doc.content.size;
      let pos = Math.max(0, Math.min(at, size));
      const $p = editor.state.doc.resolve(pos);
      if ($p.depth >= 1) pos = side === 'after' ? $p.after(1) : $p.before(1);
      else pos = side === 'after' ? size : 0;
      const tr = editor.state.tr.insert(pos, paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView();
      editor.view.dispatch(tr);
      return true;
    },
    deleteBlockById(blockId: string) {
      let from = -1;
      let to = -1;
      editor.state.doc.forEach((node, offset) => {
        if (from >= 0) return;
        if ((node.attrs as { blockId?: string }).blockId === blockId) {
          from = offset;
          to = offset + node.nodeSize;
        }
      });
      if (from < 0) return false;
      editor.view.dispatch(editor.state.tr.delete(from, to));
      return true;
    },
    redo() {
      return editor.chain().focus('end').redo().run();
    },
    destroy() {
      scheduler.cancel();
      editor.destroy();
    },
  };

  return kernel;
}
