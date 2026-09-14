import { create } from 'zustand';
import {
  bindH1ToTitle,
  firstH1,
  pagePathForTitle,
  sanitizePageTitle,
  titleFromPath,
} from '../editor/title-sync';

export type TabKind = 'welcome' | 'page' | 'docx' | 'graph' | 'settings';
export type EditorMode = 'block' | 'source';
export type DocumentFormat = 'native-block' | 'markdown';

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
  /** Markdown 源码编辑器的实时预览面板是否显示。 */
  previewVisible?: boolean;
  createdAt: number;
}

export interface WorkspaceState {
  tabs: TabDescriptor[];
  activeTabId: string | null;
  openTab(tab: { kind: TabKind; title: string; pagePath?: string }): TabDescriptor;
  openPageTab(pagePath: string, title?: string): TabDescriptor;
  openDocxTab(pagePath: string, title?: string): TabDescriptor;
  updateTab(
    tabId: string,
    patch: { title?: string; pagePath?: string; editorMode?: EditorMode; format?: DocumentFormat },
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
  /** Markdown 文档的源码编辑器分栏预览开关（仅对 format=markdown 的页面 tab 生效）。 */
  togglePreview(tabId: string, visible?: boolean): void;
  retargetTabs(fromPath: string, toPath: string, title: string): void;
  closeTabsForPath(removedPath: string): void;
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

  togglePreview(tabId, visible) {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== 'page' || tab.format !== 'markdown') return tab;
        const next = visible ?? tab.previewVisible !== true;
        return { ...tab, previewVisible: next };
      }),
    }));
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

export function getTabStore() {
  return useTabStore;
}

export { getTabStore as __getTabStoreForSmoke };
export { bindH1ToTitle, firstH1, pagePathForTitle, sanitizePageTitle, titleFromPath };
