import { useCallback, useRef } from 'react';
import { TabStrip } from '../tabs/TabStrip';
import { useTabStore, type PaneId } from '../stores/tab-store';
import { WelcomePage } from '../pages/WelcomePage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { FilesPage } from '../pages/FilesPage';
import { EditorView } from '../editor/EditorView';
import type { TabDescriptor } from '../stores/tab-store';
import { cn } from '../lib/utils';

function TabContent({ paneId, tab }: { paneId: PaneId; tab: TabDescriptor }) {
  switch (tab.kind) {
    case 'welcome':
      return <WelcomePage />;
    case 'files':
      return <FilesPage />;
    case 'page':
      return <EditorView key={tab.pagePath ?? tab.id} paneId={paneId} tab={tab} />;
    default:
      return <PlaceholderPage title={tab.title} />;
  }
}

function PaneView({ paneId }: { paneId: PaneId }) {
  const pane = useTabStore((s) => s.panes[paneId]);
  const activePaneId = useTabStore((s) => s.activePaneId);
  const setActivePane = useTabStore((s) => s.setActivePane);
  const activeTab = pane?.tabs.find((t) => t.id === pane.activeTabId) ?? null;
  if (!pane) return null;

  return (
    <section
      data-testid={`pane-${paneId}`}
      data-focused={activePaneId === paneId}
      onPointerDown={() => setActivePane(paneId)}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col bg-background',
        paneId === 'right' && activePaneId === 'right' && 'ring-1 ring-inset ring-ring/20',
      )}
    >
      <TabStrip paneId={paneId} />
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab ? <TabContent paneId={paneId} tab={activeTab} /> : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            此 pane 没有打开的页面
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 主内容区：左右分屏（各一个 pane，一个 pane 一个 tab stack），分隔线可拖拽、双击收起分屏。
 */
export function SplitView() {
  const splitEnabled = useTabStore((s) => s.splitEnabled);
  const splitRatio = useTabStore((s) => s.splitRatio);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startRatio = useTabStore.getState().splitRatio;
    const totalWidth = container.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => {
      const next = startRatio + (ev.clientX - startX) / totalWidth;
      useTabStore.getState().setSplitRatio(next);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }, []);

  if (!splitEnabled) {
    return (
      <div data-testid="split-view" data-split="off" className="flex min-h-0 min-w-0 flex-1">
        <PaneView paneId="left" />
      </div>
    );
  }

  return (
    <div ref={containerRef} data-testid="split-view" data-split="on" className="flex min-h-0 min-w-0 flex-1">
      <div style={{ width: `${splitRatio * 100}%` }} className="flex min-w-0">
        <PaneView paneId="left" />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        data-testid="split-divider"
        onPointerDown={onDividerPointerDown}
        onDoubleClick={() => useTabStore.getState().toggleSplit(false)}
        title="拖拽调整分屏比例 · 双击收起分屏"
        className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
      />
      <div className="flex min-w-0 flex-1">
        <PaneView paneId="right" />
      </div>
    </div>
  );
}
