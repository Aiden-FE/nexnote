import { create } from 'zustand';
import {
  bindH1ToTitle,
  firstH1,
  pagePathForTitle,
  sanitizePageTitle,
  titleFromPath,
} from '../editor/title-sync';

export type TabKind = 'welcome' | 'page' | 'files' | 'graph' | 'settings';

export interface TabDescriptor {
  id: string;
  kind: TabKind;
  title: string;
  /** 页面 tab 的 vault 相对 Markdown 路径；welcome/files 无此字段。 */
  pagePath?: string;
  createdAt: number;
}

export type PaneId = 'left' | 'right';

export interface PaneState {
  id: PaneId;
  tabs: TabDescriptor[];
  activeTabId: string | null;
}

interface WorkspaceState {
  panes: { left: PaneState; right: PaneState | null };
  activePaneId: PaneId;
  splitEnabled: boolean;
  splitRatio: number;
  /** 打开标签（默认进当前激活 pane）。 */
  openTab(paneId: PaneId, tab: { kind: TabKind; title: string; pagePath?: string }): TabDescriptor;
  /** 打开页面：同 pane 已有同路径 tab 则激活，否则新建（DEV-003 页面树点击）。 */
  openPageTab(paneId: PaneId, pagePath: string, title?: string): TabDescriptor;
  /** 更新标签标题，并可更新页面路径（DEV-002 H1 文件名联动）。 */
  updateTab(paneId: PaneId, tabId: string, patch: { title?: string; pagePath?: string }): void;
  closeTab(paneId: PaneId, tabId: string): void;
  /** 关闭除指定 tab 外的全部（tab 右键菜单，DEV-003） */
  closeOtherTabs(paneId: PaneId, tabId: string): void;
  /** 关闭指定 tab 右侧的全部（tab 右键菜单，DEV-003） */
  closeTabsToRight(paneId: PaneId, tabId: string): void;
  setActiveTab(paneId: PaneId, tabId: string): void;
  setActivePane(paneId: PaneId): void;
  toggleSplit(enabled?: boolean): void;
  setSplitRatio(ratio: number): void;
  /** 更新 tab 标题（页面 H1 读取后回写，DEV-003） */
  setTabTitle(paneId: PaneId, tabId: string, title: string): void;
  /** 文件重命名/移动后联动更新已打开 tab 的 pagePath 与标题（DEV-003）。 */
  retargetTabs(fromPath: string, toPath: string, title: string): void;
  /** 文件删除后关闭指向它的 tab（目录删除时按前缀匹配，DEV-003） */
  closeTabsForPath(removedPath: string): void;
}

let tabSeq = 0;
function nextTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now().toString(36)}-${tabSeq}`;
}

function initialLeftPane(): PaneState {
  const welcome: TabDescriptor = {
    id: nextTabId(),
    kind: 'welcome',
    title: '欢迎',
    createdAt: Date.now(),
  };
  return { id: 'left', tabs: [welcome], activeTabId: welcome.id };
}

export const useTabStore = create<WorkspaceState>()((set, get) => ({
  panes: {
    left: initialLeftPane(),
    right: { id: 'right', tabs: [], activeTabId: null },
  },
  activePaneId: 'left',
  splitEnabled: true,
  splitRatio: 0.5,

  openTab(paneId, { kind, title, pagePath }) {
    const tab: TabDescriptor = { id: nextTabId(), kind, title, createdAt: Date.now(), pagePath };
    set((state) => {
      // 目标 pane 不存在（如分屏关着）时落回 left
      const target: PaneId = paneId === 'right' && !state.panes.right ? 'left' : paneId;
      const pane = state.panes[target] ?? state.panes.left;
      const updated: PaneState = { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id };
      return {
        panes:
          target === 'left'
            ? { ...state.panes, left: updated }
            : { ...state.panes, right: updated },
        activePaneId: target,
      };
    });
    return tab;
  },

  openPageTab(paneId, pagePath, title) {
    const state = get();
    const target: PaneId = paneId === 'right' && !state.panes.right ? 'left' : paneId;
    const pane = state.panes[target] ?? state.panes.left;
    const existing = pane.tabs.find((t) => t.kind === 'page' && t.pagePath === pagePath);
    if (existing) {
      get().setActiveTab(target, existing.id);
      return existing;
    }
    const fallbackTitle = title ?? pagePath.slice(pagePath.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    return get().openTab(target, { kind: 'page', title: fallbackTitle, pagePath });
  },

  updateTab(paneId, tabId, patch) {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return state;
      const tabs = pane.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
      const updated: PaneState = { ...pane, tabs };
      return {
        panes:
          paneId === 'left'
            ? { ...state.panes, left: updated }
            : { ...state.panes, right: updated },
      };
    });
  },

  closeTab(paneId, tabId) {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return state;
      const idx = pane.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;
      const tabs = pane.tabs.filter((t) => t.id !== tabId);
      let activeTabId = pane.activeTabId;
      if (activeTabId === tabId) {
        const next = tabs[idx] ?? tabs[idx - 1];
        activeTabId = next ? next.id : null;
      }
      const updated: PaneState = { ...pane, tabs, activeTabId };
      return {
        panes:
          paneId === 'left'
            ? { ...state.panes, left: updated }
            : { ...state.panes, right: updated },
      };
    });
  },

  closeOtherTabs(paneId, tabId) {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane || !pane.tabs.some((t) => t.id === tabId)) return state;
      const updated: PaneState = {
        ...pane,
        tabs: pane.tabs.filter((t) => t.id === tabId),
        activeTabId: tabId,
      };
      return {
        panes:
          paneId === 'left'
            ? { ...state.panes, left: updated }
            : { ...state.panes, right: updated },
      };
    });
  },

  closeTabsToRight(paneId, tabId) {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return state;
      const idx = pane.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;
      const updated: PaneState = {
        ...pane,
        tabs: pane.tabs.slice(0, idx + 1),
        activeTabId: pane.activeTabId ?? tabId,
      };
      if (updated.tabs.some((t) => t.id === updated.activeTabId) === false) {
        updated.activeTabId = tabId;
      }
      return {
        panes:
          paneId === 'left'
            ? { ...state.panes, left: updated }
            : { ...state.panes, right: updated },
      };
    });
  },

  setActiveTab(paneId, tabId) {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane || !pane.tabs.some((t) => t.id === tabId)) return state;
      const updated: PaneState = { ...pane, activeTabId: tabId };
      return {
        panes:
          paneId === 'left'
            ? { ...state.panes, left: updated }
            : { ...state.panes, right: updated },
        activePaneId: paneId,
      };
    });
  },

  setActivePane(paneId) {
    set(() => ({ activePaneId: paneId }));
  },

  toggleSplit(enabled) {
    set((state) => {
      const next = enabled ?? !state.splitEnabled;
      if (next && !state.panes.right) {
        const right: PaneState = { id: 'right', tabs: [], activeTabId: null };
        return { splitEnabled: true, panes: { ...state.panes, right } };
      }
      if (!next) return { splitEnabled: false };
      return { splitEnabled: true };
    });
  },

  setSplitRatio(ratio) {
    const clamped = Math.min(0.85, Math.max(0.15, ratio));
    set(() => ({ splitRatio: clamped }));
  },

  setTabTitle(paneId, tabId, title) {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return state;
      if (!pane.tabs.some((t) => t.id === tabId && t.title !== title)) return state;
      const updated: PaneState = {
        ...pane,
        tabs: pane.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
      };
      return {
        panes:
          paneId === 'left'
            ? { ...state.panes, left: updated }
            : { ...state.panes, right: updated },
      };
    });
  },

  retargetTabs(fromPath, toPath, title) {
    set((state) => {
      const mapPane = (pane: PaneState | null): PaneState | null =>
        pane && pane.tabs.some((t) => t.pagePath === fromPath)
          ? {
              ...pane,
              tabs: pane.tabs.map((t) =>
                t.pagePath === fromPath ? { ...t, pagePath: toPath, title } : t,
              ),
            }
          : pane;
      return { panes: { left: mapPane(state.panes.left)!, right: mapPane(state.panes.right) } };
    });
  },

  closeTabsForPath(removedPath) {
    const hit = (p: string | undefined): boolean =>
      !!p && (p === removedPath || p.startsWith(`${removedPath}/`));
    set((state) => {
      let changed = false;
      const mapPane = (pane: PaneState | null): PaneState | null => {
        if (!pane) return pane;
        const tabs = pane.tabs.filter((t) => !hit(t.pagePath));
        if (tabs.length === pane.tabs.length) return pane;
        changed = true;
        const active =
          pane.activeTabId && tabs.some((t) => t.id === pane.activeTabId)
            ? pane.activeTabId
            : (tabs[tabs.length - 1]?.id ?? null);
        return { ...pane, tabs, activeTabId: active };
      };
      const panes = { left: mapPane(state.panes.left)!, right: mapPane(state.panes.right) };
      return changed ? { panes } : state;
    });
  },
}));

/** 便捷读取：当前激活 pane。 */
export function activePane(state: WorkspaceState): PaneState {
  return state.panes[state.activePaneId] ?? state.panes.left;
}

/** 冒烟/命令面板使用：在当前激活 pane 打开。 */
export function openTabInActivePane(
  kind: TabKind,
  title: string,
  pagePath?: string,
): TabDescriptor {
  return useTabStore.getState().openTab(useTabStore.getState().activePaneId, { kind, title, pagePath });
}

/** 页面树使用：在当前激活 pane 打开页面（同路径复用 tab）。 */
export function openPageInActivePane(pagePath: string, title?: string): TabDescriptor {
  return useTabStore.getState().openPageTab(useTabStore.getState().activePaneId, pagePath, title);
}

export function getTabStore() {
  return useTabStore;
}

export { getTabStore as __getTabStoreForSmoke };

/** title-sync 纯函数统一从 store 包对外导出，便于 renderer 测试与后续模块复用。 */
export {
  bindH1ToTitle,
  firstH1,
  pagePathForTitle,
  sanitizePageTitle,
  titleFromPath,
};
