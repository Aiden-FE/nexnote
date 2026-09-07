import { create } from 'zustand';
import type { PluginView } from '@nexnote/shared';

/**
 * 插件运行时视图的全局只读快照（DEV-015）。
 * PluginHost 在每次 plugins:changed 后刷新；编辑器等消费方读取最新
 * 内置插件启停状态以派生 NodeView 与斜杠菜单。
 */
interface PluginStoreState {
  plugins: PluginView[];
  setPlugins: (plugins: PluginView[]) => void;
}

export const usePluginStore = create<PluginStoreState>((set) => ({
  plugins: [],
  setPlugins: (plugins) => set({ plugins }),
}));
