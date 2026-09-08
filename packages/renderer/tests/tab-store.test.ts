import { beforeEach, describe, expect, it } from 'vitest';
import { useTabStore } from '../src/stores/tab-store';

function resetStore(): void {
  useTabStore.setState({ tabs: [], activeTabId: null });
}

describe('tab-store 单 tab 栈（DEV-020）', () => {
  beforeEach(() => {
    resetStore();
    useTabStore.getState().openTab({ kind: 'welcome', title: '欢迎' });
  });

  it('openPageTab：同路径复用已有 tab 并激活', () => {
    const t1 = useTabStore.getState().openPageTab('notes/a.md');
    useTabStore.getState().openTab({ kind: 'page', title: '其他' });
    const t1again = useTabStore.getState().openPageTab('notes/a.md');
    expect(t1again.id).toBe(t1.id);
    const state = useTabStore.getState();
    expect(state.tabs.length).toBe(3);
    expect(state.activeTabId).toBe(t1.id);
  });

  it('openPageTab：默认标题为去后缀文件名', () => {
    const t = useTabStore.getState().openPageTab('dir/我的笔记.md');
    expect(t.title).toBe('我的笔记');
    expect(t.pagePath).toBe('dir/我的笔记.md');
  });

  it('closeOtherTabs：保留指定 tab 并激活', () => {
    const a = useTabStore.getState().openTab({ kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab({ kind: 'page', title: 'B' });
    useTabStore.getState().openTab({ kind: 'page', title: 'C' });
    useTabStore.getState().closeOtherTabs(b.id);
    const state = useTabStore.getState();
    expect(state.tabs.map((t) => t.id)).toEqual([b.id]);
    expect(state.activeTabId).toBe(b.id);
    void a;
  });

  it('closeTabsToRight：关闭右侧全部，激活态若被关则回退', () => {
    useTabStore.getState().openTab({ kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab({ kind: 'page', title: 'B' });
    const c = useTabStore.getState().openTab({ kind: 'page', title: 'C' }); // active
    useTabStore.getState().closeTabsToRight(b.id);
    const state = useTabStore.getState();
    expect(state.tabs.some((t) => t.id === c.id)).toBe(false);
    expect(state.activeTabId).toBe(b.id);
  });

  it('retargetTabs：重命名联动 pagePath 与标题', () => {
    useTabStore.getState().openPageTab('old.md');
    useTabStore.getState().retargetTabs('old.md', 'sub/new.md', 'new');
    const { tabs } = useTabStore.getState();
    expect(tabs.some((t) => t.pagePath === 'sub/new.md' && t.title === 'new')).toBe(true);
    expect(tabs.some((t) => t.pagePath === 'old.md')).toBe(false);
  });

  it('closeTabsForPath：删除文件关闭其 tab（目录按前缀）', () => {
    useTabStore.getState().openPageTab('dir/a.md');
    useTabStore.getState().openPageTab('dir/sub/b.md');
    const keep = useTabStore.getState().openPageTab('outside.md');
    useTabStore.getState().closeTabsForPath('dir');
    const { tabs } = useTabStore.getState();
    expect(tabs.some((t) => t.pagePath === keep.pagePath)).toBe(true);
    expect(tabs.some((t) => t.pagePath?.startsWith('dir/'))).toBe(false);
  });

  it('setTabTitle：更新指定 tab 标题', () => {
    const t = useTabStore.getState().openPageTab('x.md');
    useTabStore.getState().setTabTitle(t.id, 'H1 标题');
    expect(useTabStore.getState().tabs.find((tab) => tab.id === t.id)?.title).toBe('H1 标题');
  });
});
