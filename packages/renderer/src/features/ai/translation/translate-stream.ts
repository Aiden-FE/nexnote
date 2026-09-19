import type { AgentRunEvent, AgentTranslationRequest } from '@nexnote/shared';
import { invoke, onEvent } from '../../../lib/ipc';

/**
 * 临时翻译流式请求封装（DEV-041）：渲染层只发送原文与目标语言，
 * 消费统一 agent:runEvent 协议；返回可取消句柄，停止/关闭时取消上游流。
 *
 * reasoning 不在渲染层可控范围：主进程 translation 场景强制关闭。
 */

export interface TranslationStreamHandlers {
  onRunId?: (runId: string) => void;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string, code?: string) => void;
}

export interface TranslationStreamHandle {
  cancel: () => void;
}

type BufferedEvent = { runId: string; event: AgentRunEvent };

export function startTranslationStream(
  request: { translation: AgentTranslationRequest },
  handlers: TranslationStreamHandlers,
): TranslationStreamHandle {
  let runId: string | null = null;
  let finished = false;
  let awaitingRunId = true;
  const buffered: BufferedEvent[] = [];

  const finish = (): void => {
    finished = true;
    awaitingRunId = false;
    buffered.length = 0;
    unsubscribe();
  };

  const consume = (event: AgentRunEvent): void => {
    if (finished) return;
    if (event.type === 'delta') {
      handlers.onDelta(event.text);
    } else if (event.type === 'done') {
      finish();
      handlers.onDone();
    } else if (event.type === 'error') {
      finish();
      handlers.onError(event.message, event.code);
    }
  };

  const unsubscribe = onEvent('agent:runEvent', (payload) => {
    if (finished) return;
    if (awaitingRunId) {
      buffered.push({ runId: payload.runId, event: payload.event });
      return;
    }
    if (payload.runId === runId) consume(payload.event);
  });

  void invoke('agent:run:translation', request)
    .then((res) => {
      if (finished) {
        buffered.length = 0;
        void invoke('agent:cancel', { runId: res.runId }).catch(() => undefined);
        return;
      }
      runId = res.runId;
      awaitingRunId = false;
      handlers.onRunId?.(res.runId);
      const replay = buffered.filter((item) => item.runId === res.runId);
      buffered.length = 0;
      for (const item of replay) {
        consume(item.event);
        if (finished) break;
      }
    })
    .catch((error: unknown) => {
      if (finished) return;
      finish();
      handlers.onError(error instanceof Error ? error.message : String(error));
    });

  return {
    cancel() {
      if (finished) return;
      const id = runId;
      finish();
      runId = null;
      if (id) void invoke('agent:cancel', { runId: id }).catch(() => undefined);
    },
  };
}
