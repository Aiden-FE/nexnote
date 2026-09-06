import { create } from 'zustand';
import type { TagStat } from '@nexnote/shared';
import { invoke } from '../lib/ipc';

/**
 * 标签聚合 store（DEV-003 基础版）：fs:scanTags 全库扫描，
 * 点击标签 → 通过 page-tree store 的 setTagFilter 过滤页面树。
 * DEV-004 关系索引完成后切换数据源。
 */
interface TagState {
  stats: TagStat[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  load(): Promise<void>;
  reset(): void;
}

export const useTagStore = create<TagState>((set) => ({
  stats: [],
  status: 'idle',
  error: null,

  async load() {
    set({ status: 'loading', error: null });
    try {
      const stats = await invoke('fs:scanTags');
      set({ stats, status: 'ready' });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  reset() {
    set({ stats: [], status: 'idle', error: null });
  },
}));
