import { create } from 'zustand';
import type { Backlink, GraphSnapshot, IndexStatus, SearchHit, TagIndexEntry } from '@nexnote/shared';
import { invoke, onEvent } from '../lib/ipc';

/**
 * 关系索引 store（DEV-004）：
 * - 状态：index:statusChanged 推送 + 主动拉取
 * - 反向链接：当前页面变化时加载（tab-store 的 activePagePath 驱动）
 * - 搜索/标签：按需调用
 */
interface IndexState {
  status: IndexStatus;
  /** 当前页面的反向链接 */
  backlinks: Backlink[];
  backlinksFor: string | null;
  backlinksStatus: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** 索引驱动的标签列表 */
  tags: TagIndexEntry[];
  tagsStatus: 'idle' | 'loading' | 'ready' | 'error';
  graph: GraphSnapshot;
  graphStatus: 'idle' | 'loading' | 'ready' | 'stale' | 'error';
  loadStatus(): Promise<void>;
  loadBacklinks(pagePath: string): Promise<void>;
  clearBacklinks(): void;
  loadTags(): Promise<void>;
  loadGraph(): Promise<void>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  rebuild(): Promise<void>;
  applyStatusEvent(status: IndexStatus): void;
  reset(): void;
}

let eventsBound = false;
let tagLoadGeneration = 0;
let backlinkGeneration = 0;
let graphLoadGeneration = 0;

/** 进程内绑定一次 index:statusChanged 推送。 */
export function bindIndexEvents(): void {
  if (eventsBound) return;
  eventsBound = true;
  onEvent('vault:changed', () => {
    // The same page path can exist in another vault; invalidate all pending responses.
    useIndexStore.getState().reset();
  });
  onEvent('index:statusChanged', (status) => {
    useIndexStore.getState().applyStatusEvent(status);
    // ready 事件意味着反链/标签可能已更新
    if (status.phase === 'ready') {
      const store = useIndexStore.getState();
      if (store.backlinksFor) void store.loadBacklinks(store.backlinksFor);
      void store.loadTags();
      if (store.graphStatus === 'ready') useIndexStore.setState({ graphStatus: 'stale' });
    }
  });
}

export const useIndexStore = create<IndexState>((set, get) => ({
  status: { phase: 'idle', pagesTotal: 0, pagesIndexed: 0, mode: 'full' },
  backlinks: [],
  backlinksFor: null,
  backlinksStatus: 'idle',
  error: null,
  tags: [],
  tagsStatus: 'idle',
  graph: { pages: [], links: [] },
  graphStatus: 'idle',

  async loadStatus() {
    try {
      const status = await invoke('index:status');
      set({ status });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async loadBacklinks(pagePath) {
    const generation = ++backlinkGeneration;
    set({ backlinksStatus: 'loading', backlinksFor: pagePath });
    try {
      const backlinks = await invoke('index:backlinks', { pagePath });
      if (generation !== backlinkGeneration || get().backlinksFor !== pagePath) return;
      set({ backlinks, backlinksStatus: 'ready' });
    } catch (e) {
      if (generation !== backlinkGeneration || get().backlinksFor !== pagePath) return;
      set({ backlinksStatus: 'error', error: e instanceof Error ? e.message : String(e), backlinks: [] });
    }
  },

  clearBacklinks() {
    backlinkGeneration += 1;
    set({ backlinks: [], backlinksFor: null, backlinksStatus: 'idle' });
  },

  async loadTags() {
    const generation = ++tagLoadGeneration;
    set({ tagsStatus: 'loading' });
    try {
      const tags = await invoke('index:tags', { flat: false });
      if (generation !== tagLoadGeneration) return;
      set({ tags, tagsStatus: 'ready' });
    } catch (e) {
      if (generation !== tagLoadGeneration) return;
      // Clear stale index data so TagsPanel reliably falls back to the vault scanner.
      set({ tags: [], tagsStatus: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  async search(query, limit = 50) {
    if (!query.trim()) return [];
    return invoke('index:search', { query, limit });
  },

  async loadGraph() {
    const generation = ++graphLoadGeneration;
    set({ graphStatus: 'loading' });
    try {
      const graph = await invoke('index:graph');
      if (generation !== graphLoadGeneration) return;
      set({ graph, graphStatus: 'ready' });
    } catch (e) {
      if (generation !== graphLoadGeneration) return;
      set({
        graph: { pages: [], links: [] },
        graphStatus: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  async rebuild() {
    await invoke('index:rebuild');
    await get().loadStatus();
  },

  applyStatusEvent(status) {
    set({ status });
  },

  reset() {
    tagLoadGeneration += 1;
    backlinkGeneration += 1;
    set({
      status: { phase: 'idle', pagesTotal: 0, pagesIndexed: 0, mode: 'full' },
      backlinks: [],
      backlinksFor: null,
      backlinksStatus: 'idle',
      error: null,
      tags: [],
      tagsStatus: 'idle',
      graph: { pages: [], links: [] },
      graphStatus: 'idle',
    });
  },
}));
