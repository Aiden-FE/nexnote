/** Vault（知识库）根目录信息。一个窗口 = 一个 vault。 */
export interface VaultInfo {
  /** vault 根目录绝对路径 */
  root: string;
  /** vault 名称（目录名） */
  name: string;
  /** .nexnote/config.json 绝对路径 */
  configPath: string;
}

import { defaultVaultSettings, type VaultSettings } from './settings';

/** vault 内配置文件 .nexnote/config.json 的结构。 */
export interface VaultConfig {
  version: 1;
  /** 可选实验/功能开关；缺省值由 defaultVaultConfig 提供。 */
  features: {
    /** DEV-008：默认只写 SQLite confidence 缓存；显式开启才同步 frontmatter。 */
    confidenceFrontmatter: boolean;
  };
  /**
   * 已废弃（DEV-033）：会话改为 .nexnote/sessions 内部 JSONL 存储，
   * 不再有可配置会话目录；读取时静默丢弃旧配置残留。
   */
  /** DEV-016：每个 vault 独立的编辑器与 Git 行为设置。 */
  settings: VaultSettings;
  /** 窗口/布局状态（由渲染层经 vault:saveLayout 持久化） */
  layout: VaultLayout;
  /** 上次打开的页面（DEV-002/003 接入真实页面后使用，本票仅占位） */
  lastSession: {
    tabs: Array<{ kind: string; title: string }>;
  };
}

/** 渲染层布局状态（持久化到 vault 配置）。 */
export interface VaultLayout {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarPanelId: string | null;
  dockVisible: boolean;
  dockWidth: number;
  /** 页面树折叠的目录（vault 相对路径，DEV-003） */
  treeCollapsedDirs: string[];
  /** 页面树显示非 .md 文件（默认隐藏，DEV-003） */
  treeShowAllFiles: boolean;
  /** 页面树显示文件扩展名（默认隐藏 Markdown 后缀） */
  treeShowExtensions: boolean;
  /**
   * 新手引导是否已完成（完成或跳过后置 true，不再自动弹出）。
   * 旧配置缺省该字段时按 false 处理（读取侧与 defaultVaultLayout 兜底）。
   */
  guideCompleted: boolean;
  /**
   * 页签顺序（DEV-022 拖拽排序）：按 tab 稳定身份（pagePath 或 `kind:<kind>`）记录。
   * tab 会话本身不持久化（见 lastSession 占位），该顺序供会话内 vault 重开与
   * 后续会话恢复票据消费；旧配置缺省时按空数组兜底。
   */
  tabOrder: string[];
}

export function defaultVaultLayout(): VaultLayout {
  return {
    sidebarWidth: 260,
    sidebarCollapsed: false,
    activeSidebarPanelId: null,
    // 首次打开保持「侧栏 + 单栏主区」：AI Dock 按需手动开启
    dockVisible: false,
    dockWidth: 320,
    treeCollapsedDirs: [],
    treeShowAllFiles: false,
    treeShowExtensions: false,
    guideCompleted: false,
    tabOrder: [],
  };
}

export function defaultVaultConfig(): VaultConfig {
  return {
    version: 1,
    features: { confidenceFrontmatter: false },
    settings: defaultVaultSettings(),
    layout: defaultVaultLayout(),
    lastSession: { tabs: [] },
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
  | { mode: 'ready'; vault: VaultInfo; showWelcome: boolean };

export interface VaultInspection {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  hasNexnote: boolean;
  isGitRepo: boolean;
  isObsidian: boolean;
  entryCount: number;
}
