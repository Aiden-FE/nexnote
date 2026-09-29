import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';
import { TableMap, selectedRect } from '@tiptap/pm/tables';

/**
 * DEV-087：块编辑器表格的加号按钮（行 / 列互斥）。
 *
 * - **表头行（列头）**：只出**列加号**——该列右上角，点击触发
 *   `nexnote:table-cell-plus:col-after`，renderer 派发 addColumnAfter()。
 *   表头是列操作上下文，不出行加号。
 * - **正文行**：只出**行加号**——横向位于**表格外侧**（该行左端之外，避免遮挡
 *   单元格内容），点击触发 `nexnote:table-cell-plus:row-after`，renderer 派发
 *   addRowAfter()。正文是行操作上下文，不出列加号。
 *
 * 多 cell 选区按选区上边界判定属于哪种上下文。
 *
 * 装饰只挂 DOM（按钮），不修改文档。
 *
 * 2026-09-27 修复（真实光标下按钮从不出现）：原实现要求 `selection.$from.parent`
 * 直接就是 `tableCell`。但真实光标落在单元格的 `paragraph` 里，直接父节点永远是
 * paragraph，因此除"多单元格 CellSelection"外一律返回 null —— 用户点进单元格
 * 看不到任何加号。现改为让 prosemirror-tables 的 `selectedRect` 自己解析光标所在
 * 单元格（它内部按 `tableRole` 向上找 cell，同时支持 TextSelection 与 CellSelection，
 * 对 `tableHeader` 同样生效）。
 */

const TABLE_CELL_PLUS_PLUGIN_KEY = new PluginKey<DecorationSet>('nexnoteTableCellPlus');

interface FocusedRect {
  /** 光标所在单元格的行/列（TableMap 索引，0 起）。 */
  row: number;
  col: number;
  table: Node;
  /** 表格内容起点（`selectedRect` 语义：表格起始 token 之后）。 */
  tableStart: number;
  rect: { left: number; top: number; right: number; bottom: number };
}

/**
 * 解析光标/选区所在的单元格矩形。
 * 失败（不在表格内 / 位置异常）返回 null，绝不抛出——装饰计算在 PM 的 apply 内，
 * 抛错会中断正常编辑。
 */
function resolveFocusedRect(state: EditorState): FocusedRect | null {
  let rect;
  try {
    rect = selectedRect(state);
  } catch {
    return null;
  }
  if (!rect?.table) return null;
  if (rect.right <= rect.left || rect.bottom <= rect.top) return null;
  return {
    // 底行 / 最右列：与 DEV-087 的"在下方加行、在右侧加列"语义一致。
    row: rect.bottom - 1,
    col: rect.right - 1,
    table: rect.table,
    tableStart: rect.tableStart,
    rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
  };
}

/** 单元格内容起点（表格内向内一层）。 */
function cellContentStart(info: FocusedRect, row: number, col: number): number | null {
  const map = TableMap.get(info.table);
  const offset = map.positionAt(row, col, info.table);
  if (offset == null) return null;
  return info.tableStart + offset + 1;
}

/** 单元格内容终点。 */
function cellContentEnd(info: FocusedRect, row: number, col: number): number | null {
  const map = TableMap.get(info.table);
  const offset = map.positionAt(row, col, info.table);
  if (offset == null) return null;
  const cell = info.table.nodeAt(offset);
  if (!cell) return null;
  return info.tableStart + offset + cell.nodeSize - 1;
}

function makeButton(
  testid: string,
  label: string,
  modifier: 'row' | 'col',
  eventName: string,
  detail: object,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  // 具体视觉样式在 renderer 的 globals.css（.nexnote-table-cell-plus）：按钮 DOM 由
  // kernel 包产出，而 Tailwind 的扫描根是 renderer，utility 类名在这里不可靠。
  btn.className = `nexnote-table-cell-plus nexnote-table-cell-plus--${modifier}`;
  btn.dataset.testid = testid;
  btn.setAttribute('aria-label', label);
  // hover 提示文案：由 globals.css 的 ::after 读取（纯 CSS，无需 JS/延迟）。
  btn.dataset.tooltip = label;
  btn.setAttribute('tabindex', '-1');
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
  const info = resolveFocusedRect(state);
  if (!info) return DecorationSet.empty;

  const decos: Decoration[] = [];

  // 表头行 = 列操作上下文：只出列加号、不出行加号（用户 2026-09-27 反馈）。
  // 以选区上边界判定，结果与拖拽方向无关。
  if (info.rect.top === 0) {
    const colPos = cellContentEnd(info, info.rect.top, info.col);
    if (colPos !== null) {
      decos.push(
        Decoration.widget(
          colPos,
          makeButton('table-col-plus', '在右侧插入列', 'col', 'nexnote:table-cell-plus:col-after', {
            col: info.col,
          }),
          { side: 1, key: 'table-col-plus' },
        ),
      );
    }
    return DecorationSet.create(state.doc, decos);
  }

  // 正文行 = 行操作上下文：只出行加号。
  // 锚点必须是该行的**第 0 列**，不是选区左列——否则光标停在第 2 列时按钮会贴到
  // 该单元格左边，而不是整行的左边（用户 2026-09-27 反馈）。CSS 再把它推到表格外侧。
  const rowPos = cellContentStart(info, info.row, 0);
  if (rowPos !== null) {
    decos.push(
      Decoration.widget(
        rowPos,
        makeButton('table-row-plus', '在下方插入行', 'row', 'nexnote:table-cell-plus:row-after', {
          row: info.row,
        }),
        { side: -1, key: 'table-row-plus' },
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
            // 复用同一 buildDecorations：用 tr 的 doc/selection 构造等价 state。
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
