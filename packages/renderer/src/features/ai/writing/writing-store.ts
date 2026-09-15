import { create } from 'zustand';
import type { WritingActionId, WritingKind } from './actions';

/**
 * 写作辅助 diff 预览会话（DEV-010 交付内容 5；DEV-037 状态机收口）。
 *
 * 状态机（ADR-0005）：
 *   streaming --done--> done          （完整结果，等待 Accept/Reject）
 *   streaming --stop--> cancelled     （保留已显示内容 + 标记未完成，仍可 Accept/Reject）
 *   streaming --error-> error         （失败/断线；同样保留已显示内容 + 标记未完成）
 * 终态一律停留在浮层，直到用户显式 Accept（单事务写回，单 undo）或 Reject（丢弃会话，原文不变）。
 * 流式过程只更新本 store，绝不触碰编辑器文档，因此不产生 undo 单元。
 */

export type WritingSessionStatus = 'streaming' | 'done' | 'cancelled' | 'error';

/** 未完成终态：内容保留但生成未正常结束。 */
export const INCOMPLETE_STATUSES: readonly WritingSessionStatus[] = ['cancelled', 'error'];

export function isIncomplete(status: WritingSessionStatus): boolean {
  return INCOMPLETE_STATUSES.includes(status);
}

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
  /** 停止生成：取消上游流，保留已显示内容并把会话标记为未完成（不关闭浮层）。 */
  stop: () => void;
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
