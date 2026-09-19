import type { AgentTranslationRequest } from '@nexnote/shared';
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

export function startTranslationStream(
  request: { translation: AgentTranslationRequest },
  handlers: TranslationStreamHandlers,
): TranslationStreamHandle {
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

  void invoke('agent:run:translation', request)
    .then((res) => {
      if (finished) {
        // start 返回前已被停止/关闭：补发 cancel，避免上游孤儿流。
        void invoke('agent:cancel', { runId: res.runId }).catch(() => undefined);
        return;
      }
      runId = res.runId;
      handlers.onRunId?.(res.runId);
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
