import type { AgentRunEvent, AgentWritingActionId, IpcEventMap } from '@nexnote/shared';
import { invoke, onEvent } from '../../../lib/ipc';

/**
 * 写作辅助流式请求封装：渲染层只发送白名单动作及选区/上下文，
 * 消费统一内部事件协议；返回可取消句柄，卸载/拒绝时取消上游流。
 *
 * DEV-037：`invoke` 返回 runId 与事件推送是两条独立通道，事件可能先于 runId 到达
 * （首片段即显示不能依赖 IPC 时序）。runId 未知期间到达的事件先按序缓冲，
 * 拿到 runId 后按序回放匹配事件，其余丢弃——既不丢首片段，也不丢早到的终态事件
 * （否则会话会永久停在 streaming）。
 */

export interface WritingStreamHandlers {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string, code?: string) => void;
}

export interface WritingStreamHandle {
  /** Resolves false only when the initial IPC request cannot establish a stream. */
  readonly started: Promise<boolean>;
  cancel: () => void;
}

type RunEventPayload = IpcEventMap['agent:runEvent'];

export function startWritingStream(
  request: { actionId: AgentWritingActionId; target: string; contextText: string },
  handlers: WritingStreamHandlers,
): WritingStreamHandle {
  let runId: string | null = null;
  let finished = false;
  let buffered: RunEventPayload[] = [];
  let resolveStarted!: (started: boolean) => void;
  const started = new Promise<boolean>((resolve) => {
    resolveStarted = resolve;
  });

  /** 只转发写作会话关心的事件；start/fallback/context/tool 等对预览无意义。 */
  const deliver = (event: AgentRunEvent) => {
    if (event.type === 'delta') {
      handlers.onDelta(event.text);
    } else if (event.type === 'done') {
      resolveStarted(runId !== null);
      finish();
      handlers.onDone();
    } else if (event.type === 'error') {
      resolveStarted(runId !== null);
      finish();
      handlers.onError(event.message, event.code);
    }
  };

  const unsubscribe = onEvent('agent:runEvent', (payload) => {
    if (finished) return;
    if (runId === null) {
      buffered.push(payload);
      return;
    }
    if (payload.runId !== runId) return;
    deliver(payload.event);
  });

  function finish() {
    if (finished) return;
    finished = true;
    buffered = [];
    unsubscribe();
  }

  void invoke('agent:run:writing', request)
    .then((res) => {
      if (finished) {
        resolveStarted(false);
        // start 返回前已被取消：补发 cancel，避免上游孤儿流。
        void invoke('agent:cancel', { runId: res.runId }).catch(() => undefined);
        return;
      }
      runId = res.runId;
      resolveStarted(true);
      const replay = buffered;
      buffered = [];
      for (const payload of replay) {
        if (finished) break;
        if (payload.runId !== runId) continue;
        deliver(payload.event);
      }
    })
    .catch((e: unknown) => {
      if (finished) {
        resolveStarted(false);
        return;
      }
      finish();
      resolveStarted(false);
      handlers.onError(e instanceof Error ? e.message : String(e));
    });

  return {
    started,
    cancel() {
      resolveStarted(false);
      if (finished) return;
      finish();
      const id = runId;
      runId = null;
      if (id) void invoke('agent:cancel', { runId: id }).catch(() => undefined);
    },
  };
}
