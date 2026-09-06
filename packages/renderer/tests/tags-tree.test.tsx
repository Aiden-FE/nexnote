import { describe, expect, it } from 'vitest';
// @vitest-environment happy-dom
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { useIndexStore } from '../src/stores/index-store';
import { usePageTreeStore } from '../src/stores/page-tree-store';
import { useUiStore } from '../src/stores/ui-store';
import type { TagIndexEntry } from '@nexnote/shared';
import { TagsPanel } from '../src/features/sidebar/tags/index';
import { buildTagTree } from '../src/features/sidebar/tags/tree';

function flush(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }

function installMockEntries(entries: TagIndexEntry[]): void {
  useIndexStore.setState({
    status: { phase: 'ready', pagesTotal: 0, pagesIndexed: 0, mode: 'full' },
    tags: entries,
    tagsStatus: 'ready',
    error: null,
    backlinks: [],
    backlinksFor: null,
    backlinksStatus: 'idle',
  });
}

describe('buildTagTree', () => {
  it('构建 / 分层嵌套树，叶/中间分明，descPageCount 聚合', () => {
    const entries: TagIndexEntry[] = [
      { tag: 'work', pageCount: 1, descendantPageCount: 3, path: ['work'] },
      { tag: 'work/project', pageCount: 1, descendantPageCount: 1, path: ['work', 'project'] },
      { tag: 'work/notes', pageCount: 1, descendantPageCount: 2, path: ['work', 'notes'] },
      { tag: 'work/notes/daily', pageCount: 2, descendantPageCount: 2, path: ['work', 'notes', 'daily'] },
      { tag: 'archive', pageCount: 1, descendantPageCount: 1, path: ['archive'] },
    ];
    const tree = buildTagTree(entries);
    expect(tree.map((n) => n.fullPath)).toEqual(['archive', 'work']);
    const work = tree.find((n) => n.fullPath === 'work')!;
    expect(work.isLeaf).toBe(false);
    expect(work.descPageCount).toBe(3);
    expect(work.children.map((c) => c.fullPath)).toEqual(['work/notes', 'work/project']);
    const notes = work.children.find((c) => c.fullPath === 'work/notes')!;
    expect(notes.children.map((c) => c.fullPath)).toEqual(['work/notes/daily']);
    const daily = notes.children[0]!;
    expect(daily.isLeaf).toBe(true);
    expect(daily.descPageCount).toBe(2);
  });
});

describe('TagsPanel（嵌套树）', () => {
  it('渲染中间节点分支 + 三角 + 计数；点击中间节点按子树过滤', async () => {
    const entries: TagIndexEntry[] = [
      { tag: 'work', pageCount: 1, descendantPageCount: 2, path: ['work'] },
      { tag: 'work/project', pageCount: 1, descendantPageCount: 1, path: ['work', 'project'] },
      { tag: 'work/notes', pageCount: 1, descendantPageCount: 1, path: ['work', 'notes'] },
      { tag: 'archive', pageCount: 1, descendantPageCount: 1, path: ['archive'] },
    ];
    installMockEntries(entries);

    // stub window.nexnote bridge：index:tagPages 走假数据
    (window as unknown as { nexnote?: { invoke: (ch: string, payload: unknown) => Promise<{ ok: true; data: unknown }> } }).nexnote = {
      invoke: async (channel, payload) => {
        if (channel === 'index:tags') return { ok: true, data: entries };
        if (channel === 'index:tagPages') {
          const tag = (payload as { tag: string }).tag;
          let data: string[] = [];
          if (tag === 'work') data = ['a.md', 'b.md', 'c.md'];
          else if (tag === 'work/project') data = ['a.md'];
          else if (tag === 'work/notes') data = ['b.md'];
          return { ok: true, data };
        }
        return { ok: true, data: null };
      },
    };
    try {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<TagsPanel />);
        await flush();
      });

      // 中间节点必须显示分支三角
      const expands = container.querySelectorAll('[data-testid="tag-expand"]');
      expect(expands.length).toBe(1); // 只有 'work' 是中间节点
      const workExpand = expands[0] as HTMLElement;
      expect(workExpand.getAttribute('data-tag')).toBe('work');
      expect(workExpand.getAttribute('data-open')).toBe('false');

      // 默认折叠，'work/project' / 'work/notes' 不可见
      expect(container.querySelectorAll('[data-tag="work/project"]').length).toBe(0);
      expect(container.querySelectorAll('[data-tag="work/notes"]').length).toBe(0);

      // 展开
      await act(async () => { workExpand.click(); await flush(); });
      const expands2 = container.querySelectorAll('[data-testid="tag-expand"]');
      const workExpand2 = expands2[0] as HTMLElement;
      expect(workExpand2.getAttribute('data-open')).toBe('true');
      expect(container.querySelectorAll('[data-tag="work/project"]').length).toBe(1);
      expect(container.querySelectorAll('[data-tag="work/notes"]').length).toBe(1);

      // 计数：work 节点显示 descPageCount=2（去重 a,b 所属子标签）
      const workNode = container.querySelector('[data-tag="work"][data-testid="tag-node"]')!;
      const workCount = workNode.querySelector('[data-testid="tag-count"]')!;
      expect(workCount.textContent).toBe('2');

      // 点击 work 中间节点 → 过滤页面树
      await act(async () => {
        (workNode as HTMLElement).click();
        await flush();
      });
      const filter = usePageTreeStore.getState().tagFilter;
      expect(filter).toBe('work');
      expect(usePageTreeStore.getState().tagFiles).toEqual(['a.md', 'b.md', 'c.md']);
      expect(useUiStore.getState().searchOpen).toBe(true);
      expect(useUiStore.getState().searchRoute).toEqual({ kind: 'tag', tag: 'work', paths: ['a.md', 'b.md', 'c.md'] });

      // 再次点击取消过滤
      await act(async () => {
        (workNode as HTMLElement).click();
        await flush();
      });
      expect(usePageTreeStore.getState().tagFilter).toBeNull();

      await act(async () => { root.unmount(); });
    } finally {
      delete (window as unknown as { nexnote?: unknown }).nexnote;
      usePageTreeStore.getState().setTagFilter(null, null);
    }
  });
});
