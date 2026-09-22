import { create } from 'zustand';
import {
  bindH1ToTitle,
  firstH1,
  pagePathForTitle,
  sanitizePageTitle,
  titleFromPath,
} from '../editor/title-sync';

export type TabKind = 'welcome' | 'page' | 'docx' | 'xlsx' | 'mindmap' | 'graph' | 'settings';
export type EditorMode = 'block' | 'source';
export type DocumentFormat = 'native-block' | 'markdown';
export type MarkdownView = 'source' | 'split' | 'preview';
export type MarkdownEditView = Exclude<MarkdownView, 'preview'>;

export interface TabDescriptor {
  id: string;
  kind: TabKind;
  title: string;
  /** 页面 tab 的 vault 相对 Markdown 路径；welcome 无此字段。 */
  pagePath?: string;
  /** 仅存在于当前 tab 生命周期；关闭 tab 后不会持久化。 */
  editorMode?: EditorMode;
  /**
   * 页面 tab 的持久文档格式（来自 sidecar metadata）：
   * - markdown：永远不进入块编辑（不挂 TipTap），由 SourceModeView 承载（编辑 + 可隐藏预览）；
   * - native-block / 缺省（legacy 无 sidecar）：块编辑，且不提供源码模式入口。
   */
  format?: DocumentFormat;
  /** Markdown 文件的 tab 临时视图；不写入 vault，关闭 tab 后丢弃。 */
  markdownView?: MarkdownView;
  /** @deprecated 仅兼容旧调用；请使用 markdownView。 */
  previewVisible?: boolean;
  /** Markdown 分栏视图的左侧比例；仅当前 tab 生命周期有效。 */
  splitRatio?: number;
  /** 进入预览前最近一次编辑视图，用于 Mod+Shift+E 返回。 */
  lastMarkdownEditView?: MarkdownEditView;
  createdAt: number;
}

export interface WorkspaceState {
  tabs: TabDescriptor[];
  activeTabId: string | null;
  openTab(tab: { kind: TabKind; title: string; pagePath?: string }): TabDescriptor;
  openPageTab(pagePath: string, title?: string): TabDescriptor;
  openDocxTab(pagePath: string, title?: string): TabDescriptor;
  /** 二进制 tab（DEV-074）：并发上限 maxConcurrent（默认 3），超出按 LRU 关闭最早 tab。 */
  openBinaryTab(
    pagePath: string,
    title: string | undefined,
    kind: 'docx' | 'xlsx' | 'mindmap',
    maxConcurrent?: number,
  ): TabDescriptor;
  updateTab(
    tabId: string,
    patch: {
      title?: string;
      pagePath?: string;
      editorMode?: EditorMode;
      format?: DocumentFormat;
      markdownView?: MarkdownView;
      splitRatio?: number;
      lastMarkdownEditView?: MarkdownEditView;
    },
  ): void;
  closeTab(tabId: string): void;
  closeOtherTabs(tabId: string): void;
  closeTabsToRight(tabId: string): void;
  setActiveTab(tabId: string): void;
  setTabTitle(tabId: string, title: string): void;
  /** 拖拽排序（DEV-022）：按 id 把 tab 移动到目标下标（越界夹取，原位 no-op）。 */
  reorderTab(tabId: string, targetIndex: number): void;
  /** Ctrl+Tab / Ctrl+Shift+Tab（DEV-022）：以激活 tab 为基准循环移动 offset 步（末尾回绕）。 */
  activateAdjacentTab(offset: 1 | -1): void;
  /** vault 布局恢复（DEV-022）：按持久化身份序列重排现有 tabs（未知身份保持相对顺序在后）。 */
  applyTabOrder(order: string[]): void;
  toggleSourceMode(tabId: string, enabled?: boolean): void;
  /** 设置 Markdown 临时视图；进入 preview 前记录最近一次编辑视图。 */
  setMarkdownView(tabId: string, view: MarkdownView): void;
  /** Mod+E：Markdown 在源码与分栏之间切换；native-block 维持原有语义。 */
  toggleMarkdownEditView(tabId: string): void;
  /** Mod+Shift+E：预览与最近一次编辑视图之间切换。 */
  toggleMarkdownPreview(tabId: string): void;
  /** 分栏左侧比例（0.2–0.8），仅当前 tab 生命周期有效。 */
  setSplitRatio(tabId: string, ratio: number): void;
  /** 兼容旧 smoke/插件调用：boolean 映射为 source/split。 */
  togglePreview(tabId: string, visible?: boolean): void;
  retargetTabs(fromPath: string, toPath: string, title: string): void;
  closeTabsForPath(removedPath: string): void;
}

/** DEV-074：二进制文档 tab 类型（docx/xlsx/mindmap），共享 WebContentsView 进程与并发上限。 */
export const BINARY_TAB_KINDS = ['docx', 'xlsx', 'mindmap'] as const;
export function isBinaryKind(kind: TabKind): kind is (typeof BINARY_TAB_KINDS)[number] {
  return (BINARY_TAB_KINDS as readonly string[]).includes(kind);
}

let tabSeq = 0;
function nextTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now().toString(36)}-${tabSeq}`;
}

/**
 * tab 的持久化身份（DEV-022 tabOrder）：page/docx 用 pagePath（跨会话稳定）；
 * 其余单例 kind 用 `kind:<kind>`。tab.id 每次会话生成，不可用于持久化。
 */
export function tabIdentity(tab: Pick<TabDescriptor, 'kind' | 'pagePath'>): string {
  return tab.pagePath ?? `kind:${tab.kind}`;
}

function initialTabs(): { tabs: TabDescriptor[]; activeTabId: string } {
  const welcome: TabDescriptor = {
    id: nextTabId(),
    kind: 'welcome',
    title: '欢迎',
    createdAt: Date.now(),
  };
  return { tabs: [welcome], activeTabId: welcome.id };
}

const initial = initialTabs();

export const useTabStore = create<WorkspaceState>()((set, get) => ({
  ...initial,

  openTab({ kind, title, pagePath }) {
    const tab: TabDescriptor = { id: nextTabId(), kind, title, createdAt: Date.now(), pagePath };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
    return tab;
  },

  openPageTab(pagePath, title) {
    const existing = get().tabs.find((tab) => tab.kind === 'page' && tab.pagePath === pagePath);
    if (existing) {
      get().setActiveTab(existing.id);
      return existing;
    }
    const fallbackTitle =
      title ?? pagePath.slice(pagePath.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    return get().openTab({ kind: 'page', title: fallbackTitle, pagePath });
  },

  openDocxTab(pagePath, title) {
    const existing = get().tabs.find((tab) => tab.kind === 'docx' && tab.pagePath === pagePath);
    if (existing) {
      get().setActiveTab(existing.id);
      return existing;
    }
    const fallbackTitle = title ?? pagePath.slice(pagePath.lastIndexOf('/') + 1);
    return get().openTab({ kind: 'docx', title: fallbackTitle, pagePath });
  },

  /**
   * 二进制文档 tab（DEV-074，ADR-0015 spike 4）：编辑器运行在独立 WebContentsView，
   * 每文档一个进程，内存峰值显著。并发上限默认 3（可在设置内放宽），超出时按 LRU
   * 关闭最早的 tab 来打开新的——即「最近使用的保留，最久未使用的先关」。
   */
  openBinaryTab(pagePath, title, kind, maxConcurrent = 3) {
    const existing = get().tabs.find((tab) => tab.kind === kind && tab.pagePath === pagePath);
    if (existing) {
      get().setActiveTab(existing.id);
      return existing;
    }
    const fallbackTitle = title ?? pagePath.slice(pagePath.lastIndexOf('/') + 1);
    // 已打开的二进制 tab（docx/xlsx/mindmap 全部计入并发）。
    const binaryTabs = get().tabs.filter((tab) => isBinaryKind(tab.kind));
    if (binaryTabs.length >= Math.max(1, maxConcurrent)) {
      // LRU：createdAt 最早的 tab 视为最久未使用（tab 无独立 lastUsed 字段；打开即激活，
      // 因此按创建顺序近似 LRU）。关闭最早的来打开新的。
      const oldest = binaryTabs.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      get().closeTab(oldest.id);
    }
    return get().openTab({ kind, title: fallbackTitle, pagePath });
  },

  updateTab(tabId, patch) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
    }));
  },

  closeTab(tabId) {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== tabId);
      const activeTabId =
        state.activeTabId === tabId
          ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null)
          : state.activeTabId;
      return { tabs, activeTabId };
    });
  },

  closeOtherTabs(tabId) {
    set((state) => {
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      return tab ? { tabs: [tab], activeTabId: tabId } : state;
    });
  },

  closeTabsToRight(tabId) {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return state;
      const tabs = state.tabs.slice(0, index + 1);
      const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : tabId;
      return { tabs, activeTabId };
    });
  },

  setActiveTab(tabId) {
    set((state) => (state.tabs.some((tab) => tab.id === tabId) ? { activeTabId: tabId } : state));
  },

  setTabTitle(tabId, title) {
    get().updateTab(tabId, { title });
  },

  reorderTab(tabId, targetIndex) {
    set((state) => {
      const from = state.tabs.findIndex((tab) => tab.id === tabId);
      if (from < 0) return state;
      const to = Math.min(state.tabs.length - 1, Math.max(0, Math.trunc(targetIndex)));
      if (to === from) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      if (!moved) return state;
      tabs.splice(to, 0, moved);
      return { tabs };
    });
  },

  activateAdjacentTab(offset) {
    set((state) => {
      if (state.tabs.length === 0 || state.activeTabId === null) return state;
      const current = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      if (current < 0) return state;
      const next = (current + offset + state.tabs.length) % state.tabs.length;
      return { activeTabId: state.tabs[next]?.id ?? state.activeTabId };
    });
  },

  applyTabOrder(order) {
    set((state) => {
      if (order.length === 0) return state;
      const rank = new Map(order.map((identity, index) => [identity, index]));
      const tabs = [...state.tabs].sort((a, b) => {
        const ra = rank.get(tabIdentity(a));
        const rb = rank.get(tabIdentity(b));
        // 未知身份（新 tab / 持久化后新增）保持在已知身份之后，组内维持现有相对顺序。
        if (ra === undefined && rb === undefined) return 0;
        if (ra === undefined) return 1;
        if (rb === undefined) return -1;
        return ra - rb;
      });
      // Array.prototype.sort 稳定：仅在顺序真正变化时落新数组
      return tabs.every((tab, index) => tab === state.tabs[index]) ? state : { tabs };
    });
  },

  toggleSourceMode(tabId, enabled) {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== 'page') return tab;
        // Sidecar native-block 文档没有源码模式；legacy 无 sidecar 保持旧行为。
        if (tab.format === 'native-block') return { ...tab, editorMode: 'block' };
        const next = enabled ?? tab.editorMode !== 'source';
        return { ...tab, editorMode: next ? 'source' : 'block' };
      }),
    }));
  },

  setMarkdownView(tabId, view) {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== 'page' || tab.format !== 'markdown') return tab;
        if (view === 'preview') {
          const current = tab.markdownView === 'source' ? 'source' : 'split';
          return { ...tab, markdownView: 'preview', lastMarkdownEditView: current };
        }
        return { ...tab, markdownView: view, lastMarkdownEditView: view };
      }),
    }));
  },

  toggleMarkdownEditView(tabId) {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== 'page' || tab.format !== 'markdown') return tab;
        const current = tab.markdownView === 'source' ? 'split' : 'source';
        return { ...tab, markdownView: current, lastMarkdownEditView: current };
      }),
    }));
  },

  toggleMarkdownPreview(tabId) {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== 'page' || tab.format !== 'markdown') return tab;
        if (tab.markdownView === 'preview') {
          const next = tab.lastMarkdownEditView ?? 'split';
          return { ...tab, markdownView: next };
        }
        const current = tab.markdownView === 'source' ? 'source' : 'split';
        return { ...tab, markdownView: 'preview', lastMarkdownEditView: current };
      }),
    }));
  },

  setSplitRatio(tabId, ratio) {
    const next = Math.max(0.2, Math.min(0.8, ratio));
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.kind === 'page' && tab.format === 'markdown'
          ? { ...tab, splitRatio: next }
          : tab,
      ),
    }));
  },

  togglePreview(tabId, visible) {
    const state = get();
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.format !== 'markdown') return;
    state.setMarkdownView(tabId, visible === false ? 'source' : 'split');
  },

  retargetTabs(fromPath, toPath, title) {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.pagePath === fromPath ? { ...tab, pagePath: toPath, title } : tab,
      ),
    }));
  },

  closeTabsForPath(removedPath) {
    const hit = (path: string | undefined): boolean =>
      !!path && (path === removedPath || path.startsWith(`${removedPath}/`));
    set((state) => {
      const tabs = state.tabs.filter((tab) => !hit(tab.pagePath));
      if (tabs.length === state.tabs.length) return state;
      const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : (tabs.at(-1)?.id ?? null);
      return { tabs, activeTabId };
    });
  },
}));

export function openWorkspaceTab(kind: TabKind, title: string, pagePath?: string): TabDescriptor {
  return useTabStore.getState().openTab({ kind, title, pagePath });
}

export function openPage(pagePath: string, title?: string): TabDescriptor {
  return useTabStore.getState().openPageTab(pagePath, title);
}

export function openDocx(pagePath: string, title?: string): TabDescriptor {
  return useTabStore.getState().openDocxTab(pagePath, title);
}

/** DEV-074：二进制 tab 打开入口（含 LRU 并发上限；maxConcurrent 来自 vault 设置）。 */
export function openBinary(
  pagePath: string,
  kind: 'docx' | 'xlsx' | 'mindmap',
  maxConcurrent?: number,
): TabDescriptor {
  return useTabStore.getState().openBinaryTab(pagePath, undefined, kind, maxConcurrent);
}

export function getTabStore() {
  return useTabStore;
}

export { getTabStore as __getTabStoreForSmoke };
export { bindH1ToTitle, firstH1, pagePathForTitle, sanitizePageTitle, titleFromPath };
