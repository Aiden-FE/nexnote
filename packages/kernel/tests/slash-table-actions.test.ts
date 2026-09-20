// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createEditor, insertAtSafeBlockBoundary } from '../src';
import type { EditorKernelInstance } from '../src/editor';

function make(markdown = '占位\n\n') {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, {
    initialMarkdown: markdown,
    dragHandle: false,
  });
  return { container, kernel };
}

function placeCursorEnd(kernel: EditorKernelInstance) {
  const view = kernel.editor.view;
  const end = view.state.doc.content.size;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end))));
}

/** 在文档尾部插入一个 2x2 表格并把光标放进第一个 cell 的段落。 */
function insertTableAndEnter(kernel: EditorKernelInstance) {
  const view = kernel.editor.view;
  const { table, tableRow, tableHeader, tableCell, paragraph } = view.state.schema.nodes;
  const row = (cell: typeof tableHeader) =>
    tableRow.create(null, [cell.create(null, paragraph.create()), cell.create(null, paragraph.create())]);
  insertAtSafeBlockBoundary(
    view,
    table.create(null, [row(tableHeader), row(tableCell)]),
  );
  // 光标移入最后一个 tableCell 内的空段落：先定位最后一个 cell，再取其段落子节点
  let lastCellPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') lastCellPos = pos;
    return true;
  });
  expect(lastCellPos).toBeGreaterThan(0);
  const lastCell = view.state.doc.nodeAt(lastCellPos);
  expect(lastCell?.type.name).toBe('tableCell');
  const cellPara = lastCell?.childCount === 1 ? lastCell.child(0) : null;
  expect(cellPara?.type.name).toBe('paragraph');
  // cursor 进入 cell 内的 paragraph（cell 边界 + 1 是 paragraph 起始）
  const cursorPos = lastCellPos + 2;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cursorPos)));
}

/** 触发 slash 菜单并读取当前条目 id 集合。 */
function openSlashItems(kernel: EditorKernelInstance, container: HTMLElement): string[] {
  const view = kernel.editor.view as never;
  const from = (view as unknown as { state: { selection: { from: number } } }).state.selection.from;
  view.someProp(
    'handleTextInput',
    (f: (v: never, a: number, b: number, t: string) => boolean) => {
      f(view, from, from, '/');
      return false;
    },
  );
  // commit '/' into doc so sessionIsCurrent (selection.from === triggerTo) holds at apply time
  view.dispatch(view.state.tr.insertText('/', from, from));
  const menu = container.querySelector('.nexnote-slash-menu') as HTMLElement | null;
  if (!menu) return [];
  return [...menu.querySelectorAll('[data-slash-item]')].map((r) =>
    r.getAttribute('data-slash-item'),
  );
}

const TABLE_ACTIONS = [
  'table:row-below',
  'table:column-right',
  'table:row-delete',
  'table:column-delete',
];

describe('DEV-070 · slash 菜单表格上下文条目', () => {
  it('光标在表格 cell 内：4 个表格动作可见', () => {
    const { kernel, container } = make();
    insertTableAndEnter(kernel);
    expect(kernel.editor.isActive('table')).toBe(true);
    const ids = openSlashItems(kernel, container);
    for (const id of TABLE_ACTIONS) expect(ids).toContain(id);
    kernel.destroy();
    container.remove();
  });

  it('光标在普通段落：4 个表格动作不可见', () => {
    const { kernel, container } = make();
    placeCursorEnd(kernel);
    expect(kernel.editor.isActive('table')).toBe(false);
    const ids = openSlashItems(kernel, container);
    for (const id of TABLE_ACTIONS) expect(ids).not.toContain(id);
    // 基础条目仍然齐备
    expect(ids).toContain('insert:table');
    kernel.destroy();
    container.remove();
  });

  it('表格内选择 row 动作：行数 +1 且 trigger 被消费', () => {
    const { kernel, container } = make();
    insertTableAndEnter(kernel);
    const before = JSON.stringify(kernel.getJSON());
    const ids = openSlashItems(kernel, container);
    expect(ids).toContain('table:row-below');
    // 直接执行动作：找到菜单条目并 click
    const row = container.querySelector('[data-slash-item="table:row-below"]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const after = JSON.stringify(kernel.getJSON());
    expect(after).not.toBe(before);
    // trigger 已被消费：文档中不残留 '/' 字符
    expect(kernel.editor.state.doc.textBetween(0, kernel.editor.state.doc.content.size, undefined, '\ufffc')).not.toContain('/');
    // 行数 +1：表格现在 3 行
    let rowCount = 0;
    kernel.editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableRow') rowCount += 1;
      return true;
    });
    expect(rowCount).toBe(3);
    kernel.destroy();
    container.remove();
  });

  it('表格内选择 deleteRow 动作：行数 -1', () => {
    const { kernel, container } = make();
    insertTableAndEnter(kernel);
    openSlashItems(kernel, container);
    const row = container.querySelector('[data-slash-item="table:row-delete"]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    let rowCount = 0;
    kernel.editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableRow') rowCount += 1;
      return true;
    });
    expect(rowCount).toBe(1);
    kernel.destroy();
    container.remove();
  });
});
