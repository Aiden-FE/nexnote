import { beforeEach, describe, expect, it } from 'vitest';
import { useTabStore } from '../src/stores/tab-store';

function resetStore(): void {
  useTabStore.setState({
    panes: {
      left: { id: 'left', tabs: [], activeTabId: null },
      right: { id: 'right', tabs: [], activeTabId: null },
    },
    activePaneId: 'left',
    splitEnabled: true,
    splitRatio: 0.5,
  });
}

describe('tab-store（DEV-003 扩展）', () => {
  beforeEach(() => {
    resetStore();
    useTabStore.getState().openTab('left', { kind: 'welcome', title: '欢迎' });
  });

  it('openPageTab：同路径复用已有 tab 并激活', () => {
    const t1 = useTabStore.getState().openPageTab('left', 'notes/a.md');
    useTabStore.getState().openTab('left', { kind: 'page', title: '其他' });
    const t1again = useTabStore.getState().openPageTab('left', 'notes/a.md');
    expect(t1again.id).toBe(t1.id);
    const pane = useTabStore.getState().panes.left;
    expect(pane.tabs.length).toBe(3);
    expect(pane.activeTabId).toBe(t1.id);
  });

  it('openPageTab：默认标题为去后缀文件名', () => {
    const t = useTabStore.getState().openPageTab('left', 'dir/我的笔记.md');
    expect(t.title).toBe('我的笔记');
    expect(t.pagePath).toBe('dir/我的笔记.md');
  });

  it('closeOtherTabs：保留指定 tab 并激活', () => {
    const a = useTabStore.getState().openTab('left', { kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab('left', { kind: 'page', title: 'B' });
    useTabStore.getState().openTab('left', { kind: 'page', title: 'C' });
    useTabStore.getState().closeOtherTabs('left', b.id);
    const pane = useTabStore.getState().panes.left;
    expect(pane.tabs.map((t) => t.id)).toEqual([b.id]);
    expect(pane.activeTabId).toBe(b.id);
    void a;
  });

  it('closeTabsToRight：关闭右侧全部，激活态若被关则回退', () => {
    useTabStore.getState().openTab('left', { kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab('left', { kind: 'page', title: 'B' });
    const c = useTabStore.getState().openTab('left', { kind: 'page', title: 'C' }); // active
    useTabStore.getState().closeTabsToRight('left', b.id);
    const pane = useTabStore.getState().panes.left;
    expect(pane.tabs.some((t) => t.id === c.id)).toBe(false);
    expect(pane.activeTabId).toBe(b.id);
  });

  it('retargetTabs：重命名联动 pagePath 与标题（左右 pane 都更新）', () => {
    useTabStore.getState().openPageTab('left', 'old.md');
    useTabStore.getState().openPageTab('right', 'old.md');
    useTabStore.getState().retargetTabs('old.md', 'sub/new.md', 'new');
    const { left, right } = useTabStore.getState().panes;
    expect(left.tabs.some((t) => t.pagePath === 'sub/new.md' && t.title === 'new')).toBe(true);
    expect(right?.tabs.some((t) => t.pagePath === 'sub/new.md' && t.title === 'new')).toBe(true);
    expect([...left.tabs, ...(right?.tabs ?? [])].some((t) => t.pagePath === 'old.md')).toBe(false);
  });

  it('closeTabsForPath：删除文件关闭其 tab（目录按前缀）', () => {
    useTabStore.getState().openPageTab('left', 'dir/a.md');
    useTabStore.getState().openPageTab('left', 'dir/sub/b.md');
    const keep = useTabStore.getState().openPageTab('left', 'outside.md');
    useTabStore.getState().closeTabsForPath('dir');
    const pane = useTabStore.getState().panes.left;
    expect(pane.tabs.some((t) => t.pagePath === keep.pagePath)).toBe(true);
    expect(pane.tabs.some((t) => t.pagePath?.startsWith('dir/'))).toBe(false);
  });

  it('setTabTitle：更新指定 tab 标题', () => {
    const t = useTabStore.getState().openPageTab('left', 'x.md');
    useTabStore.getState().setTabTitle('left', t.id, 'H1 标题');
    expect(useTabStore.getState().panes.left.tabs.find((tab) => tab.id === t.id)?.title).toBe('H1 标题');
  });
});
