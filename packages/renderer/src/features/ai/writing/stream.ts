import type { AgentWritingActionId } from '@nexnote/shared';
import { invoke, onEvent } from '../../../lib/ipc';

/**
 * 写作辅助流式请求封装：渲染层只发送白名单动作及选区/上下文，
 * 消费统一内部事件协议；返回可取消句柄，卸载/拒绝时取消上游流。
 */

export interface WritingStreamHandlers {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string, code?: string) => void;
}

export interface WritingStreamHandle {
  cancel: () => void;
}

export function startWritingStream(
  request: { actionId: AgentWritingActionId; target: string; contextText: string },
  handlers: WritingStreamHandlers,
): WritingStreamHandle {
  let runId: string | null = null;
  let finished = false;

  const unsubscribe = onEvent('agent:runEvent', (payload) => {
    if (payload.runId !== runId) return;
    const event = payload.event;
    if (event.type === 'delta') {
      handlers.onDelta(event.text);
    } else if (event.type === 'done') {
      finished = true;
      unsubscribe();
      handlers.onDone();
    } else if (event.type === 'error') {
      finished = true;
      unsubscribe();
      handlers.onError(event.message, event.code);
    }
  });

  void invoke('agent:run:writing', request)
    .then((res) => {
      if (finished) {
        // start 返回前已被取消：补发 cancel，避免上游孤儿流。
        void invoke('agent:cancel', { runId: res.runId }).catch(() => undefined);
        return;
      }
      runId = res.runId;
    })
    .catch((e: unknown) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      handlers.onError(e instanceof Error ? e.message : String(e));
    });

  return {
    cancel() {
      if (finished) return;
      finished = true;
      unsubscribe();
      const id = runId;
      runId = null;
      if (id) void invoke('agent:cancel', { runId: id }).catch(() => undefined);
    },
  };
}
