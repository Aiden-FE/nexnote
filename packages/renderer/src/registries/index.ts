import { createRegistry } from './registry';
import type {
  CommandDef,
  DockPanelDef,
  SettingsSectionDef,
  SidebarPanelDef,
  StatusItemDef,
} from './types';

/**
 * 渲染层应用壳的全部扩展插槽。
 * 架构约束：后续功能票通过「新增模块文件 + 在 features/bootstrap.ts import」扩展，
 * 不修改核心 App/Shell 组件。
 */
export const sidebarPanelRegistry = createRegistry<SidebarPanelDef>('sidebar-panel');
export const dockPanelRegistry = createRegistry<DockPanelDef>('dock-panel');
export const commandRegistry = createRegistry<CommandDef>('command');
export const statusBarRegistry = createRegistry<StatusItemDef>('status-item');
export const settingsSectionRegistry = createRegistry<SettingsSectionDef>('settings-section');

export { useRegistryItems } from './registry';
export type { CommandDef, DockPanelDef, SettingsSectionDef, SidebarPanelDef, StatusItemDef } from './types';
export type { Registry } from './registry';
