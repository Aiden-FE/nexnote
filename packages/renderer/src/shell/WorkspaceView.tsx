import type { MenuAction, VaultInfo } from '@nexnote/shared';
import { useEffect } from 'react';
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
import { onEvent } from '../lib/ipc';
import {
  createNoteIn,
  createBinaryIn,
  importDocxIn,
  importBinaryIn,
} from '../features/sidebar/page-tree/ops';

/** DEV-096：原生菜单动作分发到渲染层 ops。 */
function handleMenuAction(action: MenuAction): void {
  switch (action.type) {
    case 'createNote':
      void createNoteIn('', action.format);
      break;
    case 'createBlankBinary':
      void createBinaryIn(action.kind === 'xmind' ? 'mindmap' : action.kind, '');
      break;
    case 'importDocx':
      void importDocxIn('');
      break;
    case 'importXlsx':
      void importBinaryIn('xlsx', '');
      break;
    case 'importXmind':
      void importBinaryIn('mindmap', '');
      break;
  }
}

/** 工作区：三面板（侧栏 + 主内容 + 右侧 dock）+ 底部状态栏。 */
export function WorkspaceView({ vault }: { vault: VaultInfo }) {
  useVaultLayoutPersistence(vault);
  const previewOnly = useTabStore((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
    return tab?.format === 'markdown' && (tab.markdownView ?? 'split') === 'preview';
  });

  // DEV-096：监听原生应用菜单动作（macOS 系统菜单栏 → main → renderer）。
  useEffect(() => onEvent('menu:action', handleMenuAction), []);

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
