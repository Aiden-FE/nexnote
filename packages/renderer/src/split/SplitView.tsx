import { useEffect } from 'react';
import { TabStrip } from '../tabs/TabStrip';
import { useTabStore, type TabDescriptor } from '../stores/tab-store';
import { WelcomePage } from '../pages/WelcomePage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { FilesPage } from '../pages/FilesPage';
import { SettingsPage } from '../pages/SettingsPage';
import { DocxView } from '../pages/DocxView';
import { EditorView } from '../editor/EditorView';
import { SourceModeView } from '../editor/source/SourceModeView';
import { GlobalGraphView } from '../features/graph/GlobalGraphView';

/** 页面 tab：持久格式决定编辑器；Markdown 永远不挂载 TipTap。 */
function PageEditorHost({ tab }: { tab: TabDescriptor }) {
  useEffect(() => {
    if (tab.format === 'native-block' && tab.editorMode === 'source') {
      useTabStore.getState().toggleSourceMode(tab.id, false);
    }
  }, [tab.format, tab.editorMode, tab.id]);
  if (tab.format === 'markdown') return <SourceModeView key={tab.id} tab={tab} />;
  return <EditorView key={tab.id} tab={tab} />;
}

function TabContent({ tab }: { tab: TabDescriptor }) {
  switch (tab.kind) {
    case 'welcome':
      return <WelcomePage />;
    case 'files':
      return <FilesPage />;
    case 'graph':
      return <GlobalGraphView />;
    case 'settings':
      return <SettingsPage />;
    case 'page':
      return <PageEditorHost key={tab.id} tab={tab} />;
    case 'docx':
      return <DocxView key={tab.id} tab={tab} />;
    default:
      return <PlaceholderPage title={tab.title} />;
  }
}

/** 主内容区只有一个 tab 栈。源码模式的双列布局在页面 tab 内部实现。 */
export function SplitView() {
  const tabs = useTabStore((state) => state.tabs);
  const activeTabId = useTabStore((state) => state.activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  return (
    <section
      data-testid="workspace-tabs"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <TabStrip />
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab ? (
          <TabContent tab={activeTab} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            没有打开的页面
          </div>
        )}
      </div>
    </section>
  );
}
