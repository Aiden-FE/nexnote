import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * 侧栏面板插槽（DEV-003 页面树 / DEV-004 回链与标签在此挂载）。
 *
 * `title` 是界面文案：`titleIsKey` 时为消息目录 key，由侧栏经 i18n 成文；
 * 否则视为已定稿文案（如第三方插件贡献的标题，不参与翻译）。
 */
export interface SidebarPanelDef {
  id: string;
  title: string;
  /** `title` 是否为消息目录 key（ADR-0023）；缺省视为已定稿文案。 */
  titleIsKey?: boolean;
  icon: LucideIcon;
  render: ComponentType;
  /** 可选标签角标（由面板自身订阅实时数据；DEV-024 反链计数）。 */
  renderBadge?: ComponentType;
}

/** 右侧 dock 面板插槽（DEV-012 AI 对话在此挂载）。`titleIsKey` 同侧栏面板。 */
export interface DockPanelDef {
  id: string;
  title: string;
  titleIsKey?: boolean;
  icon: LucideIcon;
  render: ComponentType;
}

/**
 * ⌘K 命令面板条目。
 *
 * `title` / `category` 为消息目录 key，由命令面板按当前界面语言成文
 * （ADR-0023：消息目录为唯一真相，命令与分类随界面语言切换）。
 * `keywords` 保留中英互通，保证任一语言下都能搜到命令。
 */
export interface CommandDef {
  id: string;
  title: string;
  /** 用于 `title` 中的 `{placeholder}` 参数（如插件贡献标题）。 */
  titleParams?: Readonly<Record<string, string | number>>;
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

/**
 * 设置页分区（DEV-016 设置系统在此挂载，本票仅注册表 + 占位分区）。
 *
 * `title` 是界面文案：`titleKey` 时为消息目录 key，由设置页经 i18n 成文；
 * 否则视为已定稿文案（如第三方插件贡献的标题，不参与翻译）。
 */
export interface SettingsSectionDef {
  id: string;
  title: string;
  /** `title` 是否为消息目录 key（ADR-0023）；缺省视为已定稿文案。 */
  titleIsKey?: boolean;
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
