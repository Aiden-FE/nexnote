// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { createElement } from 'react';
import type { PluginContributionView } from '@nexnote/shared';
import { PluginHost } from '../src/features/plugins/PluginHost';
import { commandRegistry, pluginContributionRegistry } from '../src/registries';

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
    async invoke(channel) {
      if (channel === 'plugins:list') return { ok: true, data: [] };
      if (channel === 'plugins:listCommands') return { ok: true, data: [] };
      if (channel === 'plugins:listContributions') return { ok: true, data: contributions };
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
    expect(commandRegistry.all().some((c) => c.title === '插入插件块：卡片')).toBe(true);
  });
});
