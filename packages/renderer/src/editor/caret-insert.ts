import { useSyncExternalStore } from 'react';
import type { EditorView } from '@codemirror/view';
import { getActiveEditor, subscribeActiveEditor } from './active-editor';
import { getActiveSourceEditor, subscribeActiveSourceEditor } from './source/active-source-editor';
import type { EditorKernelInstance } from '@nexnote/kernel';

/**
 * 双模式光标插入基座（DEV-036，ADR-0006）。
 *
 * 「当前编辑上下文」的唯一判定：源码模式（CodeMirror）注册在案时它就是当前上下文，
 * 否则回退块编辑内核（TipTap）。SplitView 只挂载活动 tab 的编辑器，两者互斥；
 * 若因异常同时存在，优先源码（markdown tab 永不挂 TipTap，源码在案即处于源码态）。
 *
 * 插入语义：写入当前光标（有选区则替换选区），两种编辑器均以单个事务提交 →
 * 一次 undo 整体撤销。没有活动编辑器（设置、图谱等 Tab）时调用方应禁用入口。
 */

export type ActiveInsertionMode = 'block' | 'source' | null;

/** 当前可写入的编辑上下文；null = 没有活动编辑器。 */
export function getActiveInsertionMode(): ActiveInsertionMode {
  if (getActiveSourceEditor()) return 'source';
  if (getActiveEditor()) return 'block';
  return null;
}

function subscribeInsertionMode(listener: () => void): () => void {
  const unsubscribeBlock = subscribeActiveEditor(listener);
  const unsubscribeSource = subscribeActiveSourceEditor(listener);
  return () => {
    unsubscribeBlock();
    unsubscribeSource();
  };
}

/** React 组件订阅：编辑器挂载/卸载/聚焦切换时重渲染（返回字符串字面量，快照稳定）。 */
export function useActiveInsertionMode(): ActiveInsertionMode {
  return useSyncExternalStore(
    subscribeInsertionMode,
    getActiveInsertionMode,
    getActiveInsertionMode,
  );
}

/**
 * 将 Markdown 文本插入当前活动编辑上下文的光标处（单次 undo）。
 * @returns 是否插入成功（没有活动编辑器或内容为空白时 false，不动任何文档）
 */
export function insertAtActiveCursor(markdown: string): boolean {
  if (!markdown.trim()) return false;
  const source = getActiveSourceEditor();
  if (source) return insertIntoSourceCursor(source.view, markdown);
  const kernel = getActiveEditor();
  if (kernel) return insertIntoBlockCursor(kernel, markdown);
  return false;
}

/** CodeMirror：替换当前选区（空选区即光标处插入），单个 dispatch → 一次 undo。 */
function insertIntoSourceCursor(view: EditorView, markdown: string): boolean {
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: markdown },
    selection: { anchor: sel.from + markdown.length },
    scrollIntoView: true,
  });
  return true;
}

/** TipTap：光标所在顶层块之后插入解析出的块，单个 dispatch → 一次 undo。 */
function insertIntoBlockCursor(kernel: EditorKernelInstance, markdown: string): boolean {
  return kernel.insertMarkdownBlocks(markdown, kernel.editor.state.selection.from, 'after');
}
