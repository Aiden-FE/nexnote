import { commandRegistry } from '../../registries';
import { openWorkspaceTab, useTabStore } from '../../stores/tab-store';
import { useUiStore } from '../../stores/ui-store';
import { useThemeStore } from '../../theme/theme-store';
import { usePaletteStore } from '../../stores/palette-store';
import { invoke } from '../../lib/ipc';
import { t } from '../../lib/i18n';
import { openSettings } from '../../lib/open-settings';
import { createPage } from '../editor/create-page';
import { expandAllCurrentHeadingFolds } from '../../editor/expand-all';
import { requestAppSave } from '../../editor/app-save';
import { importDocxIn, importBinaryIn } from '../sidebar/page-tree/ops';
import { printActiveDocument } from '../../print/collect-print-document';
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
  title: 'command.tab.new',
  category: 'command.category.tabs',
  keywords: ['new', 'tab', '页面'],
  shortcut: '⌘T',
  run: () => void createPage(),
});

commandRegistry.register({
  id: 'tab.close',
  title: 'command.tab.close',
  category: 'command.category.tabs',
  keywords: ['close', 'tab'],
  run: () => {
    const state = tabs.getState();
    if (state.activeTabId) state.closeTab(state.activeTabId);
  },
});

commandRegistry.register({
  id: 'tab.next',
  title: 'command.tab.next',
  category: 'command.category.tabs',
  keywords: ['next', 'tab', 'cycle', '切换', '循环', '页签'],
  shortcut: '⌃Tab / Ctrl+Tab',
  run: () => tabs.getState().activateAdjacentTab(1),
});

commandRegistry.register({
  id: 'tab.prev',
  title: 'command.tab.prev',
  category: 'command.category.tabs',
  keywords: ['previous', 'prev', 'tab', 'cycle', '切换', '循环', '页签'],
  shortcut: '⌃⇧Tab / Ctrl+Shift+Tab',
  run: () => tabs.getState().activateAdjacentTab(-1),
});

commandRegistry.register({
  id: 'editor.expandAllHeadings',
  title: 'command.editor.expandAllHeadings',
  category: 'command.category.editor',
  keywords: ['expand all', 'unfold', '全部展开', '章节', '标题'],
  run: () => {
    expandAllCurrentHeadingFolds();
  },
});

// 当前章节折叠 / 展开 / 切换快捷键 + 折叠到 H1/H2/H3 命令。
// 不提供无差别 Fold All，沿用 ADR-0013 边界：折叠必须明确指向章节或层级。
commandRegistry.register({
  id: 'editor.foldCurrentSection',
  title: 'command.editor.foldCurrentSection',
  category: 'command.category.editor',
  keywords: ['fold', 'collapse', '折叠', '章节', 'section'],
  shortcut: '⌘/Ctrl+Shift+[',
  run: () => {
    foldCurrentSection();
  },
});
commandRegistry.register({
  id: 'editor.expandCurrentSection',
  title: 'command.editor.expandCurrentSection',
  category: 'command.category.editor',
  keywords: ['expand', 'unfold', '展开', '章节', 'section'],
  shortcut: '⌘/Ctrl+Shift+]',
  run: () => {
    expandCurrentSection();
  },
});
commandRegistry.register({
  id: 'editor.toggleCurrentSectionFold',
  title: 'command.editor.toggleCurrentSectionFold',
  category: 'command.category.editor',
  keywords: ['toggle', 'fold', '切换', '折叠', '章节'],
  run: () => {
    toggleCurrentSectionFold();
  },
});

for (const [id, title, level, keywords] of [
  [
    'editor.foldToLevel1',
    'command.editor.foldToLevel1',
    1,
    ['fold', 'level', 'H1', '层级', '折叠到层级'],
  ],
  ['editor.foldToLevel2', 'command.editor.foldToLevel2', 2, ['fold', 'level', 'H2', '层级']],
  ['editor.foldToLevel3', 'command.editor.foldToLevel3', 3, ['fold', 'level', 'H3', '层级']],
] as const) {
  commandRegistry.register({
    id,
    title,
    category: 'command.category.editor',
    keywords: [...keywords],
    run: () => {
      foldToLevel(level);
    },
  });
}

commandRegistry.register({
  id: 'editor.toggleSourceMode',
  title: 'command.editor.toggleSourceMode',
  category: 'command.category.editor',
  keywords: ['source', 'markdown', '源码', '分栏', '编辑器'],
  shortcut: '⌘/Ctrl+E',
  run: requestActiveSourceModeToggle,
});

commandRegistry.register({
  id: 'editor.togglePreviewView',
  title: 'command.editor.togglePreviewView',
  category: 'command.category.editor',
  keywords: ['preview', 'read', '预览', '阅读'],
  shortcut: '⌘/Ctrl+Shift+E',
  run: requestActiveMarkdownPreviewToggle,
});

for (const [id, title, keywords, view] of [
  ['editor.viewSource', 'command.editor.viewSource', ['source', '源码', 'source view'], 'source'],
  ['editor.viewSplit', 'command.editor.viewSplit', ['split', '分栏', 'split view'], 'split'],
  [
    'editor.viewPreview',
    'command.editor.viewPreview',
    ['preview', '预览', 'preview view'],
    'preview',
  ],
] as const) {
  commandRegistry.register({
    id,
    title,
    category: 'command.category.editor',
    keywords: [...keywords],
    run: () => requestActiveMarkdownView(view),
  });
}

commandRegistry.register({
  id: 'view.graph',
  title: 'command.view.graph',
  category: 'command.category.view',
  keywords: ['graph', 'knowledge', '图谱', '知识'],
  shortcut: '⌘K',
  run: () => {
    openWorkspaceTab('graph', t('command.view.graph.tabTitle'));
  },
});

commandRegistry.register({
  id: 'view.toggleSidebar',
  title: 'command.view.toggleSidebar',
  category: 'command.category.view',
  keywords: ['sidebar', '侧栏'],
  run: () => ui.getState().toggleSidebar(),
});

commandRegistry.register({
  id: 'view.toggleDock',
  title: 'command.view.toggleDock',
  category: 'command.category.view',
  keywords: ['dock', 'ai'],
  run: () => ui.getState().toggleDock(),
});

commandRegistry.register({
  id: 'theme.toggle',
  title: 'command.theme.toggle',
  category: 'command.category.theme',
  keywords: ['theme', 'dark', 'light', '主题', '暗色', '亮色'],
  run: () => {
    const { resolved, setPreference } = useThemeStore.getState();
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  },
});

commandRegistry.register({
  id: 'theme.system',
  title: 'command.theme.system',
  category: 'command.category.theme',
  keywords: ['theme', 'system', '系统'],
  run: () => useThemeStore.getState().setPreference('system'),
});

commandRegistry.register({
  id: 'vault.switch',
  title: 'command.vault.switch',
  category: 'command.category.vault',
  keywords: ['vault', 'switch', '切换', '向导'],
  run: () => void invoke('vault:close').catch(() => undefined),
});

commandRegistry.register({
  id: 'app.settings',
  title: 'command.app.settings',
  category: 'command.category.app',
  keywords: ['settings', 'preferences', '设置', '首选项'],
  shortcut: '⌘,',
  run: () => openSettings(),
});

// 二进制文档导入命令入口（另两个入口为页面树「新建」菜单与拖拽导入）。
commandRegistry.register({
  id: 'binary.importDocx',
  title: 'command.binary.importDocx',
  category: 'command.category.document',
  keywords: ['import', 'docx', 'word', '导入', '文档'],
  run: () => void importDocxIn('').catch(() => undefined),
});

commandRegistry.register({
  id: 'binary.importXlsx',
  title: 'command.binary.importXlsx',
  category: 'command.category.document',
  keywords: ['import', 'xlsx', 'excel', '导入', '表格'],
  run: () => void importBinaryIn('xlsx', '').catch(() => undefined),
});

commandRegistry.register({
  id: 'binary.importXmind',
  title: 'command.binary.importXmind',
  category: 'command.category.document',
  keywords: ['import', 'xmind', 'mindmap', '导入', '思维导图'],
  run: () => void importBinaryIn('mindmap', '').catch(() => undefined),
});

commandRegistry.register({
  id: 'app.palette',
  title: 'command.app.palette',
  category: 'command.category.app',
  keywords: ['palette', 'command', '面板'],
  shortcut: '⌘K',
  run: () => usePaletteStore.getState().setOpen(true),
});

commandRegistry.register({
  id: 'app.checkUpdates',
  title: 'command.app.checkUpdates',
  category: 'command.category.app',
  keywords: ['update', '更新'],
  run: async () => {
    const result = await invoke('app:checkForUpdates');
    window.alert(
      `${t('command.checkUpdates.result', { status: result.status })}` +
        (result.message ? `\n${result.message}` : ''),
    );
  },
});

commandRegistry.register({
  id: 'document.print',
  title: 'app.menu.file.print',
  category: 'command.category.document',
  keywords: ['print', 'printer', '打印', '打印机'],
  shortcut: '⌘P',
  run: () => void printActiveDocument(),
});

commandRegistry.register({
  id: 'app.about',
  title: 'command.app.about',
  category: 'command.category.app',
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
  title: 'command.app.save',
  category: 'command.category.app',
  keywords: ['save', '保存', 'commit', '提交'],
  shortcut: '⌘S',
  run: async () => {
    try {
      await requestAppSave(window);
      await invoke('git:commit', { message: '保存当前工作区' });
    } catch (error) {
      console.error('[app] 保存失败，跳过本次 Git 提交', error);
    }
  },
});
