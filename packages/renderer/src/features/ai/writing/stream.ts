import type { ChatMessage } from '@nexnote/shared';
import { invoke, onEvent } from '../../../lib/ipc';

/**
 * 写作辅助流式请求封装：复用 DEV-009 的 ai:chat:stream:* 通道（feature='writing'），
 * 渲染层只消费统一内部事件协议；返回可取消句柄，卸载/拒绝时取消上游流。
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
  messages: ChatMessage[],
  handlers: WritingStreamHandlers,
): WritingStreamHandle {
  let streamId: string | null = null;
  let finished = false;

  const unsubscribe = onEvent('ai:streamEvent', (payload) => {
    if (payload.streamId !== streamId) return;
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

  void invoke('ai:chat:stream:start', { messages, feature: 'writing' })
    .then((res) => {
      if (finished) {
        // start 返回前已被取消：补发 cancel，避免上游孤儿流。
        void invoke('ai:chat:stream:cancel', { streamId: res.streamId }).catch(() => undefined);
        return;
      }
      streamId = res.streamId;
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
      const id = streamId;
      streamId = null;
      if (id) void invoke('ai:chat:stream:cancel', { streamId: id }).catch(() => undefined);
    },
  };
}
