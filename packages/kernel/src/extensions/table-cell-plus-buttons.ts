import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node, ResolvedPos, Schema } from '@tiptap/pm/model';
import { TableMap, selectedRect, type TableRect } from '@tiptap/pm/tables';

/**
 * DEV-087：块编辑器表格的"行末加号"和"列首加号"。
 *
 * - 选择区域下方出现加号；点击触发 `nexnote:table-cell-plus:row-after` 自定义事件，
 *   renderer 监听后派发 editor.commands.addRowAfter()。
 * - 选择区域右侧出现加号；点击触发 `nexnote:table-cell-plus:col-after`，renderer 派发 addColumnAfter。
 *
 * 多 cell 选区在所选区域的底行与最右列显示单组按钮。
 *
 * 装饰只挂 DOM（按钮），不修改文档。
 */

const TABLE_CELL_PLUS_PLUGIN_KEY = new PluginKey<DecorationSet>('nexnoteTableCellPlus');

interface FocusedRect {
  row: number;
  col: number;
  tableRect: TableRect;
  tableStart: number;
}

/**
 * 直接从 ProseMirror 文档节点 + selection 计算焦点所在 cell 的行列。
 * - 不依赖 EditorState 类型，便于 plugin apply 中用 `tr.doc + tr.selection` 调用。
 * - `selection` 来自 tr.selection，应用时 selection 已是被替换的最新 selection。
 */
function getFocusedRectFromDoc(
  doc: Node,
  selection: { from: number; to: number; $from: ResolvedPos },
  schema: Schema,
): FocusedRect | null {
  const { $from } = selection;
  if ($from.parent.type !== schema.nodes.tableCell) return null;
  // 构造最小 EditorState 仅用于 selectedRect 与 TableMap.get。
  const minimal: Pick<EditorState, 'schema' | 'doc' | 'selection'> = {
    schema,
    doc,
    selection: selection as unknown as EditorState['selection'],
  };
  const rect = selectedRect(minimal as unknown as EditorState);
  let tableStart = -1;
  for (let d = $from.depth; d >= 0; d -= 1) {
    const node = $from.node(d);
    if (node.type === schema.nodes.table) {
      tableStart = $from.before(d);
      break;
    }
  }
  if (tableStart < 0) return null;
  return {
    row: rect.bottom - 1,
    col: rect.right - 1,
    tableRect: rect,
    tableStart,
  };
}

/** 行末位置：该行最右侧 cell 节点结束位置之后。 */
function rowAfterPos(info: FocusedRect): number | null {
  const map = TableMap.get(info.tableRect.table);
  for (let col = info.tableRect.right - 1; col >= info.tableRect.left; col -= 1) {
    const cellStart = map.positionAt(info.row, col, info.tableRect.table);
    if (cellStart == null) continue;
    const cell = info.tableRect.table.nodeAt(cellStart);
    if (!cell) continue;
    return info.tableStart + 1 + cellStart + cell.nodeSize;
  }
  return null;
}

/** 列首位置：该列最上方 cell 内容起点（cell 开始位置 + 1）。 */
function colBeforePos(info: FocusedRect): number | null {
  const map = TableMap.get(info.tableRect.table);
  const cellStart = map.positionAt(info.tableRect.top, info.col, info.tableRect.table);
  if (cellStart == null) return null;
  return info.tableStart + 1 + cellStart + 1;
}

function makeButton(
  testid: string,
  label: string,
  eventName: string,
  detail: object,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className =
    'nexnote-table-cell-plus pointer-events-auto absolute z-10 flex h-5 w-5 -translate-x-1 -translate-y-1 items-center justify-center rounded border bg-background text-xs text-muted-foreground shadow hover:bg-accent';
  btn.dataset.testid = testid;
  btn.setAttribute('aria-label', label);
  btn.contentEditable = 'false';
  btn.textContent = '+';
  btn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    btn.dispatchEvent(new CustomEvent(eventName, { bubbles: true, detail }));
  });
  return btn;
}

function buildDecorations(state: EditorState): DecorationSet {
  const info = getFocusedRectFromDoc(state.doc, state.selection, state.schema);
  if (!info) return DecorationSet.empty;
  const decos: Decoration[] = [];

  const rowAfter = rowAfterPos(info);
  if (rowAfter !== null) {
    decos.push(
      Decoration.widget(
        rowAfter,
        makeButton('table-row-plus', '在下方插入行', 'nexnote:table-cell-plus:row-after', {
          row: info.row,
        }),
        { side: -1, key: 'table-row-plus' },
      ),
    );
  }

  const colBefore = colBeforePos(info);
  if (colBefore !== null) {
    decos.push(
      Decoration.widget(
        colBefore,
        makeButton('table-col-plus', '在右侧插入列', 'nexnote:table-cell-plus:col-after', {
          col: info.col,
        }),
        { side: -1, key: 'table-col-plus' },
      ),
    );
  }

  return DecorationSet.create(state.doc, decos);
}

export const TableCellPlusButtons = Extension.create({
  name: 'tableCellPlusButtons',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: TABLE_CELL_PLUS_PLUGIN_KEY,
        state: {
          init: (_, state) => buildDecorations(state),
          apply(tr, old) {
            if (!tr.docChanged && !tr.selectionSet) return old;
            // 通过构造最小 EditorState 复用同一 buildDecorations 路径。
            const synthetic = EditorState.create({
              schema: tr.doc.type.schema,
              doc: tr.doc,
              selection: tr.selection,
            });
            return buildDecorations(synthetic);
          },
        },
        props: {
          decorations(state) {
            return TABLE_CELL_PLUS_PLUGIN_KEY.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
