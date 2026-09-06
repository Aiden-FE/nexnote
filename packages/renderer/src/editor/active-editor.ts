import type { EditorKernelInstance } from '@nexnote/kernel';

/**
 * 活动编辑器注册表（DEV-010）。
 *
 * 写作辅助浮层、AI 对话「插入为块」需要定位当前聚焦的编辑器内核。
 * EditorView 挂载/聚焦时注册、卸载时注销；多窗格场景下最近聚焦者优先。
 */

let active: EditorKernelInstance | null = null;
const editors = new Set<EditorKernelInstance>();

export function registerEditor(kernel: EditorKernelInstance): {
  unregister: () => void;
  focus: () => void;
} {
  editors.add(kernel);
  active = kernel;
  const onFocus = () => {
    active = kernel;
  };
  kernel.editor.view.dom.addEventListener('focus', onFocus);
  return {
    focus: onFocus,
    unregister() {
      kernel.editor.view.dom.removeEventListener('focus', onFocus);
      editors.delete(kernel);
      if (active === kernel) {
        active = editors.size > 0 ? (editors.values().next().value as EditorKernelInstance) : null;
      }
    },
  };
}

export function getActiveEditor(): EditorKernelInstance | null {
  return active;
}

/**
 * 将 Markdown 文本作为新块插入活动编辑器（可撤销）。
 * @param where cursor=光标处插入；end=文档末尾
 */
export function insertIntoActiveEditor(
  markdown: string,
  where: 'cursor' | 'end' = 'end',
): boolean {
  const kernel = active;
  if (!kernel || !markdown.trim()) return false;
  const pos =
    where === 'end'
      ? kernel.editor.state.doc.content.size
      : kernel.editor.state.selection.from;
  return kernel.insertMarkdownBlocks(markdown, pos, 'after');
}
