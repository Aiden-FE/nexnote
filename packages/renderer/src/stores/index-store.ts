import { create } from 'zustand';
import type { Backlink, IndexStatus, SearchHit, TagIndexEntry } from '@nexnote/shared';
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
  loadStatus(): Promise<void>;
  loadBacklinks(pagePath: string): Promise<void>;
  clearBacklinks(): void;
  loadTags(): Promise<void>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  rebuild(): Promise<void>;
  applyStatusEvent(status: IndexStatus): void;
  reset(): void;
}

let eventsBound = false;
let tagLoadGeneration = 0;

/** 进程内绑定一次 index:statusChanged 推送。 */
export function bindIndexEvents(): void {
  if (eventsBound) return;
  eventsBound = true;
  onEvent('index:statusChanged', (status) => {
    useIndexStore.getState().applyStatusEvent(status);
    // ready 事件意味着反链/标签可能已更新
    if (status.phase === 'ready') {
      const store = useIndexStore.getState();
      if (store.backlinksFor) void store.loadBacklinks(store.backlinksFor);
      void store.loadTags();
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

  async loadStatus() {
    try {
      const status = await invoke('index:status');
      set({ status });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async loadBacklinks(pagePath) {
    set({ backlinksStatus: 'loading', backlinksFor: pagePath });
    try {
      const backlinks = await invoke('index:backlinks', { pagePath });
      if (get().backlinksFor !== pagePath) return; // 已切换页面：丢弃过期结果
      set({ backlinks, backlinksStatus: 'ready' });
    } catch (e) {
      if (get().backlinksFor !== pagePath) return;
      set({ backlinksStatus: 'error', error: e instanceof Error ? e.message : String(e), backlinks: [] });
    }
  },

  clearBacklinks() {
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

  async rebuild() {
    await invoke('index:rebuild');
    await get().loadStatus();
  },

  applyStatusEvent(status) {
    set({ status });
  },

  reset() {
    tagLoadGeneration += 1;
    set({
      status: { phase: 'idle', pagesTotal: 0, pagesIndexed: 0, mode: 'full' },
      backlinks: [],
      backlinksFor: null,
      backlinksStatus: 'idle',
      error: null,
      tags: [],
      tagsStatus: 'idle',
    });
  },
}));
