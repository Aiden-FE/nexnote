// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createEditor, insertAtSafeBlockBoundary } from '../src';
import { getEditorForView } from '../src/extensions/quick-insert';

it('debug table action exec', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, { initialMarkdown: '占位\n\n', dragHandle: false });
  const view = kernel.editor.view;
  const { table, tableRow, tableHeader, tableCell, paragraph } = view.state.schema.nodes;
  const row = (cell: typeof tableHeader) =>
    tableRow.create(null, [cell.create(null, paragraph.create()), cell.create(null, paragraph.create())]);
  insertAtSafeBlockBoundary(view, table.create(null, [row(tableHeader), row(tableCell)]));

  let lastCellPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') lastCellPos = pos;
    return true;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, lastCellPos + 2)));

  // 直接调用 handler 逻辑
  const editor = getEditorForView(view);
  console.info('EDITOR REGISTERED:', !!editor);
  // try direct command
  const ok = editor?.commands.addRowAfter();
  console.info('ADDROW RESULT:', ok);
  let rowCount = 0;
  view.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') rowCount += 1;
    return true;
  });
  console.info('ROWS:', rowCount);
});
