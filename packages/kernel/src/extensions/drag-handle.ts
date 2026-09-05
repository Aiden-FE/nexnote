import { DragHandle } from '@tiptap/extension-drag-handle';

/**
 * 块拖拽手柄：块左侧 ⠿ 手柄，按住拖拽经 ProseMirror 原生 drop 重排块顺序。
 * 手柄 DOM 样式由渲染层 CSS 提供（nexnote-drag-handle），内核只保证结构与行为。
 */

export function createKernelDragHandle(): typeof DragHandle {
  return DragHandle.configure({
    render() {
      const handle = document.createElement('div');
      handle.className = 'nexnote-drag-handle';
      handle.dataset.dragHandle = '';
      handle.setAttribute('aria-label', '拖拽重排此块');
      handle.title = '拖拽重排 · 拖到目标块上方/下方释放';
      const icon = document.createElement('span');
      icon.className = 'nexnote-drag-handle__icon';
      icon.textContent = '⠿';
      handle.append(icon);
      return handle;
    },
    computePositionConfig: {
      placement: 'left-start',
      strategy: 'absolute',
    },
  });
}
