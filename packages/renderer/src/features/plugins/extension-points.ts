import type { PluginCommandView, PluginContributionView } from '@nexnote/shared';
import type { ContextMenuItem } from '@nexnote/kernel';

/**
 * 插件四类扩展点的宿主派生（DEV-014），纯逻辑、浏览器与单测共用。
 * 渲染层把这些派生物登记到对应注册表：
 * - commands → commandRegistry（⌘K 面板，按「插件」分组）
 * - menus    → 编辑器右键菜单（插件子菜单，点击 runCommand）
 * - views    → sidebarPanelRegistry（侧栏页签，渲染插件沙箱视图）
 * - blockTypes → commandRegistry（⌘K 插入插件块）+ 内核 pluginBlock 节点
 */

export const PLUGIN_MENU_GROUP = 'plugin';

/** 右键菜单 id 编码：plugin-menu:<scopedId>（scopedId = <pluginId>:<contributionId>）。 */
export const PLUGIN_MENU_ACTION_PREFIX = 'plugin-menu:';
export function pluginMenuActionId(scopedId: string): string {
  return `${PLUGIN_MENU_ACTION_PREFIX}${scopedId}`;
}

/** ⌘K 命令 id（块类型插入）：plugin-block:<pluginId>:<blockType>。 */
export function pluginBlockCommandId(pluginId: string, blockType: string): string {
  return `plugin-block:${pluginId}:${blockType}`;
}

/** 由插件菜单贡献派生编辑器右键菜单条目（挂在「插件」子菜单下）。 */
export function buildPluginMenuItems<
  T extends { id: string; kind: string; title: string; scopedId?: string },
>(
  contributions: readonly T[],
): ContextMenuItem[] {
  const menus = contributions.filter((item) => item.kind === 'menus');
  if (menus.length === 0) return [];
  const submenu: ContextMenuItem[] = menus.map((item) => ({
    id: pluginMenuActionId(item.scopedId ?? item.id),
    title: item.title,
  }));
  return [{ title: '插件', submenu }];
}

/** 由插件块类型贡献派生需要登记的插入块命令描述。 */
export interface PluginBlockCommandDef {
  id: string;
  title: string;
  keywords: string[];
  pluginId: string;
  blockType: string;
}

export function buildPluginBlockCommands(
  contributions: PluginContributionView[],
): PluginBlockCommandDef[] {
  return contributions
    .filter((item) => item.kind === 'blockTypes')
    .map((item) => ({
      id: pluginBlockCommandId(item.pluginId, item.blockType ?? item.id),
      title: `插入插件块：${item.title}`,
      keywords: ['插件', 'plugin', 'block', ...(item.keywords ?? [])],
      pluginId: item.pluginId,
      blockType: item.blockType ?? item.id,
    }));
}

/** 由插件命令贡献 + 运行时注册命令派生 ⌘K 命令面板条目（去重，运行时优先）。 */
export function buildPluginCommandDefs(
  manifestCommands: PluginContributionView[],
  runtimeCommands: PluginCommandView[],
): Array<{ id: string; title: string; keywords?: string[]; pluginId: string; commandId: string }> {
  const manifest = manifestCommands
    .filter((item) => item.kind === 'commands')
    .map((item) => ({
      id: item.scopedId,
      title: item.title,
      keywords: item.keywords,
      pluginId: item.pluginId,
      commandId: item.id,
    }));
  const runtime = runtimeCommands.map((cmd) => ({
    id: cmd.id,
    title: cmd.title,
    keywords: cmd.keywords,
    pluginId: cmd.pluginId,
    commandId: cmd.id.split(':').slice(1).join(':'),
  }));
  const byId = new Map<string, (typeof manifest)[number]>();
  for (const def of [...manifest, ...runtime]) byId.set(def.id, def);
  return [...byId.values()];
}

/** 视图贡献 → 侧栏面板元数据（React 渲染组件由宿主统一提供）。 */
export interface PluginViewPanelDef {
  id: string;
  title: string;
  pluginId: string;
  viewId: string;
}

export function buildPluginViewPanels(
  contributions: PluginContributionView[],
): PluginViewPanelDef[] {
  return contributions
    .filter((item) => item.kind === 'views' && item.placement !== 'main' && item.placement !== 'settings')
    .map((item) => ({
      id: `plugin-view:${item.scopedId}`,
      title: item.title,
      pluginId: item.pluginId,
      viewId: item.id,
    }));
}
