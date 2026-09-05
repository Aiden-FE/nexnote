import { commandRegistry } from '../../registries';
import { openTabInActivePane, useTabStore } from '../../stores/tab-store';
import { useUiStore } from '../../stores/ui-store';
import { useThemeStore } from '../../theme/theme-store';
import { usePaletteStore } from '../../stores/palette-store';
import { invoke } from '../../lib/ipc';

/**
 * 内置命令（⌘K 面板）。后续票据的命令：
 * 新增模块文件 → commandRegistry.register(...) → 在 features/bootstrap.ts import，即出现在面板。
 */
const tabs = useTabStore;
const ui = useUiStore;

commandRegistry.register({
  id: 'tab.new',
  title: '新建标签页',
  category: '标签页',
  keywords: ['new', 'tab', '页面'],
  shortcut: '⌘T（UI 快捷键 DEV-017）',
  run: () => {
    openTabInActivePane('page', '未命名页面');
  },
});

commandRegistry.register({
  id: 'tab.close',
  title: '关闭当前标签页',
  category: '标签页',
  keywords: ['close', 'tab'],
  run: () => {
    const state = tabs.getState();
    const pane = state.panes[state.activePaneId] ?? state.panes.left;
    if (pane.activeTabId) state.closeTab(pane.id, pane.activeTabId);
  },
});

commandRegistry.register({
  id: 'tab.files',
  title: '打开 Vault 文件浏览',
  category: '标签页',
  keywords: ['files', 'fs', '文件', '浏览'],
  run: () => {
    openTabInActivePane('files', 'Vault 文件');
  },
});

commandRegistry.register({
  id: 'view.toggleSplit',
  title: '切换左右分屏',
  category: '视图',
  keywords: ['split', '分屏', 'pane'],
  run: () => tabs.getState().toggleSplit(),
});

commandRegistry.register({
  id: 'view.toggleSidebar',
  title: '折叠/展开侧栏',
  category: '视图',
  keywords: ['sidebar', '侧栏'],
  run: () => ui.getState().toggleSidebar(),
});

commandRegistry.register({
  id: 'view.toggleDock',
  title: '显示/隐藏右侧 Dock',
  category: '视图',
  keywords: ['dock', 'ai'],
  run: () => ui.getState().toggleDock(),
});

commandRegistry.register({
  id: 'theme.toggle',
  title: '切换亮/暗主题',
  category: '主题',
  keywords: ['theme', 'dark', 'light', '主题', '暗色', '亮色'],
  run: () => {
    const { resolved, setPreference } = useThemeStore.getState();
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  },
});

commandRegistry.register({
  id: 'theme.system',
  title: '主题跟随系统',
  category: '主题',
  keywords: ['theme', 'system', '系统'],
  run: () => useThemeStore.getState().setPreference('system'),
});

commandRegistry.register({
  id: 'vault.switch',
  title: '切换/打开其他知识库',
  category: '知识库',
  keywords: ['vault', 'switch', '切换', '向导'],
  run: () => void invoke('vault:close').catch(() => undefined),
});

commandRegistry.register({
  id: 'app.palette',
  title: '打开命令面板',
  category: '应用',
  keywords: ['palette', 'command', '面板'],
  shortcut: '⌘K',
  run: () => usePaletteStore.getState().setOpen(true),
});

commandRegistry.register({
  id: 'app.checkUpdates',
  title: '检查更新（占位）',
  category: '应用',
  keywords: ['update', '更新'],
  run: async () => {
    const result = await invoke('app:checkForUpdates');
    window.alert(`更新检查：${result.status}${result.message ? `\n${result.message}` : ''}`);
  },
});

commandRegistry.register({
  id: 'app.about',
  title: '关于 NexNote',
  category: '应用',
  keywords: ['about', '关于'],
  run: async () => {
    const info = await invoke('app:getInfo');
    window.alert(
      `NexNote v${info.version}\nElectron ${info.electronVersion}\n${info.platform}/${info.arch}`,
    );
  },
});
