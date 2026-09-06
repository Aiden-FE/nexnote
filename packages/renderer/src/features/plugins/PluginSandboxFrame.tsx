import { useCallback, useEffect, useRef, useState } from 'react';
import { PLUGIN_API_VERSION, type PluginView } from '@nexnote/shared';
import { invoke } from '../../lib/ipc';
import { invokeWithPermissionRetry } from './permission-flow';
import type { PermissionPrompt, SandboxMessage } from './sandbox-protocol';
import { PLUGIN_HEARTBEAT_TIMEOUT_MS } from './sandbox-watchdog';

export function PluginSandboxFrame({
  plugin,
  onPermissionRequired,
}: {
  plugin: PluginView;
  onPermissionRequired: (prompt: PermissionPrompt) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState<{ pluginId: string; source: string } | null>(null);
  // 相对路径：dev 下解析到 dev-server 根，打包后 file:// 下解析到 out/renderer/plugin-runtime/。
  const runtimeUrl = new URL('plugin-runtime/index.html', window.location.href).toString();
  const portRef = useRef<MessagePort | null>(null);
  const sessionRef = useRef<{ sessionId: string; token: string } | null>(null);
  const pluginRef = useRef(plugin.id);
  useEffect(() => {
    pluginRef.current = plugin.id;
  }, [plugin.id]);

  // 每次启用/激活生成一个不可伪造会话 token；注入 init 前必须 beginSession。
  useEffect(() => {
    let cancelled = false;
    const setup = async (): Promise<void> => {
      const nonce = crypto.randomUUID();
      const session = await invoke('plugins:beginSession', {
        pluginId: plugin.id,
        nonce,
        origin: 'plugin-frame',
      });
      if (cancelled) {
        void invoke('plugins:closeSession', { sessionId: session.sessionId, token: session.token });
        return;
      }
      sessionRef.current = session;
      const payload = await invoke('plugins:getRuntimeSource', {
        sessionId: session.sessionId,
        token: session.token,
        pluginId: plugin.id,
      });
      if (!cancelled) setSource(payload);
    };
    void setup().catch((error) => {
      if (!cancelled) {
        void invoke('plugins:reportCrash', {
          sessionId: sessionRef.current?.sessionId ?? '',
          token: sessionRef.current?.token ?? '',
          pluginId: plugin.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return () => {
      cancelled = true;
      if (sessionRef.current) {
        void invoke('plugins:closeSession', sessionRef.current);
        sessionRef.current = null;
      }
      if (portRef.current) {
        portRef.current.close();
        portRef.current = null;
      }
    };
  }, [plugin.id]);

  const askPermission = useCallback(
    (permission: string) =>
      new Promise<{ allowed: boolean; alwaysAllow: boolean }>((resolve) => {
        onPermissionRequired({
          pluginId: pluginRef.current,
          permission,
          request: {
            apiVersion: PLUGIN_API_VERSION,
            id: 'pending',
            method: 'permission.request',
            params: { permission },
          },
          decide(allowed, alwaysAllow) {
            resolve({ allowed, alwaysAllow });
          },
        });
      }),
    [onPermissionRequired],
  );

  useEffect(() => {
    if (!source) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const session = sessionRef.current;
    if (!session) return;

    let lastBeat = performance.now();
    let cancelled = false;
    let heartbeatTimer: number | null = null;

    const isolateCrash = (message: string): void => {
      // Revoke the main-process session first; only then remove executable frame state.
      void invoke('plugins:reportCrash', {
        sessionId: session.sessionId,
        token: session.token,
        pluginId: pluginRef.current,
        message,
      }).finally(() => {
        portRef.current?.close();
        portRef.current = null;
        iframe.remove();
      });
    };

    const beat = (): void => {
      lastBeat = performance.now();
    };
    const tick = (): void => {
      if (cancelled) return;
      if (performance.now() - lastBeat > PLUGIN_HEARTBEAT_TIMEOUT_MS) {
        cancelled = true;
        isolateCrash('插件脚本无响应（heartbeat 超时）');
        return;
      }
      heartbeatTimer = window.setTimeout(tick, 500);
    };
    heartbeatTimer = window.setTimeout(tick, 1_500);

    const onMessage = (event: MessageEvent<SandboxMessage>): void => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.type === 'heartbeat') {
        beat();
        return;
      }
      if (event.data?.type === 'runtime-ready') {
        if (event.data.pluginId !== source.pluginId) return;
        beat();
        return;
      }
      if (event.data?.type === 'crash') {
        isolateCrash(event.data.message);
        return;
      }
      if (event.data?.type !== 'ready') return;
      // 同一会话只建立一次 port，防止重复 ready 伪造
      if (portRef.current) return;
      const channel = new MessageChannel();
      portRef.current = channel.port1;
      channel.port1.onmessage = async (portEvent: MessageEvent<SandboxMessage>) => {
        if (portEvent.data?.type !== 'rpc') return;
        const rpcRequest = portEvent.data.request;
        const response = await invokeWithPermissionRetry(
          pluginRef.current,
          rpcRequest,
          askPermission,
          {
            rpc: (pluginId, req) =>
              invoke('plugins:rpc', {
                sessionId: session.sessionId,
                token: session.token,
                request: req,
              }),
            grant: async (pluginId, permission, alwaysAllow) => {
              const challenge = await invoke('plugins:beginAuthChallenge', {
                sessionId: session.sessionId,
                token: session.token,
                request: rpcRequest,
              });
              await invoke('plugins:grantPermission', {
                challenge: challenge.challenge,
                sessionId: session.sessionId,
                token: session.token,
                requestId: rpcRequest.id,
                alwaysAllow,
              });
            },
          },
        );
        channel.port1.postMessage({ type: 'rpc-response', response } satisfies SandboxMessage);
      };
      iframe.contentWindow?.postMessage(
        { type: 'init', source: source.source, pluginId: source.pluginId },
        '*',
        [channel.port2],
      );
    };
    window.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
      if (heartbeatTimer) {
        window.clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (portRef.current) {
        // Lifecycle teardown travels over the trusted one-time port before it closes.
        portRef.current.postMessage({
          type: 'lifecycle',
          hook: 'deactivate',
        } satisfies SandboxMessage);
        portRef.current.postMessage({ type: 'lifecycle', hook: 'unload' } satisfies SandboxMessage);
        portRef.current.close();
        portRef.current = null;
      }
    };
  }, [source, askPermission]);

  if (!source) return null;
  return (
    <iframe
      ref={iframeRef}
      title={`plugin-${source.pluginId}`}
      data-testid={`plugin-sandbox-${source.pluginId}`}
      sandbox="allow-scripts"
      src={runtimeUrl}
      className="hidden h-0 w-0 border-0"
    />
  );
}
