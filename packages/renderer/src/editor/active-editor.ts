import type { EditorKernelInstance } from '@nexnote/kernel';

/**
 * 活动编辑器注册表（DEV-010）。
 *
 * 写作辅助浮层、AI 上下文桥需要定位当前聚焦的编辑器内核。
 * EditorView 挂载/聚焦时注册、卸载时注销；多窗格场景下最近聚焦者优先。
 * 跨模式的光标插入原语（DEV-036）见 caret-insert.ts；本注册表只覆盖块编辑内核，
 * 订阅接口供其组合出「当前编辑上下文」。
 */

let active: EditorKernelInstance | null = null;
const editors = new Set<EditorKernelInstance>();
const tabIds = new WeakMap<EditorKernelInstance, string>();
const listeners = new Set<() => void>();

export function subscribeActiveEditor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyActiveEditorChanged(): void {
  for (const listener of listeners) listener();
}

export function registerEditor(
  kernel: EditorKernelInstance,
  tabId?: string,
): {
  unregister: () => void;
  focus: () => void;
} {
  editors.add(kernel);
  if (tabId) tabIds.set(kernel, tabId);
  active = kernel;
  notifyActiveEditorChanged();
  const onFocus = () => {
    if (active === kernel) return;
    active = kernel;
    notifyActiveEditorChanged();
  };
  kernel.editor.view.dom.addEventListener('focus', onFocus);
  return {
    focus: onFocus,
    unregister() {
      kernel.editor.view.dom.removeEventListener('focus', onFocus);
      editors.delete(kernel);
      tabIds.delete(kernel);
      if (active === kernel) {
        active = editors.size > 0 ? (editors.values().next().value as EditorKernelInstance) : null;
      }
      notifyActiveEditorChanged();
    },
  };
}

export function getActiveEditor(): EditorKernelInstance | null {
  return active;
}

export function getEditorForTab(tabId: string): EditorKernelInstance | null {
  for (const editor of editors) if (tabIds.get(editor) === tabId) return editor;
  return null;
}
