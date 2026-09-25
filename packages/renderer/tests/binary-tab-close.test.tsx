// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabStore } from '../src/stores/tab-store';
import { BinaryTabView } from '../src/pages/BinaryTabView';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/ipc', () => ({ invoke }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function TabHarness() {
  const tabs = useTabStore((state) => state.tabs);
  return <>{tabs.map((tab) => <BinaryTabView key={tab.id} tab={tab} />)}</>;
}

beforeEach(() => {
  document.body.innerHTML = '';
  invoke.mockImplementation((channel: string) =>
    channel === 'binary:host:close'
      ? Promise.reject(new Error('flush failed'))
      : Promise.resolve({}),
  );
  useTabStore.setState({ tabs: [], activeTabId: null, binaryTabCloseError: null });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('binary tab close failure (DEV-074)', () => {
  it('restores the tab and surfaces the save failure when host close fails', async () => {
    const tab = useTabStore.getState().openBinaryTab('docs/report.docx', '报告', 'docx');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<TabHarness />);
    });
    act(() => {
      useTabStore.getState().closeTab(tab.id);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useTabStore.getState().tabs[0]?.pagePath).toBe('docs/report.docx');
    expect(useTabStore.getState().binaryTabCloseError).toContain('标签页已保留');
    expect(container.textContent).toContain('编辑器加载中');

    await act(async () => root.unmount());
  });
});
