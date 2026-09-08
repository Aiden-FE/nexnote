import { beforeEach, describe, expect, it } from 'vitest';
import { useTabStore } from '../src/stores/tab-store';

function resetStore(): void {
  useTabStore.setState({ tabs: [], activeTabId: null });
}

describe('tab store 源码模式（DEV-020）', () => {
  beforeEach(resetStore);

  it('toggleSourceMode 仅作用于 Markdown 页面 tab', () => {
    const page = useTabStore.getState().openTab({ kind: 'page', title: 'A', pagePath: 'a.md' });
    const welcome = useTabStore.getState().openTab({ kind: 'welcome', title: '欢迎' });

    useTabStore.getState().toggleSourceMode(page.id);
    expect(useTabStore.getState().tabs.find((t) => t.id === page.id)?.editorMode).toBe('source');

    useTabStore.getState().toggleSourceMode(welcome.id);
    expect(
      useTabStore.getState().tabs.find((t) => t.id === welcome.id)?.editorMode,
    ).toBeUndefined();

    useTabStore.getState().toggleSourceMode(page.id, false);
    expect(useTabStore.getState().tabs.find((t) => t.id === page.id)?.editorMode).toBe('block');
  });

  it('关闭并重开 tab 回到块编辑模式（模式不跨 tab 生命周期）', () => {
    const page = useTabStore.getState().openPageTab('a.md');
    useTabStore.getState().toggleSourceMode(page.id, true);
    useTabStore.getState().closeTab(page.id);

    const reopened = useTabStore.getState().openPageTab('a.md');
    expect(reopened.id).not.toBe(page.id);
    expect(reopened.editorMode).toBeUndefined();
  });

  it('updateTab 可同步模式（切换入口共用同一状态）', () => {
    const page = useTabStore.getState().openPageTab('a.md');
    useTabStore.getState().updateTab(page.id, { editorMode: 'source' });
    expect(useTabStore.getState().tabs.find((t) => t.id === page.id)?.editorMode).toBe('source');
  });
});
