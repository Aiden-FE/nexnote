// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backlink } from '@nexnote/shared';
import { BacklinksBadge } from '../src/features/sidebar/backlinks';
import { sidebarPanelRegistry } from '../src/registries';
import { useIndexStore } from '../src/stores/index-store';
import { useTabStore, type TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type BridgeResult =
  { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

function installBridge(backlinksFor: Record<string, Backlink[]>) {
  const calls: string[] = [];
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'index:backlinks') {
        const path = (payload as { pagePath: string }).pagePath;
        calls.push(path);
        return { ok: true, data: backlinksFor[path] ?? [] };
      }
      return { ok: true, data: null } satisfies BridgeResult;
    }),
    on: () => () => undefined,
  };
  return calls;
}

const pageTab = (path: string, title = path): TabDescriptor => ({
  id: `tab-${path}`,
  kind: 'page',
  title,
  pagePath: path,
  format: 'native-block',
  createdAt: 1,
});

let root: Root | null = null;
let consoleError: ReturnType<typeof vi.spyOn> | null = null;
function render(ui: React.ReactElement): void {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(ui);
  });
}

const flushAsync = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

function badgeEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="sidebar-backlink-badge"]');
}

beforeEach(() => {
  document.body.innerHTML = '';
  root = null;
  useIndexStore.getState().reset();
  useTabStore.setState({ tabs: [], activeTabId: null });
  consoleError = vi.spyOn(console, 'error');
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  expect(consoleError?.mock.calls.flat().join(' ')).not.toContain('not wrapped in act');
  consoleError?.mockRestore();
  consoleError = null;
  document.body.innerHTML = '';
});

describe('反向链接面板计数角标（DEV-024）', () => {
  it('注册面板时声明 renderBadge 角标插槽', () => {
    expect(sidebarPanelRegistry.get('backlinks')?.renderBadge).toBeDefined();
  });

  it('当前文档有反链时显示计数，且与面板列表条目数同源', async () => {
    const backlinks: Backlink[] = [
      {
        fromPath: '链接源1.md',
        fromTitle: '链接源1',
        snippet: '看 [[目标]]',
        sourceBlock: 0,
        sourceText: '看 [[目标]]',
      },
      {
        fromPath: '链接源2.md',
        fromTitle: '链接源2',
        snippet: '再看 [[目标]]',
        sourceBlock: 0,
        sourceText: '再看 [[目标]]',
      },
    ];
    installBridge({ '目标.md': backlinks });
    const tab = pageTab('目标.md');
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });
    render(<BacklinksBadge />);
    await flushAsync();
    expect(badgeEl()?.textContent).toBe('2');
    // 角标与面板列表同源（同一 store 切片）：计数 === 列表条目数
    expect(useIndexStore.getState().backlinks.length).toBe(2);
    expect(useIndexStore.getState().backlinksFor).toBe('目标.md');
  });

  it('计数为 0 时不显示角标', async () => {
    installBridge({});
    const tab = pageTab('孤立页.md');
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });
    render(<BacklinksBadge />);
    await flushAsync();
    expect(useIndexStore.getState().backlinksStatus).toBe('ready');
    expect(badgeEl()).toBeNull();
  });

  it('切换激活 tab 后角标随当前文档更新', async () => {
    installBridge({
      '目标.md': [
        {
          fromPath: '链接源.md',
          fromTitle: '链接源',
          snippet: '',
          sourceBlock: 0,
          sourceText: '[[目标]]',
        },
      ],
      '另一目标.md': [],
    });
    const tabA = pageTab('目标.md');
    const tabB = pageTab('另一目标.md');
    useTabStore.setState({ tabs: [tabA, tabB], activeTabId: tabA.id });
    render(<BacklinksBadge />);
    await flushAsync();
    expect(badgeEl()?.textContent).toBe('1');
    act(() => {
      useTabStore.getState().setActiveTab(tabB.id);
    });
    await flushAsync();
    expect(badgeEl()).toBeNull();
    act(() => {
      useTabStore.getState().setActiveTab(tabA.id);
    });
    await flushAsync();
    expect(badgeEl()?.textContent).toBe('1');
  });

  it('同一文档重复挂载（面板+角标）只发一次反链请求', async () => {
    const calls = installBridge({
      '目标.md': [
        { fromPath: 'a.md', fromTitle: 'a', snippet: '', sourceBlock: 0, sourceText: 'x' },
      ],
    });
    const tab = pageTab('目标.md');
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });
    render(
      <>
        <BacklinksBadge />
        <BacklinksBadge />
      </>,
    );
    await flushAsync();
    expect(calls).toEqual(['目标.md']);
  });

  it('无页面 tab（如欢迎页）时不显示角标并清空反链', async () => {
    installBridge({});
    const welcome: TabDescriptor = { id: 'w', kind: 'welcome', title: '欢迎', createdAt: 1 };
    useTabStore.setState({ tabs: [welcome], activeTabId: 'w' });
    render(<BacklinksBadge />);
    await flushAsync();
    expect(badgeEl()).toBeNull();
    expect(useIndexStore.getState().backlinksFor).toBeNull();
  });
});
