import type { SourceEditorHandle } from './codemirror-host';

/**
 * 活动源码编辑器注册表（DEV-023）。
 *
 * 冒烟 e2e / 后续命令需要定位当前源码模式的 CodeMirror 实例（划词格式化写回等）。
 * SourceModeView 挂载时注册、卸载时注销；最近挂载者优先（单栈仅一个源码 tab）。
 */

let active: SourceEditorHandle | null = null;
const listeners = new Set<() => void>();

export function subscribeActiveSourceEditor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyActiveSourceEditorChanged(): void {
  for (const listener of listeners) listener();
}

export function registerSourceEditor(handle: SourceEditorHandle): () => void {
  active = handle;
  notifyActiveSourceEditorChanged();
  return () => {
    if (active === handle) {
      active = null;
      notifyActiveSourceEditorChanged();
    }
  };
}

export function getActiveSourceEditor(): SourceEditorHandle | null {
  return active;
}
