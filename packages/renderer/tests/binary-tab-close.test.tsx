// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, translate } from '@nexnote/shared';
import { useTabStore } from '../src/stores/tab-store';
import { BinaryTabView } from '../src/pages/BinaryTabView';
import { setLanguage } from '../src/lib/i18n';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/ipc', () => ({ invoke }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<ReturnType<typeof createRoot>> = [];
const text = (
  language: 'zh-CN' | 'en-US',
  key: string,
  params?: Record<string, string | number>,
): string => translate(CATALOGS[language], key, language, params);

function TabHarness() {
  const tabs = useTabStore((state) => state.tabs);
  return (
    <>
      {tabs.map((tab) => (
        <BinaryTabView key={tab.id} tab={tab} />
      ))}
    </>
  );
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

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.innerHTML = '';
  setLanguage('zh-CN');
});

describe('binary tab close failure (DEV-074)', () => {
  async function closeFailingTab(title: string): Promise<HTMLDivElement> {
    const tab = useTabStore.getState().openBinaryTab('docs/report.xlsx', title, 'xlsx');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

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
    expect(useTabStore.getState().tabs[0]?.pagePath).toBe('docs/report.xlsx');
    return container;
  }

  it('restores the tab and surfaces the save failure when host close fails', async () => {
    const container = await closeFailingTab('报告');
    // 错误在写入 tab store 前已由 t() 成文（ADR-0023）。
    expect(useTabStore.getState().binaryTabCloseError).toBe(
      text('zh-CN', 'binary.saveError', { title: '报告', detail: ' flush failed' }),
    );
    expect(container.textContent).toContain(text('zh-CN', 'binary.editorLoading'));
  });

  it('restores the tab and surfaces the catalog-driven English save failure', async () => {
    setLanguage('en-US');
    const container = await closeFailingTab('Report');
    const error = useTabStore.getState().binaryTabCloseError ?? '';
    expect(error).toBe(text('en-US', 'binary.saveError', { title: 'Report', detail: ' flush failed' }));
    expect(container.textContent).toContain(text('en-US', 'binary.editorLoading'));
    expect(error).not.toMatch(/[一-鿿]/);
  });
});
