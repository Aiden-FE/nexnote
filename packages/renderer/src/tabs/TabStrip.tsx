import { useState } from 'react';
import { FileText, FolderOpen, Home, Network, Plus, Settings, X } from 'lucide-react';
import { useTabStore, type PaneId, type TabKind } from '../stores/tab-store';
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu';
import { invoke } from '../lib/ipc';
import { useVault } from '../shell/vault-context';
import { cn } from '../lib/utils';

const kindIcon: Record<TabKind, typeof Home> = {
  welcome: Home,
  page: FileText,
  files: FolderOpen,
  graph: Network,
  settings: Settings,
};

interface TabStripProps {
  paneId: PaneId;
}

/** 单个 pane 的标签栏：打开/关闭/激活/中键关闭/新建 + 右键菜单（DEV-003）。 */
export function TabStrip({ paneId }: TabStripProps) {
  const pane = useTabStore((s) => s.panes[paneId]);
  const activePaneId = useTabStore((s) => s.activePaneId);
  const vault = useVault();
  const { setActiveTab, closeTab, openTab, setActivePane } = useTabStore.getState();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  if (!pane) return null;

  const isFocused = activePaneId === paneId;
  const isActivePanePopulated = pane.tabs.length > 0;

  const openTabMenu = (e: React.MouseEvent, tabId: string): void => {
    e.preventDefault();
    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const store = useTabStore.getState();
    const idx = pane.tabs.findIndex((t) => t.id === tabId);
    const pagePath = tab.pagePath ?? null;
    const absPath = pagePath && vault ? `${vault.root}/${pagePath}` : null;
    const items: ContextMenuItem[] = [
      { label: '关闭', hint: '⌘W', onSelect: () => store.closeTab(paneId, tabId) },
      {
        label: '关闭其他',
        disabled: pane.tabs.length <= 1,
        onSelect: () => store.closeOtherTabs(paneId, tabId),
      },
      {
        label: '关闭右侧',
        disabled: idx >= pane.tabs.length - 1,
        onSelect: () => store.closeTabsToRight(paneId, tabId),
      },
    ];
    if (pagePath) {
      items.push(
        { kind: 'separator' },
        {
          label: '在 Finder 中显示',
          onSelect: () =>
            void invoke('fs:revealInFinder', { path: pagePath }).catch(() => undefined),
        },
        {
          label: '复制路径',
          hint: '绝对路径',
          onSelect: () => {
            if (absPath) void navigator.clipboard.writeText(absPath).catch(() => undefined);
          },
        },
      );
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <div
      data-testid="tabstrip"
      data-pane={paneId}
      onPointerDown={() => setActivePane(paneId)}
      className={cn(
        'flex h-9 shrink-0 items-stretch gap-px border-b px-1 pt-1',
        isFocused ? 'bg-muted/50' : 'bg-muted/25',
      )}
    >
      {pane.tabs.map((tab) => {
        const Icon = kindIcon[tab.kind] ?? FileText;
        const isActive = pane.activeTabId === tab.id;
        return (
          <div
            key={tab.id}
            data-testid="tab"
            data-active={isActive}
            data-page-path={tab.pagePath ?? undefined}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onClick={() => setActiveTab(paneId, tab.id)}
            onContextMenu={(e) => openTabMenu(e, tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(paneId, tab.id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setActiveTab(paneId, tab.id);
            }}
            className={cn(
              'group flex min-w-0 max-w-[200px] cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1 text-xs',
              isActive
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent/50',
            )}
            title={tab.title}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{tab.title}</span>
            <button
              type="button"
              aria-label={`关闭 ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(paneId, tab.id);
              }}
              className="ml-0.5 hidden rounded p-0.5 hover:bg-accent group-hover:block"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        data-testid="new-tab"
        aria-label="新建标签页"
        title="新建标签页"
        onClick={() => openTab(paneId, { kind: 'page', title: `未命名页面` })}
        className="my-auto ml-1 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>

      {!isActivePanePopulated && (
        <span className="my-auto ml-2 text-[11px] text-muted-foreground/70">空 pane — 点击 + 新建</span>
      )}

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
        testId="tab-context-menu"
      />
    </div>
  );
}
