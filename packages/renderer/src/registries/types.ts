import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/** 侧栏面板插槽（DEV-003 页面树 / DEV-004 回链与标签在此挂载）。 */
export interface SidebarPanelDef {
  id: string;
  title: string;
  icon: LucideIcon;
  render: ComponentType;
  /** 可选标签角标（由面板自身订阅实时数据；DEV-024 反链计数）。 */
  renderBadge?: ComponentType;
}

/** 右侧 dock 面板插槽（DEV-012 AI 对话在此挂载）。 */
export interface DockPanelDef {
  id: string;
  title: string;
  icon: LucideIcon;
  render: ComponentType;
}

/** ⌘K 命令面板条目。 */
export interface CommandDef {
  id: string;
  title: string;
  category: string;
  keywords?: string[];
  shortcut?: string;
  run: () => void | Promise<void>;
}

/** 状态栏条目（DEV-007 Git 状态在此挂载）。 */
export interface StatusItemDef {
  id: string;
  align: 'left' | 'right';
  render: ComponentType;
}

/** 设置页分区（DEV-016 设置系统在此挂载，本票仅注册表 + 占位分区）。 */
export interface SettingsSectionDef {
  id: string;
  title: string;
  icon: LucideIcon;
  order?: number;
  render?: ComponentType;
}

/** 插件贡献声明的宿主通用注册表（DEV-013）；菜单/视图/块类型由宿主容器消费。 */
export interface PluginContributionDef {
  id: string;
  pluginId: string;
  kind: 'commands' | 'menus' | 'views' | 'blockTypes';
  title: string;
  keywords?: string[];
}
