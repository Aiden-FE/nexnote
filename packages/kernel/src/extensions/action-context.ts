import type { EditorView } from '@tiptap/pm/view';

/**
 * 编辑器动作目标（框架无关）。
 *
 * 选区浮动工具栏 / 右键菜单 / 斜杠 AI 命令共用同一套目标描述：
 * - selection：作用于非折叠选区（选区/块文本由内核从 ProseMirror 状态抽取）
 * - block：作用于指针所在的整块（右键块手柄 / 折叠状态右键）
 * - cursor：空块斜杠触发，于光标处插入（基于上文生成）
 */
export type EditorActionTarget = 'selection' | 'block' | 'cursor';

export interface EditorActionContext {
  view: EditorView;
  target: EditorActionTarget;
  /** 作用范围（replace 类动作替换 [from,to]）。 */
  from: number;
  to: number;
  /** 目标文本（选区文本 / 整块文本 / 空串）。 */
  text: string;
  /** 顶层块范围（整块改写 / 追加插入锚点）；cursor 目标为当前块。 */
  blockRange: { from: number; to: number } | null;
  /** 视口坐标（React fixed 浮层 / 内核 DOM 定位共用）。 */
  coords: { top: number; left: number };
}

/** 抽取选区/光标所在顶层块的边界位置。 */
function topLevelBlockRange(
  view: EditorView,
  pos: number,
): { from: number; to: number } | null {
  const { doc } = view.state;
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  if ($pos.depth < 1) return null;
  return { from: $pos.before(1), to: $pos.after(1) };
}

function textBetween(view: EditorView, from: number, to: number): string {
  return view.state.doc.textBetween(from, to, '\n', '\ufffc');
}

/** 计算浮层锚点坐标：选区首尾的水平中点、垂直上方。 */
function coordsForRange(view: EditorView, from: number, to: number): { top: number; left: number } {
  const maxPos = view.state.doc.content.size;
  const safeFrom = Math.min(Math.max(from, 0), maxPos);
  const safeTo = Math.min(Math.max(to, 0), maxPos);
  const start = view.coordsAtPos(safeFrom);
  const end = view.coordsAtPos(Math.max(safeTo, safeFrom));
  return {
    top: Math.min(start.top, end.top),
    left: (start.left + end.right) / 2,
  };
}

/**
 * 依据当前 ProseMirror 状态构造动作上下文。
 * @param target 期望目标；selection 在折叠时退化为 cursor。
 */
export function computeEditorActionContext(
  view: EditorView,
  target: EditorActionTarget,
  pointer?: { x: number; y: number },
): EditorActionContext {
  const { selection } = view.state;
  const hasSelection = !selection.empty && selection.from !== selection.to;

  // 右键：优先用指针坐标定位块（折叠状态也能对整块操作）。
  let blockPos = selection.from;
  if (pointer) {
    const at = view.posAtCoords({ left: pointer.x, top: pointer.y });
    if (at) blockPos = at.pos;
  }

  const blockRange = topLevelBlockRange(view, blockPos);

  if (target === 'block' && blockRange) {
    return {
      view,
      target: 'block',
      from: blockRange.from,
      to: blockRange.to,
      text: textBetween(view, blockRange.from, blockRange.to).trim(),
      blockRange,
      coords: pointer
        ? { top: pointer.y, left: pointer.x }
        : coordsForRange(view, blockRange.from, blockRange.to),
    };
  }

  if (target === 'selection' && hasSelection) {
    return {
      view,
      target: 'selection',
      from: selection.from,
      to: selection.to,
      text: textBetween(view, selection.from, selection.to),
      blockRange: blockRange ?? topLevelBlockRange(view, selection.from),
      coords: coordsForRange(view, selection.from, selection.to),
    };
  }

  // 空块 / 折叠光标：插入锚点为光标处。
  const cursorBlock = topLevelBlockRange(view, selection.from);
  return {
    view,
    target: 'cursor',
    from: selection.from,
    to: selection.to,
    text: '',
    blockRange: cursorBlock,
    coords: pointer
      ? { top: pointer.y, left: pointer.x }
      : coordsForRange(view, selection.from, selection.from),
  };
}
