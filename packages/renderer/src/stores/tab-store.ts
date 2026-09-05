import { create } from 'zustand';

export type TabKind = 'welcome' | 'page' | 'files';

export interface TabDescriptor {
  id: string;
  kind: TabKind;
  title: string;
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
  /** 打开标签（默认进当前激活 pane） */
  openTab(paneId: PaneId, tab: { kind: TabKind; title: string }): TabDescriptor;
  closeTab(paneId: PaneId, tabId: string): void;
  setActiveTab(paneId: PaneId, tabId: string): void;
  setActivePane(paneId: PaneId): void;
  toggleSplit(enabled?: boolean): void;
  setSplitRatio(ratio: number): void;
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

export const useTabStore = create<WorkspaceState>((set) => ({
  panes: {
    left: initialLeftPane(),
    right: { id: 'right', tabs: [], activeTabId: null },
  },
  activePaneId: 'left',
  splitEnabled: true,
  splitRatio: 0.5,

  openTab(paneId, { kind, title }) {
    const tab: TabDescriptor = { id: nextTabId(), kind, title, createdAt: Date.now() };
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
}));

/** 便捷读取：当前激活 pane。 */
export function activePane(state: WorkspaceState): PaneState {
  return state.panes[state.activePaneId] ?? state.panes.left;
}

/** 冒烟/命令面板使用：在当前激活 pane 打开。 */
export function openTabInActivePane(kind: TabKind, title: string): TabDescriptor {
  return useTabStore.getState().openTab(useTabStore.getState().activePaneId, { kind, title });
}

export function getTabStore() {
  return useTabStore;
}

export { getTabStore as __getTabStoreForSmoke };
