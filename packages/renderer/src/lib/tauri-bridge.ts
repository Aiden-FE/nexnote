import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { isIpcChannel, isIpcEventChannel, tCurrent, type Result } from '@nexnote/shared';

interface NexnoteBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, callback: (payload: unknown) => void): () => void;
}

interface InvokeEnvelope {
  ok: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

/**
 * Tauri compatibility bridge. Electron still installs window.nexnote through preload;
 * in a Tauri build this adapter preserves the shared typed channel boundary while the
 * implementation moves namespace by namespace into Rust product commands.
 */
export function installTauriIpcBridge(): void {
  const hostWindow = window as typeof window & { nexnote?: NexnoteBridge };
  if (hostWindow.nexnote || !('__TAURI_INTERNALS__' in window)) return;

  const bridge: NexnoteBridge = {
    async invoke(channel: string, payload?: unknown): Promise<unknown> {
      if (!isIpcChannel(channel)) {
        return {
          ok: false,
          error: tCurrent('ipc.error.UNKNOWN_CHANNEL', { channel }),
          code: 'UNKNOWN_CHANNEL',
        } satisfies Result<never>;
      }
      return await tauriInvoke<InvokeEnvelope>('nexnote_invoke', {
        channel,
        payload: payload ?? null,
      });
    },
    on(channel: string, callback: (payload: unknown) => void): () => void {
      if (!isIpcEventChannel(channel)) {
        throw new Error(tCurrent('ipc.error.UNKNOWN_EVENT_CHANNEL', { channel }));
      }

      let unlisten: (() => void) | null = null;
      let disposed = false;
      void tauriListen<unknown>(channel, (event: { payload: unknown }) => callback(event.payload)).then((fn: () => void) => {
        if (disposed) fn();
        else unlisten = fn;
      });
      return () => {
        disposed = true;
        unlisten?.();
        unlisten = null;
      };
    },
  };

  Object.defineProperty(window, 'nexnote', {
    value: bridge,
    writable: false,
    configurable: false,
  });
}
