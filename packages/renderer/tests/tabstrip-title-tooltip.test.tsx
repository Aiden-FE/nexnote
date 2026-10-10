// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATALOGS, translate } from '@nexnote/shared';
import { TabStrip } from '../src/tabs/TabStrip';
import { useTabStore } from '../src/stores/tab-store';
import { setLanguage } from '../src/lib/i18n';

/**
 * DEV-035 验收 2/4：Tab 文件名过长截断并以 tooltip 展示完整名称；
 * H1 改名后 Tab 标题（含 tooltip）同步不回归。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const text = (
  language: 'zh-CN' | 'en-US',
  key: string,
  params?: Record<string, string | number>,
): string => translate(CATALOGS[language], key, language, params);

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
  setLanguage('zh-CN');
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
    expect(close?.getAttribute('aria-label')).toBe(
      text('zh-CN', 'tabs.closeWithTitle', { title: LONG_TITLE }),
    );
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

  it('en-US 关闭按钮可访问名与标签栏标签按词典成文且无 CJK（ADR-0023）', () => {
    setLanguage('en-US');
    mount();
    const tablist = document.querySelector('[role="tablist"]');
    expect(tablist?.getAttribute('aria-label')).toBe(text('en-US', 'tabs.tablistLabel'));
    const close = document.querySelector(
      '[data-testid="tab"][data-page-path="长标题页.md"] button[aria-label]',
    );
    const closeLabel = close?.getAttribute('aria-label') ?? '';
    expect(closeLabel).toBe(text('en-US', 'tabs.closeWithTitle', { title: LONG_TITLE }));
    // 关闭标签的 aria-label 会拼接用户标题（内容数据，允许中文）；
    // UI 模板片段本身必须是 en-US 文案。
    const newTab = document.querySelector('[data-testid="new-tab"]');
    expect(newTab?.getAttribute('aria-label')).toBe(text('en-US', 'tabs.newTab'));
    expect(closeLabel.startsWith(text('en-US', 'common.close'))).toBe(true);
    expect(tablist?.getAttribute('aria-label')).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
