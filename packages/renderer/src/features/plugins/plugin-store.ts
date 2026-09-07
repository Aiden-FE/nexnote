import { create } from 'zustand';
import type { PluginCommandView, PluginContributionView, PluginView } from '@nexnote/shared';

/**
 * 插件运行时视图的全局只读快照（DEV-015）。
 * PluginHost 在每次 plugins:changed 后刷新；编辑器等消费方读取最新
 * 内置插件启停状态以派生 NodeView 与斜杠菜单。
 * DEV-017：命令/贡献快照也进 store，斜杠菜单的 extraSlashItems 需实时读取。
 */
interface PluginStoreState {
  plugins: PluginView[];
  commands: PluginCommandView[];
  contributions: PluginContributionView[];
  setPlugins: (plugins: PluginView[]) => void;
  setRuntime: (commands: PluginCommandView[], contributions: PluginContributionView[]) => void;
}

export const usePluginStore = create<PluginStoreState>((set) => ({
  plugins: [],
  commands: [],
  contributions: [],
  setPlugins: (plugins) => set({ plugins }),
  setRuntime: (commands, contributions) => set({ commands, contributions }),
}));
