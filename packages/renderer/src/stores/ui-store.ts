import { create } from 'zustand';

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
export const DOCK_MIN_WIDTH = 240;
export const DOCK_MAX_WIDTH = 560;

interface UiState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarPanelId: string | null;
  dockVisible: boolean;
  dockWidth: number;
  activeDockPanelId: string | null;
  /** 页面树折叠目录（vault 相对路径；持久化到 vault 配置，DEV-003） */
  treeCollapsedDirs: string[];
  /** 页面树显示非 .md 文件（默认隐藏，DEV-003） */
  treeShowAllFiles: boolean;
  toggleSidebar(): void;
  setSidebarWidth(width: number): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setActiveSidebarPanel(id: string): void;
  toggleDock(): void;
  setDockVisible(visible: boolean): void;
  setDockWidth(width: number): void;
  setActiveDockPanel(id: string): void;
  toggleTreeDir(path: string): void;
  setTreeCollapsedDirs(dirs: string[]): void;
  setTreeShowAllFiles(show: boolean): void;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 260,
  sidebarCollapsed: false,
  activeSidebarPanelId: null,
  dockVisible: true,
  dockWidth: 320,
  activeDockPanelId: null,
  treeCollapsedDirs: [],
  treeShowAllFiles: false,

  toggleSidebar() {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
  },
  setSidebarWidth(width) {
    set(() => ({ sidebarWidth: clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH) }));
  },
  setSidebarCollapsed(collapsed) {
    set(() => ({ sidebarCollapsed: collapsed }));
  },
  setActiveSidebarPanel(id) {
    set(() => ({ activeSidebarPanelId: id, sidebarCollapsed: false }));
  },
  toggleDock() {
    set((s) => ({ dockVisible: !s.dockVisible }));
  },
  setDockVisible(visible) {
    set(() => ({ dockVisible: visible }));
  },
  setDockWidth(width) {
    set(() => ({ dockWidth: clamp(width, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH) }));
  },
  setActiveDockPanel(id) {
    set(() => ({ activeDockPanelId: id, dockVisible: true }));
  },
  toggleTreeDir(path) {
    set((s) => ({
      treeCollapsedDirs: s.treeCollapsedDirs.includes(path)
        ? s.treeCollapsedDirs.filter((p) => p !== path)
        : [...s.treeCollapsedDirs, path],
    }));
  },
  setTreeCollapsedDirs(dirs) {
    set(() => ({ treeCollapsedDirs: dirs }));
  },
  setTreeShowAllFiles(show) {
    set(() => ({ treeShowAllFiles: show }));
  },
}));
