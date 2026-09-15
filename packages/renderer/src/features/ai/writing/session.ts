import type { AgentWritingActionId } from '@nexnote/shared';
import type { WritingActionDef } from './actions';
import { startWritingStream, type WritingStreamHandle } from './stream';
import { nextSessionId, useWritingStore } from './writing-store';

export interface WritingSessionPlan {
  action: WritingActionDef;
  request: { actionId: AgentWritingActionId; target: string; contextText: string };
  original: string;
  coords: { top: number; left: number } | null;
  truncated: boolean;
  note: string | null;
  apply: (generated: string) => void;
}

/**
 * 写作会话状态机（DEV-037）：块编辑与源码模式共用的唯一入口。
 *
 * - 单飞：同一时刻只允许一个写作流，新会话顶掉旧会话前先向上游发 cancel
 * - 流式期间只更新预览 store（accumulate delta），编辑器文档与撤销栈零接触
 * - 终态一律保留会话：done 等待裁决；stop → cancelled、失败/断线 → error
 *   都保留已显示内容并标记未完成，仍可 Accept（单事务写回、单 undo）或 Reject（丢弃，原文不变）
 * - 一切 patch 先校验 session id，晚到的旧流事件不会污染新会话
 */
export function beginWritingSession(plan: WritingSessionPlan): void {
  const previous = useWritingStore.getState().session;
  if (previous?.status === 'streaming') previous.stop();

  const sessionId = nextSessionId();
  let stream: WritingStreamHandle | null = null;
  const current = () => {
    const session = useWritingStore.getState().session;
    return session?.id === sessionId ? session : null;
  };

  useWritingStore.getState().openSession({
    id: sessionId,
    actionId: plan.action.id,
    label: plan.action.label,
    kind: plan.action.kind,
    status: 'streaming',
    original: plan.original,
    generated: '',
    truncated: plan.truncated,
    note: plan.note,
    error: null,
    coords: plan.coords,
    accept: () => {
      const session = current();
      if (!session) return;
      stream?.cancel();
      if (session.generated.trim()) plan.apply(session.generated);
      useWritingStore.getState().closeSession();
    },
    reject: () => {
      if (!current()) return;
      stream?.cancel();
      useWritingStore.getState().closeSession();
    },
    stop: () => {
      const session = current();
      if (!session || session.status !== 'streaming') return;
      stream?.cancel();
      useWritingStore.getState().patchSession({ status: 'cancelled' });
    },
  });

  stream = startWritingStream(plan.request, {
    onDelta: (text) => {
      const session = current();
      if (session) useWritingStore.getState().patchSession({ generated: session.generated + text });
    },
    onDone: () => {
      if (current()) useWritingStore.getState().patchSession({ status: 'done' });
    },
    onError: (message, code) => {
      if (current()) {
        useWritingStore.getState().patchSession({
          status: 'error',
          error: `${message}${code ? `（${code}）` : ''}`,
        });
      }
    },
  });
}
