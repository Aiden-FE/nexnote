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

  it('native-block 文档拒绝源码模式并自动回到 block', () => {
    const page = useTabStore.getState().openTab({
      kind: 'page',
      title: 'Native',
      pagePath: 'native.md',
    });
    useTabStore.getState().updateTab(page.id, { format: 'native-block', editorMode: 'source' });
    useTabStore.getState().toggleSourceMode(page.id);
    expect(useTabStore.getState().tabs.find((t) => t.id === page.id)).toMatchObject({
      format: 'native-block',
      editorMode: 'block',
    });
  });

  it('Markdown 三视图与 tab 级分栏比例独立于源码编辑器模式', () => {
    const markdown = useTabStore.getState().openTab({
      kind: 'page',
      title: 'Markdown',
      pagePath: 'markdown.md',
    });
    useTabStore.getState().updateTab(markdown.id, { format: 'markdown', editorMode: 'source' });
    useTabStore.getState().setMarkdownView(markdown.id, 'source');
    expect(useTabStore.getState().tabs.find((t) => t.id === markdown.id)?.markdownView).toBe('source');
    useTabStore.getState().setMarkdownView(markdown.id, 'preview');
    expect(useTabStore.getState().tabs.find((t) => t.id === markdown.id)).toMatchObject({
      markdownView: 'preview',
      lastMarkdownEditView: 'source',
    });
    useTabStore.getState().toggleMarkdownPreview(markdown.id);
    expect(useTabStore.getState().tabs.find((t) => t.id === markdown.id)?.markdownView).toBe('source');
    useTabStore.getState().setSplitRatio(markdown.id, 0.1);
    expect(useTabStore.getState().tabs.find((t) => t.id === markdown.id)?.splitRatio).toBe(0.2);
    useTabStore.getState().setSplitRatio(markdown.id, 0.9);
    expect(useTabStore.getState().tabs.find((t) => t.id === markdown.id)?.splitRatio).toBe(0.8);
  });

  it('updateTab 可同步模式（切换入口共用同一状态）', () => {
    const page = useTabStore.getState().openPageTab('a.md');
    useTabStore.getState().updateTab(page.id, { editorMode: 'source' });
    expect(useTabStore.getState().tabs.find((t) => t.id === page.id)?.editorMode).toBe('source');
  });
});
