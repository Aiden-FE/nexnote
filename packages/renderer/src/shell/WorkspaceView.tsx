import type { VaultInfo } from '@nexnote/shared';
import { useCallback, useEffect, useMemo } from 'react';
import { Sidebar } from './Sidebar';
import { DockHost } from './DockHost';
import { StatusBar } from './StatusBar';
import { SplitView } from '../split/SplitView';
import { useVaultLayoutPersistence } from './layout-persistence';
import { bindVaultFsEvents, usePageTreeStore } from '../stores/page-tree-store';
import { useTabStore } from '../stores/tab-store';
import { bindIndexEvents, useIndexStore } from '../stores/index-store';
import { WritingAssistantLayer } from '../features/ai/writing';
import { PluginHost } from '../features/plugins';
import { GuidedTour } from '../tour/GuidedTour';
import { FileMenuBar, type FileMenuHandlers } from './FileMenuBar';
import {
  createNoteIn,
  createBinaryIn,
  importDocxIn,
  importBinaryIn,
} from '../features/sidebar/page-tree/ops';

/** 工作区：三面板（侧栏 + 主内容 + 右侧 dock）+ 底部状态栏。 */
export function WorkspaceView({ vault }: { vault: VaultInfo }) {
  useVaultLayoutPersistence(vault);
  const previewOnly = useTabStore((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
    return tab?.format === 'markdown' && (tab.markdownView ?? 'split') === 'preview';
  });

  // DEV-084 + DEV-096：顶栏「文件」菜单——把原本散在侧栏的「新建 / 导入」并入此处。
  const fileMenuHandlers = useMemo<FileMenuHandlers>(
    () => ({
      createNote: (format: 'native-block' | 'markdown') => {
        void createNoteIn('', format);
      },
      createBlankBinary: (kind: 'docx' | 'xlsx' | 'xmind') => {
        // ops.createBinaryIn 的入参约定 'mindmap' 而 NewNoteMenu 的展示用 'xmind'，
        // 调用边界翻译一次。
        void createBinaryIn(kind === 'xmind' ? 'mindmap' : kind, '');
      },
      importDocx: () => {
        void importDocxIn('');
      },
      importXlsx: () => {
        void importBinaryIn('xlsx', '');
      },
      importXmind: () => {
        void importBinaryIn('mindmap', '');
      },
    }),
    [],
  );

  // vault 就绪：拉取页面树 + 绑定 fs:changed / index:statusChanged（幂等，进程内一次）
  useEffect(() => {
    // A vault switch must invalidate all in-flight index/tag responses before loading the new session.
    useIndexStore.getState().reset();
    bindVaultFsEvents();
    bindIndexEvents();
    void usePageTreeStore.getState().load();
    void useIndexStore.getState().loadStatus();
    void useIndexStore.getState().loadTags();
  }, [vault.root]);

  return (
    <div data-smoke-ready="workspace" className="flex h-full w-full flex-col overflow-hidden">
      {/* DEV-084 + DEV-096：顶栏「文件」菜单——把原本散在侧栏的「新建 / 导入」并入此处，
          消除两个并列的下拉箭头。 */}
      <FileMenuBar handlers={fileMenuHandlers} />
      <div className="flex min-h-0 min-w-0 flex-1">
        <Sidebar />
        <main
          data-testid="main-content"
          data-tour="editor"
          className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
        >
          <SplitView />
        </main>
        <DockHost />
      </div>
      <StatusBar />
      {!previewOnly && <WritingAssistantLayer />}
      <PluginHost />
      <GuidedTour />
    </div>
  );
}
