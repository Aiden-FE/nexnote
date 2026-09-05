import type { VaultInfo } from '@nexnote/shared';
import { Sidebar } from './Sidebar';
import { DockHost } from './DockHost';
import { StatusBar } from './StatusBar';
import { SplitView } from '../split/SplitView';
import { useVaultLayoutPersistence } from './layout-persistence';

/** 工作区：三面板（侧栏 + 主内容 + 右侧 dock）+ 底部状态栏。 */
export function WorkspaceView({ vault }: { vault: VaultInfo }) {
  useVaultLayoutPersistence(vault);

  return (
    <div data-smoke-ready="workspace" className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1">
        <Sidebar />
        <main data-testid="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <SplitView />
        </main>
        <DockHost />
      </div>
      <StatusBar />
    </div>
  );
}
