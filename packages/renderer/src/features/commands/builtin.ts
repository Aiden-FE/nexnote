import { commandRegistry } from '../../registries';
import { openWorkspaceTab, useTabStore } from '../../stores/tab-store';
import { useUiStore } from '../../stores/ui-store';
import { useThemeStore } from '../../theme/theme-store';
import { usePaletteStore } from '../../stores/palette-store';
import { invoke } from '../../lib/ipc';
import { openSettings } from '../../lib/open-settings';
import { createPage } from '../editor/create-page';
import { expandAllCurrentHeadingFolds } from '../../editor/expand-all';
import {
  expandCurrentSection,
  foldCurrentSection,
  foldToLevel,
  toggleCurrentSectionFold,
} from '../../editor/fold-actions';
import {
  requestActiveMarkdownPreviewToggle,
  requestActiveMarkdownView,
  requestActiveSourceModeToggle,
} from '../../editor/source/source-mode-toggle';

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
  shortcut: '⌘T',
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
  shortcut: '⌃Tab / Ctrl+Tab',
  run: () => tabs.getState().activateAdjacentTab(1),
});

commandRegistry.register({
  id: 'tab.prev',
  title: '切换到上一个标签页',
  category: '标签页',
  keywords: ['previous', 'prev', 'tab', 'cycle', '切换', '循环', '页签'],
  shortcut: '⌃⇧Tab / Ctrl+Shift+Tab',
  run: () => tabs.getState().activateAdjacentTab(-1),
});

commandRegistry.register({
  id: 'editor.expandAllHeadings',
  title: '全部展开章节',
  category: '编辑器',
  keywords: ['expand all', 'unfold', '全部展开', '章节', '标题'],
  run: () => {
    expandAllCurrentHeadingFolds();
  },
});

// 当前章节折叠 / 展开 / 切换快捷键 + 折叠到 H1/H2/H3 命令。
// 不提供无差别 Fold All，沿用 ADR-0013 边界：折叠必须明确指向章节或层级。
commandRegistry.register({
  id: 'editor.foldCurrentSection',
  title: '折叠当前章节',
  category: '编辑器',
  keywords: ['fold', 'collapse', '折叠', '章节', 'section'],
  shortcut: '⌘/Ctrl+Shift+[',
  run: () => {
    foldCurrentSection();
  },
});
commandRegistry.register({
  id: 'editor.expandCurrentSection',
  title: '展开当前章节',
  category: '编辑器',
  keywords: ['expand', 'unfold', '展开', '章节', 'section'],
  shortcut: '⌘/Ctrl+Shift+]',
  run: () => {
    expandCurrentSection();
  },
});
commandRegistry.register({
  id: 'editor.toggleCurrentSectionFold',
  title: '切换当前章节折叠',
  category: '编辑器',
  keywords: ['toggle', 'fold', '切换', '折叠', '章节'],
  run: () => {
    toggleCurrentSectionFold();
  },
});

for (const [id, title, level, keywords] of [
  ['editor.foldToLevel1', '折叠到 H1', 1, ['fold', 'level', 'H1', '层级', '折叠到层级']],
  ['editor.foldToLevel2', '折叠到 H2', 2, ['fold', 'level', 'H2', '层级']],
  ['editor.foldToLevel3', '折叠到 H3', 3, ['fold', 'level', 'H3', '层级']],
] as const) {
  commandRegistry.register({
    id,
    title,
    category: '编辑器',
    keywords: [...keywords],
    run: () => {
      foldToLevel(level);
    },
  });
}

commandRegistry.register({
  id: 'editor.toggleSourceMode',
  title: '切换源码模式',
  category: '编辑器',
  keywords: ['source', 'markdown', '源码', '分栏', '编辑器'],
  shortcut: '⌘/Ctrl+E',
  run: requestActiveSourceModeToggle,
});

commandRegistry.register({
  id: 'editor.togglePreviewView',
  title: '切换预览视图',
  category: '编辑器',
  keywords: ['preview', 'read', '预览', '阅读'],
  shortcut: '⌘/Ctrl+Shift+E',
  run: requestActiveMarkdownPreviewToggle,
});

for (const [id, title, keywords, view] of [
  ['editor.viewSource', '切换到源码视图', ['source', '源码'], 'source'],
  ['editor.viewSplit', '切换到分栏视图', ['split', '分栏'], 'split'],
  ['editor.viewPreview', '切换到预览视图', ['preview', '预览'], 'preview'],
] as const) {
  commandRegistry.register({
    id,
    title,
    category: '编辑器',
    keywords: [...keywords],
    run: () => requestActiveMarkdownView(view),
  });
}

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
  shortcut: '⌘,',
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
  title: '检查更新',
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
