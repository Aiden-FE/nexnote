// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createEditor } from '../src/editor';
import {
  buildKernelExtensions,
  createMarkdownManager,
  parseMarkdown,
  serializeMarkdown,
} from '../src';
import { TableMap, CellSelection } from '@tiptap/pm/tables';
import { DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';

/**
 * DEV-087：表格单元格加号装饰 + 命令链路集成测试。
 *
 * happy-dom 下 ProseMirror Decoration.widget 行为差异较大，因此不渲染装饰 DOM，
 * 改为验证核心链路：
 *  1. TableCellPlusButtons 集成后表格 round-trip 不变。
 *  2. 光标在 cell 内时 addRowAfter / addColumnAfter 行为正确（命令链路通）。
 *  3. 自定义事件转发后行/列数 +1（renderer 侧的事件 listener 同样行为）。
 */

const TABLE_MD = '| A1 | B1 | C1 |\n| --- | --- | --- |\n| A2 | B2 | C2 |\n| A3 | B3 | C3 |\n';

function buildKernel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host, {
    initialMarkdown: TABLE_MD,
    saveDelayMs: 0,
  });
  return { kernel: editor, host };
}

function findCellPos(doc: Node, row: number, col: number): number | null {
  let table: Node | null = null;
  let tableStart = 0;
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      table = node;
      tableStart = pos;
      return false;
    }
    return true;
  });
  if (!table) return null;
  const map = TableMap.get(table);
  if (map.width <= col || map.height <= row) return null;
  const cellStart = map.positionAt(row, col, table);
  // cellStart is offset within the table node; enter the table, cell, and paragraph content.
  return tableStart + 1 + cellStart + 2;
}

function moveCursorToCell(kernel: ReturnType<typeof createEditor>, row: number, col: number): void {
  const tip = kernel.editor;
  const pos = findCellPos(tip.view.state.doc, row, col);
  if (pos === null) return;
  tip.commands.setTextSelection(pos);
  tip.commands.focus();
}

function countTableRows(json: unknown): number {
  const table = findFirstTable(json);
  if (!table || !Array.isArray(table.content)) return 0;
  return table.content.length;
}

function countTableCols(json: unknown): number {
  const table = findFirstTable(json);
  if (!table || !Array.isArray(table.content) || table.content.length === 0) return 0;
  const firstRow = table.content[0];
  if (!firstRow || !Array.isArray(firstRow.content)) return 0;
  return firstRow.content.length;
}

function findFirstTable(node: unknown): { content?: unknown[] } | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as { type?: string; content?: unknown[] };
  if (n.type === 'table' && Array.isArray(n.content)) return n as { content?: unknown[] };
  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      const found = findFirstTable(child);
      if (found) return found;
    }
  }
  return null;
}

describe('DEV-087 表格单元格加号', () => {
  it('TableCellPlusButtons 集成后表格 round-trip 不变', () => {
    const md = '| A1 | B1 |\n| A2 | B2 |\n';
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    const doc = parseMarkdown(manager, md);
    const out = serializeMarkdown(manager, doc);
    const doc2 = parseMarkdown(manager, out);
    expect(serializeMarkdown(manager, doc2)).toBe(out);
  });

  it('多个相邻 cell 选区下只显示一组行列加号', () => {
    const { kernel } = buildKernel();
    const state = kernel.editor.view.state;
    const anchor = findCellPos(state.doc, 0, 0);
    const head = findCellPos(state.doc, 1, 1);
    expect(anchor).not.toBeNull();
    expect(head).not.toBeNull();
    kernel.editor.view.dispatch(
      state.tr.setSelection(CellSelection.create(state.doc, anchor! - 2, head! - 2)),
    );

    const selectedState = kernel.editor.view.state;
    const decorations = selectedState.plugins
      .map((plugin) => plugin.getState(selectedState))
      .filter((value): value is DecorationSet => value instanceof DecorationSet)
      .flatMap((set) => set.find())
      .filter((decoration) =>
        ['table-row-plus', 'table-col-plus'].includes(String(decoration.spec.key)),
      );
    expect(decorations.map((decoration) => decoration.spec.key).sort()).toEqual([
      'table-col-plus',
      'table-row-plus',
    ]);
    kernel.editor.destroy();
  });

  it('选中第 2 行后 addRowAfter 行数 +1', () => {
    const { kernel } = buildKernel();
    const initialRowCount = countTableRows(kernel.editor.getJSON());
    expect(initialRowCount).toBeGreaterThanOrEqual(2);
    moveCursorToCell(kernel, 1, 0);
    const ok = kernel.editor.chain().focus().addRowAfter().run();
    expect(ok).toBe(true);
    expect(countTableRows(kernel.editor.getJSON())).toBe(initialRowCount + 1);
    kernel.editor.destroy();
  });

  it('选中第 2 列后 addColumnAfter 列数 +1', () => {
    const { kernel } = buildKernel();
    const initialColCount = countTableCols(kernel.editor.getJSON());
    expect(initialColCount).toBeGreaterThanOrEqual(2);
    moveCursorToCell(kernel, 1, 1);
    const ok = kernel.editor.chain().focus().addColumnAfter().run();
    expect(ok).toBe(true);
    expect(countTableCols(kernel.editor.getJSON())).toBe(initialColCount + 1);
    kernel.editor.destroy();
  });

  it('自定义事件转发：row-after 触发 addRowAfter', () => {
    const { kernel, host } = buildKernel();
    moveCursorToCell(kernel, 1, 0);
    const before = countTableRows(kernel.editor.getJSON());
    const handler = vi.fn((event: Event) => {
      event.preventDefault();
      kernel.editor.chain().focus().addRowAfter().run();
    });
    host.addEventListener('nexnote:table-cell-plus:row-after', handler);
    host.dispatchEvent(new CustomEvent('nexnote:table-cell-plus:row-after'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(countTableRows(kernel.editor.getJSON())).toBe(before + 1);
    host.removeEventListener('nexnote:table-cell-plus:row-after', handler);
    kernel.editor.destroy();
  });

  it('自定义事件转发：col-after 触发 addColumnAfter', () => {
    const { kernel, host } = buildKernel();
    moveCursorToCell(kernel, 1, 0);
    const before = countTableCols(kernel.editor.getJSON());
    const handler = vi.fn((event: Event) => {
      event.preventDefault();
      kernel.editor.chain().focus().addColumnAfter().run();
    });
    host.addEventListener('nexnote:table-cell-plus:col-after', handler);
    host.dispatchEvent(new CustomEvent('nexnote:table-cell-plus:col-after'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(countTableCols(kernel.editor.getJSON())).toBe(before + 1);
    host.removeEventListener('nexnote:table-cell-plus:col-after', handler);
    kernel.editor.destroy();
  });
});
