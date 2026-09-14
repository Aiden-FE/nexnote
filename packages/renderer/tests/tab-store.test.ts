import { beforeEach, describe, expect, it } from 'vitest';
import { tabIdentity, useTabStore } from '../src/stores/tab-store';

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

describe('tab-store 拖拽排序与循环切换（DEV-022）', () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
  });

  it('reorderTab：把 tab 移动到目标下标（后移）', () => {
    const a = useTabStore.getState().openTab({ kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab({ kind: 'page', title: 'B' });
    const c = useTabStore.getState().openTab({ kind: 'page', title: 'C' });
    useTabStore.getState().reorderTab(a.id, 2);
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([b.id, c.id, a.id]);
  });

  it('reorderTab：把 tab 移动到目标下标（前移）', () => {
    const a = useTabStore.getState().openTab({ kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab({ kind: 'page', title: 'B' });
    const c = useTabStore.getState().openTab({ kind: 'page', title: 'C' });
    useTabStore.getState().reorderTab(c.id, 0);
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
  });

  it('reorderTab：目标下标越界时夹取到边界；未知 id 与原位为 no-op', () => {
    const a = useTabStore.getState().openTab({ kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab({ kind: 'page', title: 'B' });
    useTabStore.getState().reorderTab(b.id, 99);
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([a.id, b.id]);
    useTabStore.getState().reorderTab(a.id, -5);
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([a.id, b.id]);
    const before = useTabStore.getState().tabs;
    useTabStore.getState().reorderTab('missing-id', 0);
    expect(useTabStore.getState().tabs).toBe(before);
    useTabStore.getState().reorderTab(a.id, 0);
    expect(useTabStore.getState().tabs).toBe(before);
  });

  it('reorderTab：保持激活态不变', () => {
    useTabStore.getState().openTab({ kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab({ kind: 'page', title: 'B' });
    useTabStore.getState().openTab({ kind: 'page', title: 'C' });
    useTabStore.getState().setActiveTab(b.id);
    useTabStore.getState().reorderTab(b.id, 0);
    expect(useTabStore.getState().activeTabId).toBe(b.id);
  });

  it('activateAdjacentTab：正反向循环切换并在末尾回绕', () => {
    const a = useTabStore.getState().openTab({ kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab({ kind: 'page', title: 'B' });
    const c = useTabStore.getState().openTab({ kind: 'page', title: 'C' }); // active

    useTabStore.getState().activateAdjacentTab(1); // c -> a（回绕）
    expect(useTabStore.getState().activeTabId).toBe(a.id);
    useTabStore.getState().activateAdjacentTab(-1); // a -> c（反向回绕）
    expect(useTabStore.getState().activeTabId).toBe(c.id);
    useTabStore.getState().activateAdjacentTab(-1); // c -> b
    expect(useTabStore.getState().activeTabId).toBe(b.id);
  });

  it('activateAdjacentTab：空栈或无激活 tab 时 no-op', () => {
    expect(() => useTabStore.getState().activateAdjacentTab(1)).not.toThrow();
    const a = useTabStore.getState().openTab({ kind: 'page', title: 'A' });
    useTabStore.setState({ activeTabId: null });
    expect(() => useTabStore.getState().activateAdjacentTab(-1)).not.toThrow();
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([a.id]);
  });

  it('tabIdentity：page/docx 用 pagePath，其余用 kind 前缀', () => {
    const page = useTabStore.getState().openPageTab('notes/a.md');
    const docx = useTabStore.getState().openDocxTab('docs/b.docx');
    const graph = useTabStore.getState().openTab({ kind: 'graph', title: '知识图谱' });
    expect(tabIdentity(page)).toBe('notes/a.md');
    expect(tabIdentity(docx)).toBe('docs/b.docx');
    expect(tabIdentity(graph)).toBe('kind:graph');
  });

  it('applyTabOrder：按持久化身份序列重排，未知身份与新 tab 保持相对顺序在后', () => {
    const a = useTabStore.getState().openPageTab('a.md');
    const b = useTabStore.getState().openTab({ kind: 'graph', title: '知识图谱' });
    const c = useTabStore.getState().openPageTab('c.md');
    useTabStore.getState().applyTabOrder(['kind:graph', 'c.md', 'a.md']);
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([b.id, c.id, a.id]);
    // 未知身份（新 tab）排在已知身份之后，组内保持现有相对顺序
    const d = useTabStore.getState().openPageTab('d.md');
    useTabStore.getState().applyTabOrder(['a.md', 'd.md']);
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([a.id, d.id, b.id, c.id]);
  });
});
