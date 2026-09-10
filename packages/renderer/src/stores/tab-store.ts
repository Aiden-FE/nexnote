import { create } from 'zustand';
import {
  bindH1ToTitle,
  firstH1,
  pagePathForTitle,
  sanitizePageTitle,
  titleFromPath,
} from '../editor/title-sync';

export type TabKind = 'welcome' | 'page' | 'docx' | 'files' | 'graph' | 'settings';
export type EditorMode = 'block' | 'source';

export interface TabDescriptor {
  id: string;
  kind: TabKind;
  title: string;
  /** 页面 tab 的 vault 相对 Markdown 路径；welcome/files 无此字段。 */
  pagePath?: string;
  /** 仅存在于当前 tab 生命周期；关闭 tab 后不会持久化。 */
  editorMode?: EditorMode;
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
    patch: { title?: string; pagePath?: string; editorMode?: EditorMode },
  ): void;
  closeTab(tabId: string): void;
  closeOtherTabs(tabId: string): void;
  closeTabsToRight(tabId: string): void;
  setActiveTab(tabId: string): void;
  setTabTitle(tabId: string, title: string): void;
  toggleSourceMode(tabId: string, enabled?: boolean): void;
  retargetTabs(fromPath: string, toPath: string, title: string): void;
  closeTabsForPath(removedPath: string): void;
}

let tabSeq = 0;
function nextTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now().toString(36)}-${tabSeq}`;
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

  toggleSourceMode(tabId, enabled) {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== 'page') return tab;
        const next = enabled ?? tab.editorMode !== 'source';
        return { ...tab, editorMode: next ? 'source' : 'block' };
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
