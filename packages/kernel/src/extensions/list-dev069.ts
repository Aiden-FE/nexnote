import { Extension, type Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';

/**
 * DEV-069：列表删除行为修正。
 *
 * 1. 空 `<li>` 夹在两个同级 `<li>` 之间时按 Backspace：默认 ListKeymap 走 `liftListItem`
 *    把空项提升为同级 paragraph，视觉上留下"空白换行"。这里在默认 Backspace 之前
 *    拦截：当当前空项前后都还有同级 listItem，直接删除整个 listItem，不留任何空白段。
 * 2. 在 IndexedContent 之外的纯列表末尾 / 开头，按 Backspace 时仍交给默认 keymap
 *    把 item lift 出列表（用户视角的"退出列表"）。
 */

function isAtStartOfParagraph(state: EditorState, itemDepth: number): boolean {
  const { $from } = state.selection;
  const paraDepth = itemDepth + 1;
  if (paraDepth > $from.depth) return false;
  if ($from.parent.type.name !== 'paragraph') return false;
  return $from.parentOffset === 0;
}

/** 探测当前是否处于"夹在同级 listItem 之间的空 `<li>`"。导出供测试与命令共用。 */
export function isSandwichedEmptyListItem(state: EditorState): boolean {
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.name !== 'listItem') depth -= 1;
  if (depth <= 0) return false;

  const listItem = $from.node(depth);
  if (listItem.type.name !== 'listItem') return false;
  const parentList = $from.node(depth - 1);
  if (parentList.type.name !== 'bulletList' && parentList.type.name !== 'orderedList') {
    return false;
  }
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

/** 直接删除空 listItem（不经命令层）。供 addKeyboardShortcuts 与测试调用。 */
function removeSandwichedEmptyListItem(editor: Editor): boolean {
  const state = editor.state;
  if (!isSandwichedEmptyListItem(state)) return false;
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.name !== 'listItem') depth -= 1;
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
