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
 * 2026-09-27 修复后补齐：原用例只用 CellSelection 构造选区，绕开了真实光标路径，
 * 导致"普通光标下按钮从不出现"的缺陷未被发现。现覆盖真实 TextSelection 路径、
 * 列头（tableHeader）路径、移出表格路径，并断言**按钮 DOM 真实渲染在单元格内**。
 */

const TABLE_MD = '| A1 | B1 | C1 |\n| --- | --- | --- |\n| A2 | B2 | C2 |\n| A3 | B3 | C3 |\n';

function buildKernel(initialMarkdown: string = TABLE_MD) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host, {
    initialMarkdown,
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

function collectPlusDecorationKeys(state: { plugins: unknown[] }): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 测试内直接取 PM 插件状态
  const s = state as any;
  return s.plugins
    .map((plugin: { getState: (s: unknown) => unknown }) => plugin.getState(s))
    .filter((value: unknown): value is DecorationSet => value instanceof DecorationSet)
    .flatMap((set: DecorationSet) => set.find())
    .map((decoration) => String(decoration.spec.key))
    .filter((key) => ['table-row-plus', 'table-col-plus'].includes(key));
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

  it('普通光标停在正文 cell 内时只出现行加号', () => {
    const { kernel } = buildKernel();
    moveCursorToCell(kernel, 1, 1);
    const state = kernel.editor.view.state;
    // 光标确实是普通 TextSelection，且落在 tableCell 里（非 CellSelection）
    expect(state.selection.constructor.name).toBe('TextSelection');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 测试内直接取 PM 选区
    const $from = (state.selection as any).$from;
    expect($from.node($from.depth - 1).type.name).toBe('tableCell');
    // 正文行是行操作上下文：只有行加号，不出现列加号
    expect(collectPlusDecorationKeys(state)).toEqual(['table-row-plus']);
    kernel.editor.destroy();
  });

  it('光标停在列头（tableHeader）时只出现列加号（不出行加号）', () => {
    const { kernel } = buildKernel();
    moveCursorToCell(kernel, 0, 1);
    const state = kernel.editor.view.state;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 测试内直接取 PM 选区
    const $from = (state.selection as any).$from;
    expect($from.node($from.depth - 1).type.name).toBe('tableHeader');
    // 表头是列操作上下文：只有列加号
    expect(collectPlusDecorationKeys(state)).toEqual(['table-col-plus']);
    kernel.editor.destroy();
  });

  it('行/列上下文随光标在表头与正文之间切换而互斥', () => {
    const { kernel } = buildKernel();
    moveCursorToCell(kernel, 0, 1);
    expect(collectPlusDecorationKeys(kernel.editor.view.state)).toEqual(['table-col-plus']);
    // 移到正文行：列加号收起，换行加号
    moveCursorToCell(kernel, 2, 1);
    expect(collectPlusDecorationKeys(kernel.editor.view.state)).toEqual(['table-row-plus']);
    // 回到表头：换回列加号
    moveCursorToCell(kernel, 0, 1);
    expect(collectPlusDecorationKeys(kernel.editor.view.state)).toEqual(['table-col-plus']);
    kernel.editor.destroy();
  });

  it('光标进入 cell 后再次 dispatch 一次选择更新仍保留加号', () => {
    const { kernel } = buildKernel();
    moveCursorToCell(kernel, 1, 1);
    const before = kernel.editor.view.state;
    kernel.editor.view.dispatch(before.tr.setSelection(before.selection));
    const after = kernel.editor.view.state;
    expect(collectPlusDecorationKeys(after)).toEqual(['table-row-plus']);
    kernel.editor.destroy();
  });

  it('光标移出表格后加号消失', () => {
    const { kernel } = buildKernel(`${TABLE_MD}\n表格之后的段落\n`);
    moveCursorToCell(kernel, 1, 1);
    expect(collectPlusDecorationKeys(kernel.editor.view.state)).toHaveLength(1);
    const doc = kernel.editor.state.doc;
    expect(doc.lastChild?.type.name).toBe('paragraph');
    kernel.editor.commands.setTextSelection(doc.content.size - 1);
    expect(collectPlusDecorationKeys(kernel.editor.view.state)).toEqual([]);
    kernel.editor.destroy();
  });

  it('列头 DOM：只有列加号，且挂在 th 内', () => {
    const { kernel } = buildKernel();
    moveCursorToCell(kernel, 0, 1);
    const dom = kernel.editor.view.dom;
    const rowBtn = dom.querySelector<HTMLElement>('[data-testid="table-row-plus"]');
    const colBtn = dom.querySelector<HTMLElement>('[data-testid="table-col-plus"]');
    // 聚焦列头时不出行加号
    expect(rowBtn).toBeNull();
    expect(colBtn).not.toBeNull();
    expect(colBtn!.closest('th')).not.toBeNull();
    expect(colBtn!.className).toContain('nexnote-table-cell-plus--col');
    kernel.editor.destroy();
  });

  it('正文行 DOM：只有行加号，且挂在 td 内', () => {
    const { kernel } = buildKernel();
    moveCursorToCell(kernel, 1, 1);
    const dom = kernel.editor.view.dom;
    const rowBtn = dom.querySelector<HTMLElement>('[data-testid="table-row-plus"]');
    const colBtn = dom.querySelector<HTMLElement>('[data-testid="table-col-plus"]');
    expect(rowBtn).not.toBeNull();
    expect(colBtn).toBeNull();
    // 行加号挂在行内单元格（CSS 再把它横向推到表格外侧）
    expect(rowBtn!.closest('td')).not.toBeNull();
    expect(rowBtn!.className).toContain('nexnote-table-cell-plus--row');
    kernel.editor.destroy();
  });

  it('行加号锚在行的第 0 列，而非光标所在列（光标在第 3 列时）', () => {
    const { kernel } = buildKernel();
    // 光标放在第 1 行第 2 列（0 起）；行加号仍应锚在该行第 0 列上
    moveCursorToCell(kernel, 1, 2);
    const dom = kernel.editor.view.dom;
    const rowBtn = dom.querySelector<HTMLElement>('[data-testid="table-row-plus"]');
    expect(rowBtn).not.toBeNull();
    const cell = rowBtn!.closest('td, th') as HTMLTableCellElement | null;
    expect(cell).not.toBeNull();
    // 落在整行的左边：是该行第一个单元格
    expect(cell!.cellIndex).toBe(0);
    // 且确实在光标所在行
    const row = cell!.closest('tr');
    expect(row).not.toBeNull();
    expect(row!.rowIndex).toBe(1);
    kernel.editor.destroy();
  });

  it('加号带 hover 提示文案（data-tooltip，供 CSS ::after 读取）', () => {
    const { kernel } = buildKernel();
    moveCursorToCell(kernel, 1, 1);
    const dom = kernel.editor.view.dom;
    const rowBtn = dom.querySelector<HTMLElement>('[data-testid="table-row-plus"]');
    expect(rowBtn!.dataset.tooltip).toBe('在下方插入行');
    expect(rowBtn!.getAttribute('aria-label')).toBe('在下方插入行');

    moveCursorToCell(kernel, 0, 1);
    const colBtn = kernel.editor.view.dom.querySelector<HTMLElement>(
      '[data-testid="table-col-plus"]',
    );
    expect(colBtn!.dataset.tooltip).toBe('在右侧插入列');
    expect(colBtn!.getAttribute('aria-label')).toBe('在右侧插入列');
    kernel.editor.destroy();
  });

  it('多 cell 选区（跨表头）只出现一组列加号', () => {
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
    // 选区含表头行 → 列操作上下文，只出一组列加号（不是每个 cell 一组）
    expect(decorations.map((decoration) => decoration.spec.key)).toEqual(['table-col-plus']);
    kernel.editor.destroy();
  });

  it('多 cell 选区（纯正文行）只出现一组行加号', () => {
    const { kernel } = buildKernel();
    const state = kernel.editor.view.state;
    const anchor = findCellPos(state.doc, 1, 0);
    const head = findCellPos(state.doc, 2, 1);
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
    expect(decorations.map((decoration) => decoration.spec.key)).toEqual(['table-row-plus']);
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
