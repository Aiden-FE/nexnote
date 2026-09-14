import { commandRegistry } from '../../registries';
import { openWorkspaceTab, useTabStore } from '../../stores/tab-store';
import { useUiStore } from '../../stores/ui-store';
import { useThemeStore } from '../../theme/theme-store';
import { usePaletteStore } from '../../stores/palette-store';
import { invoke } from '../../lib/ipc';
import { openSettings } from '../../lib/open-settings';
import { createPage } from '../editor/create-page';
import { requestActiveSourceModeToggle } from '../../editor/source/source-mode-toggle';

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
  run: () => void createPage(),
});

commandRegistry.register({
  id: 'tab.close',
  title: '关闭当前标签页',
  category: '标签页',
  keywords: ['close', 'tab'],
  run: () => {
    const state = tabs.getState();
    if (state.activeTabId) state.closeTab(state.activeTabId);
  },
});

commandRegistry.register({
  id: 'tab.next',
  title: '切换到下一个标签页',
  category: '标签页',
  keywords: ['next', 'tab', 'cycle', '切换', '循环', '页签'],
  shortcut: '⌃Tab / Ctrl+Tab（DEV-022）',
  run: () => tabs.getState().activateAdjacentTab(1),
});

commandRegistry.register({
  id: 'tab.prev',
  title: '切换到上一个标签页',
  category: '标签页',
  keywords: ['previous', 'prev', 'tab', 'cycle', '切换', '循环', '页签'],
  shortcut: '⌃⇧Tab / Ctrl+Shift+Tab（DEV-022）',
  run: () => tabs.getState().activateAdjacentTab(-1),
});

commandRegistry.register({
  id: 'editor.toggleSourceMode',
  title: '切换源码模式',
  category: '编辑器',
  keywords: ['source', 'markdown', '源码', '预览', '编辑器'],
  shortcut: '⌘/Ctrl+E',
  run: requestActiveSourceModeToggle,
});

commandRegistry.register({
  id: 'view.graph',
  title: '打开全局知识图谱',
  category: '视图',
  keywords: ['graph', 'knowledge', '图谱', '知识'],
  shortcut: '⌘K',
  run: () => {
    openWorkspaceTab('graph', '知识图谱');
  },
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
  id: 'app.settings',
  title: '打开设置',
  category: '应用',
  keywords: ['settings', 'preferences', '设置', '首选项'],
  shortcut: '⌘,（UI 快捷键 DEV-017）',
  run: () => openSettings(),
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

commandRegistry.register({
  id: 'app.save',
  title: '保存当前工作区',
  category: '应用',
  keywords: ['save', '保存', 'commit', '提交'],
  shortcut: '⌘S',
  run: async () => {
    const { requestAppSave } = await import('../../editor/app-save');
    try {
      await requestAppSave(window);
      await invoke('git:commit', { message: '保存当前工作区' });
    } catch (error) {
      console.error('[app] 保存失败，跳过本次 Git 提交', error);
    }
  },
});
