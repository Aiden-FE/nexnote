import { Extension, type Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';

/**
 * DEV-069 / DEV-094：列表删除行为修正。
 *
 * 1. 空 `<li>` 夹在两个同级 `<li>` 之间时按 Backspace：默认 ListKeymap 走 `liftListItem`
 *    把空项提升为同级 paragraph，视觉上留下"空白换行"。这里在默认 Backspace 之前
 *    拦截：当当前空项前后都还有同级 item，直接删除整个 item，不留任何空白段。
 *    DEV-094：判定同时覆盖待办列表（`taskList > taskItem`），其空态结构与 `listItem`
 *    一致（item 下仅一个空 `paragraph`，复选框是 NodeView 语义，不入文档树）。
 * 2. 在 IndexedContent 之外的纯列表末尾 / 开头，按 Backspace 时仍交给默认 keymap
 *    把 item lift 出列表（用户视角的"退出列表"）。
 */

/** 可被整体删除的列表项节点类型（无序 / 有序 / 待办）。 */
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/** 上述列表项所属的父列表类型。 */
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

function isAtStartOfParagraph(state: EditorState, itemDepth: number): boolean {
  const { $from } = state.selection;
  const paraDepth = itemDepth + 1;
  if (paraDepth > $from.depth) return false;
  if ($from.parent.type.name !== 'paragraph') return false;
  return $from.parentOffset === 0;
}

/** 从光标向上找到最近的列表项深度（listItem / taskItem）；未命中返回 -1。 */
function findListItemDepth(state: EditorState): number {
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !LIST_ITEM_TYPES.has($from.node(depth).type.name)) depth -= 1;
  if (depth <= 0) return -1;
  if (!LIST_ITEM_TYPES.has($from.node(depth).type.name)) return -1;
  return depth;
}

/** 探测当前是否处于"夹在同级列表项之间的空项"。导出供测试与命令共用。 */
export function isSandwichedEmptyListItem(state: EditorState): boolean {
  const { selection } = state;
  if (!selection.empty) return false;

  const depth = findListItemDepth(state);
  if (depth < 0) return false;

  const { $from } = selection;
  const listItem = $from.node(depth);
  const parentList = $from.node(depth - 1);
  if (!LIST_TYPES.has(parentList.type.name)) return false;
  if (!isAtStartOfParagraph(state, depth)) return false;

  if (listItem.childCount !== 1) return false;
  const child = listItem.firstChild;
  if (!child || child.type.name !== 'paragraph') return false;
  if (child.textContent.length > 0) return false;

  const idxInList = $from.index(depth - 1);
  if (idxInList <= 0) return false;
  if (idxInList >= parentList.childCount - 1) return false;
  return true;
}

/** 直接删除空列表项（不经命令层）。供 addKeyboardShortcuts 与测试调用。 */
function removeSandwichedEmptyListItem(editor: Editor): boolean {
  const state = editor.state;
  if (!isSandwichedEmptyListItem(state)) return false;
  const depth = findListItemDepth(state);
  if (depth < 0) return false;
  const { $from } = state.selection;
  const tr = state.tr.delete($from.before(depth), $from.after(depth));
  editor.view.dispatch(tr);
  return true;
}

export const ListDev069 = Extension.create({
  name: 'nexnoteListDev069',

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const editor = (this as unknown as { editor: Editor }).editor;
        return removeSandwichedEmptyListItem(editor);
      },
    };
  },
});
