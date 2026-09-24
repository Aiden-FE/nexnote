import { useEffect } from 'react';
import { invoke } from '../lib/ipc';
import { TabStrip } from '../tabs/TabStrip';
import { useTabStore, isBinaryKind, type TabDescriptor } from '../stores/tab-store';
import { WelcomePage } from '../pages/WelcomePage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { SettingsPage } from '../pages/SettingsPage';
import { BinaryTabView } from '../pages/BinaryTabView';
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
    case 'graph':
      return <GlobalGraphView />;
    case 'settings':
      return <SettingsPage />;
    case 'page':
      return <PageEditorHost key={tab.id} tab={tab} />;
    case 'xlsx':
    case 'mindmap':
      return <BinaryTabView key={tab.id} tab={tab} />;
    case 'docx':
      // DEV-074：docx 改为独立 WebContentsView 宿主（语义级往返），不再用旧只读段落视图。
      return <BinaryTabView key={tab.id} tab={tab} />;
    default:
      return <PlaceholderPage title={tab.title} />;
  }
}

/** 主内容区只有一个 tab 栈。源码模式的双列布局在页面 tab 内部实现。 */
export function SplitView() {
  const tabs = useTabStore((state) => state.tabs);
  const activeTabId = useTabStore((state) => state.activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  // DEV-074：所有 binary tab 都保持稳定位置；只切换 wrapper 的可见性，避免 React 在 active/hidden
  // 两个父树之间搬组件而导致 WebContentsView 反复 close/open。宿主激活只由当前 active tab 驱动。
  const openBinaryTabs = tabs.filter((tab) => isBinaryKind(tab.kind));
  useEffect(() => {
    if (activeTab && isBinaryKind(activeTab.kind) && activeTab.pagePath) {
      void invoke('binary:host:setActive', {
        kind: activeTab.kind,
        path: activeTab.pagePath,
      }).catch(() => undefined);
    } else {
      void invoke('binary:host:setActive', null).catch(() => undefined);
    }
  }, [activeTab]);

  return (
    <section
      data-testid="workspace-tabs"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <TabStrip />
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab && !isBinaryKind(activeTab.kind) ? (
          <TabContent tab={activeTab} />
        ) : activeTab ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {activeTab.title}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            没有打开的页面
          </div>
        )}
        {openBinaryTabs.map((tab) => (
          <div
            key={tab.id}
            data-testid={`binary-host-container-${tab.kind}`}
            className={tab.id === activeTab?.id ? 'h-full min-h-0' : 'hidden'}
          >
            <BinaryTabView tab={tab} />
          </div>
        ))}
      </div>
    </section>
  );
}
