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
  // onNodeChange 提供 hovered 节点与 editor 的引用；点击时经 posAtCoords 反查块位置。
  let hoveredEditor: Editor | null = null;
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
          const editor = hoveredEditor;
          if (!editor) return;
          const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!at) return;
          onClick(e, at.pos, topLevelBlockIdAt(editor, at.pos), editor);
        });
      }
      return handle;
    },
    onNodeChange({ editor }) {
      hoveredEditor = editor;
    },
    computePositionConfig: {
      placement: 'left-start',
      strategy: 'absolute',
    },
  });
}
