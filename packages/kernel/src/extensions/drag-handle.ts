import type { Editor } from '@tiptap/core';
import { DragHandle } from '@tiptap/extension-drag-handle';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { offset, shift } from '@floating-ui/dom';
import type { Middleware } from '@floating-ui/dom';

/**
 * 块拖拽手柄：块左侧 ⠿ 手柄。
 * - 按住拖动 = 经 ProseMirror 原生 drop 重排块顺序
 * - 单击 = 打开块菜单（DEV-017；点击回调由内核块菜单注入）
 *
 * DEV-061：手柄与标题折叠 chevron 共享编辑器宿主级 gutter（默认宽度 3.75rem）；
 * TipTap DragHandle 插件默认以 placement='left-start' 把 wrapper 锚到块左缘外侧，
 * 但 wrapper 会与正文共用宿主元素并留下不可命中的空白；这里用 Floating UI 的
 * `offset` middleware 把 wrapper 平移到 gutter 内部，移除旧的 `translateX(-1.9rem)`
 * hack；同时叠加 `shift` 让 wrapper 在窄编辑区里贴边而非被裁剪。
 *
 * 手柄 DOM 样式由渲染层 CSS 提供（nexnote-drag-handle）；内核保证结构与行为。
 *
 * 命中桥接（hover bridge）：手柄 wrapper 内的 `.nexnote-drag-handle__bridge` 元素
 * 是浮层之外的「热区延伸」——当正文 `mouseleave` 命中这个 sibling 时 ProseMirror
 * 仍把它视作 wrapper 内部元素，从而不会触发 DragHandle 的 `mouseleave` 隐藏。
 */

/** 默认编辑器 gutter 宽度（rem）。两侧列：左侧 1.6rem 手柄 + 右侧 1.6rem chevron。 */
export const EDITOR_GUTTER_WIDTH_REM = 3.75;
/** 手柄列宽（rem）。CSS 同步消费。 */
export const EDITOR_GUTTER_HANDLE_COLUMN_REM = 1.6;
/** chevron 列宽（rem）。CSS 同步消费。 */
export const EDITOR_GUTTER_CHEVRON_COLUMN_REM = 1.6;

/** 找出 pos 所在顶层节点的 blockId（^id）；查找失败返回 null。 */
export function topLevelBlockIdAt(editor: Editor, pos: number): string | null {
  const { doc } = editor.state;
  const safe = Math.min(Math.max(pos, 0), doc.content.size);
  const $pos = doc.resolve(safe);
  if ($pos.depth < 1) return null;
  const node: ProseMirrorNode = $pos.node(1);
  const id = (node.attrs as { blockId?: string }).blockId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

type DragHandleClick = (e: MouseEvent, pos: number, blockId: string | null, editor: Editor) => void;

/**
 * 构建 Floating UI middleware 链。
 * - `offset`：把 wrapper 横向拉到 chevron 列左侧（编辑器宿主 gutter 第一列）。
 *   placement='left-start' 默认让 wrapper.right = anchor.left（60px gutter 起点），
 *   减去自身 1.6rem 宽 = 34.4px。Floating UI 对 `mainAxis` 与 `originSides`
 *   （`{left, top}`）取负号：mainAxis>0 = 远离 reference = 向左；我们要把
 *   wrapper 左缘对齐宿主左缘，所以 mainAxis = gutter - wrapperWidth（正值）。
 *   这样 wrapper 整体进入 gutter 第一列，不再依赖任何 `translateX` hack。
 * - `shift`（padding）：贴边自动收紧，避免窄分栏把 wrapper 推出宿主。
 */
export function buildDragHandleMiddleware(): Middleware[] {
  const mainAxis = (EDITOR_GUTTER_WIDTH_REM - EDITOR_GUTTER_HANDLE_COLUMN_REM) * 16;
  return [offset({ mainAxis }), shift({ padding: 4 })];
}

export function createKernelDragHandle(onClick?: DragHandleClick): typeof DragHandle {
  // onNodeChange 是手柄真实命中块的单一事实来源；手柄本身位于正文外侧，
  // 点击坐标不能再用 posAtCoords 反查（会命中相邻块或返回 null）。
  let hovered: { editor: Editor; pos: number; blockId: string | null } | null = null;
  return DragHandle.configure({
    render() {
      const handle = document.createElement('div');
      handle.className = 'nexnote-drag-handle';
      handle.dataset.dragHandle = '';
      handle.setAttribute('aria-label', '块操作：拖拽重排，单击打开块菜单');
      handle.title = '拖拽重排 · 单击打开块菜单';
      const icon = document.createElement('span');
      icon.className = 'nexnote-drag-handle__icon';
      icon.textContent = '⠿';
      handle.append(icon);

      // 命中桥接：位于手柄右上、紧贴手柄列；正文 → 手柄的 mouseleave 经它穿行
      // 时会被 TipTap wrapper 视作仍在内部，拖拽手柄因此不会在临界处消失。
      const bridge = document.createElement('div');
      bridge.className = 'nexnote-drag-handle__bridge';
      bridge.setAttribute('aria-hidden', 'true');
      bridge.dataset.dragHandleBridge = '';
      handle.append(bridge);

      if (onClick) {
        handle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const current = hovered;
          if (!current) return;
          onClick(e, current.pos, current.blockId, current.editor);
        });
      }
      return handle;
    },
    onNodeChange(payload) {
      // 扩展层类型声明漏了 pos（运行时插件确实传入 { editor, node, pos }），显式收窄。
      const { editor, node } = payload;
      const pos = (payload as { pos?: number }).pos;
      hovered =
        node && typeof pos === 'number' && pos >= 0
          ? { editor, pos, blockId: topLevelBlockIdAt(editor, pos) }
          : null;
    },
    computePositionConfig: {
      placement: 'left-start',
      strategy: 'absolute',
      middleware: buildDragHandleMiddleware(),
    },
  });
}
