import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/ipc', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { useTabStore } from '../src/stores/tab-store';

function resetStore(): void {
  useTabStore.setState({ tabs: [], activeTabId: null });
}

describe('DEV-097 · 未编辑空白文档关闭时清理', () => {
  beforeEach(() => {
    resetStore();
    invokeMock.mockClear();
  });

  it('未编辑的自动创建页签关闭时调用 fs:delete', () => {
    const tab = useTabStore.getState().openTab({ kind: 'page', title: '未命名页面' });
    useTabStore.getState().closeTab(tab.id);
    expect(invokeMock).toHaveBeenCalledWith('fs:delete', {
      path: '未命名页面.md',
      toTrash: false,
    });
  });

  it('已编辑的页签关闭时不删除文件', () => {
    const tab = useTabStore.getState().openTab({ kind: 'page', title: '未命名页面' });
    useTabStore.getState().setTabDirty(tab.id, true);
    useTabStore.getState().closeTab(tab.id);
    expect(invokeMock).not.toHaveBeenCalledWith('fs:delete', expect.anything());
  });

  it('有 pagePath 的页签关闭时不删除文件', () => {
    const tab = useTabStore.getState().openPageTab('existing.md', 'Existing');
    useTabStore.getState().closeTab(tab.id);
    expect(invokeMock).not.toHaveBeenCalledWith('fs:delete', expect.anything());
  });

  it('同名路径仍被其他 tab 引用时不删除', () => {
    const tab1 = useTabStore.getState().openTab({ kind: 'page', title: '未命名页面' });
    useTabStore.getState().openTab({ kind: 'page', title: '未命名页面' });
    useTabStore.getState().closeTab(tab1.id);
    expect(invokeMock).not.toHaveBeenCalledWith('fs:delete', expect.anything());
  });

  it('closeOtherTabs 也触发清理', () => {
    const kept = useTabStore.getState().openTab({ kind: 'page', title: '保留' });
    useTabStore.getState().openTab({ kind: 'page', title: '未命名页面' });
    useTabStore.getState().closeOtherTabs(kept.id);
    expect(invokeMock).toHaveBeenCalledWith('fs:delete', {
      path: '未命名页面.md',
      toTrash: false,
    });
  });

  it('closeTabsToRight 也触发清理', () => {
    const kept = useTabStore.getState().openTab({ kind: 'page', title: '保留' });
    useTabStore.getState().openTab({ kind: 'page', title: '未命名页面' });
    useTabStore.getState().closeTabsToRight(kept.id);
    expect(invokeMock).toHaveBeenCalledWith('fs:delete', {
      path: '未命名页面.md',
      toTrash: false,
    });
  });

  it('非 page 类型 tab 关闭不触发清理', () => {
    const tab = useTabStore.getState().openTab({ kind: 'welcome', title: '欢迎' });
    useTabStore.getState().closeTab(tab.id);
    expect(invokeMock).not.toHaveBeenCalledWith('fs:delete', expect.anything());
  });
});
