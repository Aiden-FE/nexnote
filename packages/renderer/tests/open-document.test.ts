import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('../src/lib/ipc', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const tabState = {
  tabs: [] as Array<{ id: string; kind: string; pagePath?: string; editorMode?: string }>,
  activeTabId: null as string | null,
  toggleSourceMode: vi.fn(),
  updateTab: vi.fn((id: string, patch: Record<string, unknown>) => {
    const tab = tabState.tabs.find((candidate) => candidate.id === id);
    if (tab) Object.assign(tab, patch);
  }),
};
const openPageMock = vi.fn((pagePath: string) => {
  const tab = { id: `t${tabState.tabs.length + 1}`, kind: 'page', pagePath };
  tabState.tabs.push(tab);
  tabState.activeTabId = tab.id;
  return tab;
});
const openDocxMock = vi.fn((pagePath: string) => {
  const tab = { id: `t${tabState.tabs.length + 1}`, kind: 'docx', pagePath };
  tabState.tabs.push(tab);
  tabState.activeTabId = tab.id;
  return tab;
});

vi.mock('../src/stores/tab-store', () => ({
  openPage: openPageMock,
  openDocx: openDocxMock,
  getTabStore: () => ({ getState: () => tabState }),
}));

describe('openDocumentTab 统一打开入口', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openPageMock.mockClear();
    openDocxMock.mockClear();
    tabState.tabs = [];
    tabState.activeTabId = null;
    tabState.toggleSourceMode.mockClear();
    tabState.updateTab.mockClear();
  });

  it('.docx 打开只读预览 tab，不查询 markdown 元数据', async () => {
    const { openDocumentTab } = await import('../src/lib/open-document');
    const result = await openDocumentTab('reports/a.docx');
    expect(result.kind).toBe('docx');
    expect(openDocxMock).toHaveBeenCalledWith('reports/a.docx', undefined);
    expect(openPageMock).not.toHaveBeenCalled();
  });

  it('sidecar format=markdown 的 .md 打开即源码模式（重开也保持）', async () => {
    invokeMock.mockResolvedValue({ format: 'markdown' });
    const { openDocumentTab } = await import('../src/lib/open-document');
    const result = await openDocumentTab('notes/a.md', '标题');
    expect(invokeMock).toHaveBeenCalledWith('document:getMetadata', { path: 'notes/a.md' });
    expect(result).toEqual({ kind: 'page', format: 'markdown' });
    expect(openPageMock).toHaveBeenCalledWith('notes/a.md', '标题');
    expect(tabState.updateTab).toHaveBeenCalledWith('t1', {
      format: 'markdown',
      editorMode: 'source',
      markdownView: 'split',
      splitRatio: 0.5,
    });
  });

  it('无 sidecar 或 native-block 时保持块编辑模式', async () => {
    invokeMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ format: 'native-block' });
    const { openDocumentTab } = await import('../src/lib/open-document');
    expect(await openDocumentTab('notes/b.md')).toEqual({ kind: 'page', format: 'native-block' });
    expect(await openDocumentTab('notes/c.md')).toEqual({ kind: 'page', format: 'native-block' });
    expect(tabState.updateTab).toHaveBeenCalledTimes(2);
  });
});
