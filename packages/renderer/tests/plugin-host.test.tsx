// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { createElement } from 'react';
import type { PluginView } from '@nexnote/shared';
import { PluginSandboxFrame } from '../src/features/plugins/PluginSandboxFrame';
import { PluginHost } from '../src/features/plugins/PluginHost';
import { commandRegistry, pluginContributionRegistry } from '../src/registries';
import { setLanguage } from '../src/lib/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const contributions: PluginContributionView[] = [
  { id: 'menu', scopedId: 'com.demo:menu', pluginId: 'com.demo', kind: 'menus', title: '演示菜单' },
  { id: 'view', scopedId: 'com.demo:view', pluginId: 'com.demo', kind: 'views', title: '演示视图' },
  {
    id: 'card',
    scopedId: 'com.demo:card',
    pluginId: 'com.demo',
    kind: 'blockTypes',
    title: '卡片',
    blockType: 'card',
  },
];

function installBridge(): void {
  (
    window as unknown as {
      nexnote: {
        invoke(channel: string): Promise<unknown>;
        on(): () => void;
      };
    }
  ).nexnote = {
    async invoke(channel, payload) {
      if (channel === 'plugins:list') return { ok: true, data: [] };
      if (channel === 'plugins:listCommands') return { ok: true, data: [] };
      if (channel === 'plugins:listContributions') return { ok: true, data: contributions };
      if (channel === 'plugins:beginSession') {
        return { ok: true, data: { sessionId: 'session-id', token: 'token' } };
      }
      if (channel === 'plugins:getRuntimeSource') {
        const request = payload as { pluginId: string };
        return { ok: true, data: { pluginId: request.pluginId, source: '<script></script>' } };
      }
      if (channel === 'plugins:reportCrash') {
        const request = payload as { pluginId: string; error: string };
        return {
          ok: true,
          data: {
            id: request.pluginId,
            name: 'Runtime Plugin',
            version: '1.0.0',
            state: 'crashed',
            permissions: [],
            grants: [],
            contributionCounts: { commands: 0, menus: 0, views: 0, blockTypes: 0 },
            lastError: request.error,
          },
        };
      }
      if (channel === 'plugins:closeSession') return { ok: true, data: null };
      throw new Error(`unexpected IPC channel: ${channel}`);
    },
    on() {
      return () => undefined;
    },
  };
}

describe('PluginHost 贡献挂载', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installBridge();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    for (const item of [...commandRegistry.all()]) commandRegistry.unregister(item.id);
    for (const item of [...pluginContributionRegistry.all()]) {
      pluginContributionRegistry.unregister(item.id);
    }
  });

  it('贡献注册到命令/注册表，但不渲染底部裸露的贡献面板', async () => {
    await act(async () => {
      root.render(createElement(PluginHost));
    });
    // 等 refresh 与贡献 effect 完成
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="plugin-contribution-surfaces"]')).toBeNull();
    expect(container.textContent ?? '').not.toContain('插入 卡片');
    expect(pluginContributionRegistry.get('com.demo:card')).toBeDefined();
    const blockCommand = commandRegistry.all().find((c) => c.id === 'plugin-block:com.demo:card');
    expect(blockCommand).toMatchObject({
      title: 'plugins.blockCommand.title',
      titleParams: { title: '卡片' },
    });
  });

  it('en-US 下插件扩展点分类与权限弹窗无 CJK 残留', async () => {
    setLanguage('en-US');
    await act(async () => {
      root.render(createElement(PluginHost));
      await Promise.resolve();
    });
    expect(commandRegistry.all().some((command) => command.category === 'Plugins')).toBe(true);
    const blockCommand = commandRegistry.all().find((c) => c.id === 'plugin-block:com.demo:card');
    expect(blockCommand?.titleParams).toEqual({ title: '卡片' });
    await act(async () => {
      root.unmount();
    });
    setLanguage('zh-CN');
  });

  it('keeps crash markers from non-heartbeat paths as raw forwarded strings', async () => {
    const crashRequests: Array<{
      pluginId: string;
      error: PluginCrashErrorCode;
      message: string;
    }> = [];
    const runtimePlugin: PluginView = {
      id: 'com.demo.runtime',
      name: 'Runtime Plugin',
      version: '1.0.0',
      state: 'active',
      permissions: [],
      grants: [],
      contributionCounts: { commands: 0, menus: 0, views: 0, blockTypes: 0 },
    };
    const invokeSpy = (
      window as unknown as {
        nexnote: {
          invoke(
            channel: string,
            payload?: {
              pluginId: string;
              error: PluginCrashErrorCode;
              message: string;
            },
          ): Promise<{ ok: true; data: unknown }>;
        };
      }
    ).nexnote.invoke;
    const originalInvoke = invokeSpy;
    (
      window as unknown as {
        nexnote: {
          invoke(channel: string, payload?: unknown): Promise<{ ok: true; data: unknown }>;
        };
      }
    ).nexnote.invoke = async (channel, payload) => {
      if (channel === 'plugins:reportCrash') {
        crashRequests.push(payload);
      }
      return originalInvoke(channel, payload);
    };

    await act(async () => {
      root.render(
        createElement(PluginSandboxFrame, {
          plugin: runtimePlugin,
          onPermissionRequired: () => undefined,
          visible: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    });

    const frame = container.querySelector('iframe');
    const originalIframeRemove = HTMLIFrameElement.prototype.remove;
    HTMLIFrameElement.prototype.remove = function remove(): void {};
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame?.contentWindow,
          data: { type: 'crash', message: 'APP:PLUGIN_HEARTBEAT_TIMEOUT' },
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    setLanguage('en-US');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(crashRequests).toEqual([
      {
        pluginId: runtimePlugin.id,
        error: undefined,
        message: 'APP:PLUGIN_HEARTBEAT_TIMEOUT',
        sessionId: 'session-id',
        token: 'token',
      },
    ]);
    HTMLIFrameElement.prototype.remove = originalIframeRemove;
  });
});

describe('PluginSandboxFrame heartbeat 崩溃', () => {
  let runtimeCrashRequest: Record<string, unknown> | undefined;

  it('reports app-generated heartbeats with a typed error code', async () => {
    const runtimePlugin: PluginView = {
      id: 'com.demo.frame',
      name: 'Runtime Plugin',
      version: '1.0.0',
      state: 'active',
      permissions: [],
      grants: [],
      contributionCounts: { commands: 0, menus: 0, views: 0, blockTypes: 0 },
    };
    const invoke = async (channel: string, payload?: unknown) => {
      if (channel === 'plugins:beginSession') {
        return { ok: true, data: { sessionId: 'session-id', token: 'token' } };
      }
      if (channel === 'plugins:getRuntimeSource') {
        return { ok: true, data: { pluginId: runtimePlugin.id, source: '<script></script>' } };
      }
      if (channel === 'plugins:reportCrash') {
        runtimeCrashRequest = payload;
        return { ok: true, data: null };
      }
      if (channel === 'plugins:closeSession') return { ok: true, data: null };
      throw new Error(`unexpected IPC channel: ${channel}`);
    };
    (window as unknown as { nexnote: unknown }).nexnote = {
      invoke,
      on: () => () => undefined,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const originalIframeRemove = HTMLIFrameElement.prototype.remove;
    HTMLIFrameElement.prototype.remove = function remove(): void {};
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(createElement(PluginSandboxFrame, { plugin: runtimePlugin }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector('iframe')).not.toBeNull();
      await act(async () => {
        vi.runAllTimers();
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
    expect(runtimeCrashRequest).toMatchObject({
      pluginId: runtimePlugin.id,
      error: 'PLUGIN_HEARTBEAT_TIMEOUT',
      message: 'APP:PLUGIN_HEARTBEAT_TIMEOUT',
    });
    await act(async () => {
      root.unmount();
    });
    HTMLIFrameElement.prototype.remove = originalIframeRemove;
    container.remove();
  });
});
