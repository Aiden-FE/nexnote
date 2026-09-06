import { useUiStore } from '../../../stores/ui-store';
import { useChatStore } from './chat-store';

/** 选区浮动工具栏 / 右键菜单「询问 AI」动作 id（kernel UI 回传）。 */
export const CHAT_ASK_ACTION = 'chat:ask-selection';

/**
 * 从选区/块「询问 AI」：把选区作为上下文送入对话 dock 并展开 dock。
 * 由 EditorView 的 selection bubble / context menu 回调调用。
 */
export function requestAskAi(
  selectionText: string,
  docTitle: string | null,
  docPath: string | null,
): void {
  const text = selectionText.trim();
  if (!text) return;
  useChatStore.getState().queueAsk({ selectionText: text, docTitle, docPath });
  useUiStore.getState().setActiveDockPanel('ai-chat');
}
