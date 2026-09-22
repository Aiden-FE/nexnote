import { describe, it, expect, beforeEach } from 'vitest';
import { useTabStore, isBinaryKind, BINARY_TAB_KINDS } from '../src/stores/tab-store';

/** DEV-074（ADR-0015 spike 4）：二进制 tab 并发上限 + LRU 关闭最早。 */
describe('binary tab 并发上限（LRU）', () => {
  beforeEach(() => {
    // 每个用例重置 store（welcome tab 保留）。
    const state = useTabStore.getState();
    for (const tab of [...state.tabs]) {
      if (tab.kind !== 'welcome') state.closeTab(tab.id);
    }
  });

  it('默认上限 3：打开第 4 个二进制 tab 时关闭最早的一个', () => {
    const store = useTabStore.getState();
    store.openBinaryTab('a.docx', 'a', 'docx', 3);
    store.openBinaryTab('b.xlsx', 'b', 'xlsx', 3);
    store.openBinaryTab('c.xmind', 'c', 'mindmap', 3);
    let tabs = useTabStore
      .getState()
      .tabs.filter((t) => t.kind !== 'welcome');
    expect(tabs.map((t) => t.pagePath)).toEqual(['a.docx', 'b.xlsx', 'c.xmind']);

    store.openBinaryTab('d.docx', 'd', 'docx', 3);
    tabs = useTabStore.getState().tabs.filter((t) => t.kind !== 'welcome');
    // 最早的 a.docx 被 LRU 关闭。
    expect(tabs.map((t) => t.pagePath)).toEqual(['b.xlsx', 'c.xmind', 'd.docx']);
  });

  it('同路径 tab 复用，不触发关闭', () => {
    const store = useTabStore.getState();
    store.openBinaryTab('a.docx', 'a', 'docx', 3);
    store.openBinaryTab('b.xlsx', 'b', 'xlsx', 3);
    store.openBinaryTab('c.xmind', 'c', 'mindmap', 3);
    const before = useTabStore.getState().tabs.length;
    store.openBinaryTab('a.docx', 'a', 'docx', 3);
    const after = useTabStore.getState().tabs.length;
    expect(after).toBe(before);
  });

  it('设置内放宽上限：6 个并发可共存', () => {
    const store = useTabStore.getState();
    for (let i = 0; i < 6; i += 1) {
      store.openBinaryTab(`f${i}.docx`, `f${i}`, 'docx', 6);
    }
    const binaryCount = useTabStore.getState().tabs.filter((t) => isBinaryKind(t.kind)).length;
    expect(binaryCount).toBe(6);
  });

  it('非二进制 tab（page）不计入并发上限', () => {
    const store = useTabStore.getState();
    store.openBinaryTab('a.docx', 'a', 'docx', 3);
    store.openBinaryTab('b.xlsx', 'b', 'xlsx', 3);
    store.openBinaryTab('c.xmind', 'c', 'mindmap', 3);
    store.openPageTab('note.md', 'note');
    const pageTabs = useTabStore.getState().tabs.filter((t) => t.kind === 'page');
    expect(pageTabs.length).toBe(1);
  });

  it('BINARY_TAB_KINDS 覆盖 docx/xlsx/mindmap', () => {
    expect([...BINARY_TAB_KINDS].sort()).toEqual(['docx', 'mindmap', 'xlsx']);
  });
});
