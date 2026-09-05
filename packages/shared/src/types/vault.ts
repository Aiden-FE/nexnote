/** Vault（知识库）根目录信息。一个窗口 = 一个 vault。 */
export interface VaultInfo {
  /** vault 根目录绝对路径 */
  root: string;
  /** vault 名称（目录名） */
  name: string;
  /** .nexnote/config.json 绝对路径 */
  configPath: string;
}

/** vault 内配置文件 .nexnote/config.json 的结构。 */
export interface VaultConfig {
  version: 1;
  /** 窗口/布局状态（由渲染层经 vault:saveLayout 持久化） */
  layout: VaultLayout;
  /** 上次打开的页面（DEV-002/003 接入真实页面后使用，本票仅占位） */
  lastSession: {
    tabs: Array<{ kind: string; title: string }>;
    activePane: 'left' | 'right';
  };
}

/** 渲染层布局状态（持久化到 vault 配置）。 */
export interface VaultLayout {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarPanelId: string | null;
  dockVisible: boolean;
  dockWidth: number;
  splitEnabled: boolean;
  splitRatio: number;
  /** 页面树折叠的目录（vault 相对路径，DEV-003） */
  treeCollapsedDirs: string[];
  /** 页面树显示非 .md 文件（默认隐藏，DEV-003） */
  treeShowAllFiles: boolean;
}

export function defaultVaultLayout(): VaultLayout {
  return {
    sidebarWidth: 260,
    sidebarCollapsed: false,
    activeSidebarPanelId: null,
    dockVisible: true,
    dockWidth: 320,
    splitEnabled: true,
    splitRatio: 0.5,
    treeCollapsedDirs: [],
    treeShowAllFiles: false,
  };
}

export function defaultVaultConfig(): VaultConfig {
  return {
    version: 1,
    layout: defaultVaultLayout(),
    lastSession: { tabs: [], activePane: 'left' },
  };
}

/** 最近打开的 vault 条目（应用级持久化，非 vault 内）。 */
export interface RecentVaultEntry {
  path: string;
  name: string;
  lastOpenedAt: number;
}

/** 应用启动状态：首启动向导 or 直接进入 vault 工作区。 */
export type VaultStartupState =
  | { mode: 'onboarding'; recent: RecentVaultEntry[] }
  | { mode: 'ready'; vault: VaultInfo };
