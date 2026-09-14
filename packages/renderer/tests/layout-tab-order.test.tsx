// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { VaultInfo } from '@nexnote/shared';
import { useVaultLayoutPersistence } from '../src/shell/layout-persistence';
import { tabIdentity, useTabStore } from '../src/stores/tab-store';
import { useUiStore } from '../src/stores/ui-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault: VaultInfo = {
  root: '/tmp/nexnote-taborder-vault',
  name: 'taborder-vault',
  configPath: '/tmp/nexnote-taborder-vault/.nexnote/config.json',
};

let container: HTMLDivElement;
let root: Root | null = null;

function mountHarness(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<Harness />));
}

function Harness(): React.ReactElement {
  useVaultLayoutPersistence(vault);
  return <div />;
}

function installBridge(handlers: Record<string, (payload?: unknown) => unknown>): {
  invokeSpy: ReturnType<typeof vi.fn>;
} {
  const invokeSpy = vi.fn((channel: string, payload?: unknown) => {
    const handler = handlers[channel];
    if (handler) return Promise.resolve({ ok: true, data: handler(payload) });
    return Promise.resolve({ ok: true, data: null });
  });
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: invokeSpy,
    on: () => () => undefined,
  };
  return { invokeSpy };
}

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null });
  const store = useTabStore.getState();
  store.openTab({ kind: 'welcome', title: '欢迎' });
  store.openPageTab('a.md');
  store.openPageTab('b.md');
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  useTabStore.setState({ tabs: [], activeTabId: null });
  document.body.innerHTML = '';
});

describe('布局持久化的页签顺序（DEV-022）', () => {
  it('恢复：vault 打开时按持久化 tabOrder 重排现有 tab', async () => {
    installBridge({
      'vault:getLayout': () => ({ tabOrder: ['a.md', 'b.md', 'kind:welcome'] }),
    });
    mountHarness();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useTabStore.getState().tabs.map(tabIdentity)).toEqual(['a.md', 'b.md', 'kind:welcome']);
  });

  it('写回：拖拽重排后防抖保存 tabOrder 到 vault 布局', async () => {
    vi.useFakeTimers();
    try {
      const { invokeSpy } = installBridge({ 'vault:getLayout': () => null });
      mountHarness();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      const welcome = useTabStore.getState().tabs[0];
      // 拖到最后（模拟 reorderTab）
      act(() => useTabStore.getState().reorderTab(welcome.id, 2));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      const saveCall = invokeSpy.mock.calls.find(([channel]) => channel === 'vault:saveLayout');
      expect(saveCall).toBeTruthy();
      const layout = (saveCall?.[1] as { layout: { tabOrder: string[] } }).layout;
      expect(layout.tabOrder).toEqual(['a.md', 'b.md', 'kind:welcome']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('写盘频率：仅切换激活 tab 不触发新的布局写盘', async () => {
    vi.useFakeTimers();
    try {
      const { invokeSpy } = installBridge({ 'vault:getLayout': () => null });
      mountHarness();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      invokeSpy.mockClear();
      const first = useTabStore.getState().tabs[0];
      act(() => useTabStore.getState().setActiveTab(first.id));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(invokeSpy.mock.calls.some(([channel]) => channel === 'vault:saveLayout')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

void useUiStore;
