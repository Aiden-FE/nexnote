import { create } from 'zustand';
import type { DirEntry, FsChangeEvent } from '@nexnote/shared';
import { invoke, onEvent } from '../lib/ipc';
import { applyFsChangeEvent } from '../page-tree/tree-utils';
import { useTagStore } from './tag-store';

/**
 * 页面树数据 store（DEV-003）：
 * - 初始全量 fs:listTree；此后 chokidar 的 fs:changed 事件增量更新（实时同步外部变化）
 * - 扁平 entries 保留全部文件（含非 .md），showAllFiles 过滤在视图层做（切换即时生效）
 * - 搜索词 / 标签过滤驱动视图层 filterTree
 * - vault 关闭时 reset（App 切回向导）
 */
interface PageTreeState {
  entries: DirEntry[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  query: string;
  tagFilter: string | null;
  tagFiles: string[] | null;
  selectedPath: string | null;
  load(): Promise<void>;
  applyEvent(event: FsChangeEvent): void;
  setQuery(query: string): void;
  /** 设置标签过滤；tag=null 清除。files 为该标签的页面集合。 */
  setTagFilter(tag: string | null, files: string[] | null): void;
  setSelected(path: string | null): void;
  reset(): void;
}

/** 变更事件防抖重扫标签的延迟：写文件（含全库 wikilink 重写）会连发多个事件。 */
const TAG_RESCAN_DEBOUNCE_MS = 600;

let tagRescanTimer: ReturnType<typeof setTimeout> | null = null;

export const usePageTreeStore = create<PageTreeState>((set, get) => ({
  entries: [],
  status: 'idle',
  error: null,
  query: '',
  tagFilter: null,
  tagFiles: null,
  selectedPath: null,

  async load() {
    set({ status: 'loading', error: null });
    try {
      // 始终拉全量（含非 .md）；显示过滤在视图层。主进程已排除 .nexnote/.git/.trash
      const entries = await invoke('fs:listTree', { showAllFiles: true });
      set({ entries, status: 'ready' });
      void useTagStore.getState().load();
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  applyEvent(event) {
    set((s) => ({ entries: applyFsChangeEvent(s.entries, event) }));
    // 目录删除时若选中的文件在其子树下，清掉选中态
    const sel = get().selectedPath;
    if (
      sel &&
      (event.kind === 'unlink' || event.kind === 'unlinkDir') &&
      (sel === event.path || sel.startsWith(`${event.path}/`))
    ) {
      set({ selectedPath: null });
    }
    // 内容/结构变化都可能影响标签聚合：防抖重扫
    if (tagRescanTimer) clearTimeout(tagRescanTimer);
    tagRescanTimer = setTimeout(() => {
      tagRescanTimer = null;
      void useTagStore.getState().load();
    }, TAG_RESCAN_DEBOUNCE_MS);
  },

  setQuery(query) {
    set({ query });
  },

  setTagFilter(tag, files) {
    set({ tagFilter: tag, tagFiles: files });
  },

  setSelected(path) {
    set({ selectedPath: path });
  },

  reset() {
    set({
      entries: [],
      status: 'idle',
      error: null,
      query: '',
      tagFilter: null,
      tagFiles: null,
      selectedPath: null,
    });
    useTagStore.getState().reset();
  },
}));

let fsEventsBound = false;

/**
 * 工作区级订阅：vault 就绪后把 fs:changed 分发给页面树与标签 store。
 * 幂等（进程内只绑定一次）；vault 关闭由 App 卸载工作区时 reset 数据。
 */
export function bindVaultFsEvents(): void {
  if (fsEventsBound) return;
  fsEventsBound = true;
  onEvent('fs:changed', (event) => {
    usePageTreeStore.getState().applyEvent(event);
  });
  onEvent('vault:changed', ({ vault }) => {
    if (vault === null) usePageTreeStore.getState().reset();
  });
}
