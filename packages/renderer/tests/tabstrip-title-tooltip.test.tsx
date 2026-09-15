// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TabStrip } from '../src/tabs/TabStrip';
import { useTabStore } from '../src/stores/tab-store';

/**
 * DEV-035 验收 2/4：Tab 文件名过长截断并以 tooltip 展示完整名称；
 * H1 改名后 Tab 标题（含 tooltip）同步不回归。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LONG_TITLE = '这是一个非常非常长的页面标题用于验证截断与完整 tooltip 展示不回归';

let container: HTMLDivElement;
let root: Root | null = null;

function mount(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<TabStrip />));
}

const titleSpan = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-testid="tab-title"]');

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null });
  const store = useTabStore.getState();
  store.openTab({ kind: 'welcome', title: '欢迎' });
  store.openPageTab('长标题页.md', LONG_TITLE);
  const page = useTabStore.getState().tabs.find((tab) => tab.pagePath === '长标题页.md');
  if (page) useTabStore.getState().setActiveTab(page.id);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.body.innerHTML = '';
  useTabStore.setState({ tabs: [], activeTabId: null });
});

describe('Tab 标题截断与 tooltip（DEV-035）', () => {
  it('过长标题由 CSS 截断，完整名称经 title 属性展示', () => {
    mount();
    const pageTab = document.querySelector(
      '[data-testid="tab"][data-page-path="长标题页.md"] [data-testid="tab-title"]',
    );
    expect(pageTab?.textContent).toBe(LONG_TITLE);
    expect(pageTab?.getAttribute('title')).toBe(LONG_TITLE);
    expect(pageTab?.className).toContain('truncate');
  });

  it('关闭按钮的可访问名称仍使用完整标题（截断不改变语义）', () => {
    mount();
    const close = document.querySelector(
      '[data-testid="tab"][data-page-path="长标题页.md"] button[aria-label]',
    );
    expect(close?.getAttribute('aria-label')).toBe(`关闭 ${LONG_TITLE}`);
  });

  it('H1 改名后的标题同步同时更新文本与 tooltip', () => {
    mount();
    const page = useTabStore.getState().tabs.find((tab) => tab.pagePath === '长标题页.md');
    act(() => {
      useTabStore.getState().updateTab(page!.id, {
        title: '改名后的标题',
        pagePath: '改名后的标题.md',
      });
    });
    const span = document.querySelector(
      '[data-testid="tab"][data-page-path="改名后的标题.md"] [data-testid="tab-title"]',
    );
    expect(span?.textContent).toBe('改名后的标题');
    expect(span?.getAttribute('title')).toBe('改名后的标题');
    // 其余 tab 不受影响
    expect(titleSpan()).not.toBeNull();
  });
});
