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
// DEV-074：docx/xlsx/xmind 统一经 openBinary（含并发上限参数）。
const openBinaryMock = vi.fn((pagePath: string, kind: string, maxConcurrent?: number) => {
  const tab = { id: `t${tabState.tabs.length + 1}`, kind, pagePath };
  tabState.tabs.push(tab);
  tabState.activeTabId = tab.id;
  void maxConcurrent;
  return tab;
});

vi.mock('../src/stores/tab-store', () => ({
  openPage: openPageMock,
  openBinary: openBinaryMock,
  getTabStore: () => ({ getState: () => tabState }),
}));

vi.mock('../src/stores/settings-store', () => ({
  useSettingsStore: { getState: () => ({ vault: { binary: { maxConcurrentTabs: 3 } } }) },
}));

describe('openDocumentTab 统一打开入口', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openPageMock.mockClear();
    openBinaryMock.mockClear();
    tabState.tabs = [];
    tabState.activeTabId = null;
    tabState.toggleSourceMode.mockClear();
    tabState.updateTab.mockClear();
  });

  it('.docx 打开可编辑 tab（并发上限来自 vault 设置），不查询 markdown 元数据', async () => {
    const { openDocumentTab } = await import('../src/lib/open-document');
    const result = await openDocumentTab('reports/a.docx');
    expect(result.kind).toBe('docx');
    expect(openBinaryMock).toHaveBeenCalledWith('reports/a.docx', 'docx', 3);
    expect(openPageMock).not.toHaveBeenCalled();
  });

  it('.xlsx → xlsx tab；.xmind → mindmap tab（DEV-074）', async () => {
    const { openDocumentTab } = await import('../src/lib/open-document');
    expect((await openDocumentTab('sheets/b.xlsx')).kind).toBe('xlsx');
    expect(openBinaryMock).toHaveBeenCalledWith('sheets/b.xlsx', 'xlsx', 3);
    expect((await openDocumentTab('maps/c.xmind')).kind).toBe('mindmap');
    expect(openBinaryMock).toHaveBeenCalledWith('maps/c.xmind', 'mindmap', 3);
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
