import { create } from 'zustand';
import type { WritingActionId, WritingKind } from './actions';

/**
 * 写作辅助 diff 预览会话（DEV-010 交付内容 5）。
 * accept/reject/cancel 由控制器在创建会话时绑定（闭包持有对应编辑器与目标范围）。
 */

export type WritingSessionStatus = 'streaming' | 'done' | 'error';

export interface WritingSession {
  id: string;
  actionId: WritingActionId;
  label: string;
  kind: WritingKind;
  status: WritingSessionStatus;
  /** 被替换/参考的原文（replace 用于 diff；append 为空串）。 */
  original: string;
  /** 累积生成文本（流式更新）。 */
  generated: string;
  truncated: boolean;
  note: string | null;
  error: string | null;
  /** 浮层视口锚点（fixed 定位）。 */
  coords: { top: number; left: number } | null;
  accept: () => void;
  reject: () => void;
  cancel: () => void;
}

interface WritingState {
  session: WritingSession | null;
  openSession: (session: WritingSession) => void;
  patchSession: (patch: Partial<WritingSession>) => void;
  closeSession: () => void;
}

export const useWritingStore = create<WritingState>((set) => ({
  session: null,
  openSession: (session) => set({ session }),
  patchSession: (patch) =>
    set((state) => (state.session ? { session: { ...state.session, ...patch } } : state)),
  closeSession: () => set({ session: null }),
}));

let sessionSeq = 0;
export function nextSessionId(): string {
  sessionSeq += 1;
  return `writing-${Date.now()}-${sessionSeq}`;
}
