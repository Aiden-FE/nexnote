import { Editor } from '@tiptap/core';
import type { Extensions, JSONContent } from '@tiptap/core';

import { buildKernelExtensions } from './extensions';
import type { KernelExtensionsOptions } from './extensions';
import { createMarkdownManager, parseMarkdown, serializeMarkdown } from './markdown/pipeline';
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
  /** 文档变更（含结构）时的轻量回调 */
  onDocChange?: (json: JSONContent) => void;
}

export interface EditorKernelInstance {
  /** 编辑器原始实例（渲染层可挂 React view 或调用命令） */
  readonly editor: Editor;
  /** 当前内容序列化为 Markdown（Obsidian 方言） */
  getMarkdown(): string;
  /** 用 Markdown 替换内容（走 parse 管道；不触发保存回调） */
  setMarkdown(markdown: string): void;
  /** 当前文档 JSON */
  getJSON(): JSONContent;
  /** 文档首个 H1 文本（无则 null）——文件名联动用 */
  getFirstHeading(): string | null;
  /** frontmatter 原文（无则 null） */
  getFrontmatter(): string | null;
  /** revision 计数（每次文档变更 +1；协作预留） */
  getRevision(): number;
  /** 立即触发待保存内容的保存回调 */
  flushPendingSave(): Promise<void>;
  /** 是否有待保存内容 */
  hasPendingSave(): boolean;
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
    onUpdate() {
      revision += 1;
      scheduler.schedule(kernel.getMarkdown());
    },
  });

  const kernel: EditorKernelInstance = {
    editor,
    getMarkdown() {
      return serializeMarkdown(manager, editor.getJSON());
    },
    setMarkdown(markdown: string) {
      const json = parseMarkdown(manager, markdown);
      editor.commands.setContent(json, { emitUpdate: false });
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
    getRevision() {
      return revision;
    },
    flushPendingSave() {
      return scheduler.flush();
    },
    hasPendingSave() {
      return scheduler.hasPending();
    },
    undo() {
      return editor.chain().focus('end').undo().run();
    },
    redo() {
      return editor.chain().focus('end').redo().run();
    },
    destroy() {
      scheduler.cancel();
      editor.destroy();
    },
  };

  options.onDocChange?.(editor.getJSON());

  return kernel;
}
