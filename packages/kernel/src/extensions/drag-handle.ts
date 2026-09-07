import type { Editor } from '@tiptap/core';
import { DragHandle } from '@tiptap/extension-drag-handle';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * 块拖拽手柄：块左侧 ⠿ 手柄。
 * - 按住拖动 = 经 ProseMirror 原生 drop 重排块顺序
 * - 单击 = 打开块菜单（DEV-017；点击回调由内核块菜单注入）
 * 手柄 DOM 样式由渲染层 CSS 提供（nexnote-drag-handle），内核保证结构与行为。
 */

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

type DragHandleClick = (
  e: MouseEvent,
  pos: number,
  blockId: string | null,
  editor: Editor,
) => void;

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
    },
  });
}
