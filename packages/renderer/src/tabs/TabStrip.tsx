import { useRef, useState } from 'react';
import { FileText, FileType2, FolderOpen, Home, Network, Plus, Settings, X } from 'lucide-react';
import { useTabStore, type TabKind } from '../stores/tab-store';
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu';
import { invoke } from '../lib/ipc';
import { useVault } from '../shell/vault-context';
import { cn } from '../lib/utils';

const kindIcon: Record<TabKind, typeof Home> = {
  welcome: Home,
  page: FileText,
  docx: FileType2,
  files: FolderOpen,
  graph: Network,
  settings: Settings,
};

/** 拖拽悬停插入反馈：目标 tab 与前/后侧。 */
interface DropHint {
  tabId: string;
  side: 'before' | 'after';
}

/** 单 tab 栈的标签栏：打开/关闭/激活/中键关闭/新建 + 右键菜单（DEV-003）+ 拖拽排序（DEV-022）。 */
export function TabStrip() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const vault = useVault();
  const { setActiveTab, closeTab, openTab, reorderTab } = useTabStore.getState();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  // HTML5 拖拽源（同一 tab 栈内重排）。dataTransfer 仅作协议 setData，真相在本组件 state。
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const clearDragState = (): void => {
    setDraggingTabId(null);
    setDropHint(null);
  };

  const onTabDragStart = (e: React.DragEvent, tabId: string): void => {
    // 真实 Chromium 提供 dataTransfer；测试环境（happy-dom）可能缺失，state 才是唯一真相。
    e.dataTransfer?.setData('text/plain', tabId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    setDraggingTabId(tabId);
  };

  const onTabDragOver = (e: React.DragEvent, tabId: string): void => {
    // 仅响应本栈页签拖拽源；外部拖入（文件/树节点）不重排。
    if (!draggingTabId || draggingTabId === tabId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const side: DropHint['side'] = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
    setDropHint((prev) => (prev?.tabId === tabId && prev.side === side ? prev : { tabId, side }));
  };

  const onTabDrop = (e: React.DragEvent, tabId: string): void => {
    if (!draggingTabId || draggingTabId === tabId) {
      clearDragState();
      return;
    }
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const side: DropHint['side'] = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
    const targetIndex = tabs.findIndex((t) => t.id === tabId);
    if (targetIndex >= 0) {
      reorderTab(draggingTabId, side === 'before' ? targetIndex : targetIndex + 1);
    }
    clearDragState();
  };

  /** 溢出滚动下拖到边缘自动滚动（验收：视野外目标位置可达）。 */
  const onStripDragOver = (e: React.DragEvent): void => {
    if (!draggingTabId) return;
    e.preventDefault();
    const strip = stripRef.current;
    if (!strip) return;
    const rect = strip.getBoundingClientRect();
    const edge = 32;
    if (e.clientX - rect.left < edge) strip.scrollLeft -= 12;
    else if (rect.right - e.clientX < edge) strip.scrollLeft += 12;
  };

  const openTabMenu = (e: React.MouseEvent, tabId: string): void => {
    e.preventDefault();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const store = useTabStore.getState();
    const idx = tabs.findIndex((t) => t.id === tabId);
    const pagePath = tab.pagePath ?? null;
    const absPath = pagePath && vault ? `${vault.root}/${pagePath}` : null;
    const items: ContextMenuItem[] = [
      { label: '关闭', hint: '⌘W', onSelect: () => store.closeTab(tabId) },
      {
        label: '关闭其他',
        disabled: tabs.length <= 1,
        onSelect: () => store.closeOtherTabs(tabId),
      },
      {
        label: '关闭右侧',
        disabled: idx >= tabs.length - 1,
        onSelect: () => store.closeTabsToRight(tabId),
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
      ref={stripRef}
      data-testid="tabstrip"
      role="tablist"
      aria-label="页面标签"
      onDragOver={onStripDragOver}
      onDrop={(e) => {
        if (draggingTabId) {
          e.preventDefault();
          clearDragState();
        }
      }}
      onDragEnd={clearDragState}
      className="flex h-9 shrink-0 items-stretch gap-px overflow-x-auto border-b px-1 pt-1"
    >
      {tabs.map((tab) => {
        const Icon = kindIcon[tab.kind] ?? FileText;
        const isActive = activeTabId === tab.id;
        const hintForTab = dropHint?.tabId === tab.id ? dropHint : null;
        return (
          <div
            key={tab.id}
            data-testid="tab"
            data-active={isActive}
            data-page-path={tab.pagePath ?? undefined}
            data-tab-identity={tab.pagePath ?? `kind:${tab.kind}`}
            data-editor-mode={tab.editorMode ?? 'block'}
            data-drop-indicator={hintForTab?.side ?? undefined}
            data-dragging={draggingTabId === tab.id || undefined}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            draggable
            onDragStart={(e) => onTabDragStart(e, tab.id)}
            onDragOver={(e) => onTabDragOver(e, tab.id)}
            onDragLeave={() => setDropHint((prev) => (prev?.tabId === tab.id ? null : prev))}
            onDrop={(e) => onTabDrop(e, tab.id)}
            onClick={() => setActiveTab(tab.id)}
            onContextMenu={(e) => openTabMenu(e, tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(tab.id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setActiveTab(tab.id);
            }}
            className={cn(
              'group flex min-w-0 max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1 text-xs',
              isActive
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent/50',
              hintForTab?.side === 'before' && 'border-l-2 border-l-primary',
              hintForTab?.side === 'after' && 'border-r-2 border-r-primary',
            )}
            title={tab.title}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{tab.title}</span>
            <button
              type="button"
              aria-label={`关闭 ${tab.title}`}
              draggable={false}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
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
        draggable={false}
        onClick={() => openTab({ kind: 'page', title: '未命名页面' })}
        className="my-auto ml-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>

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
