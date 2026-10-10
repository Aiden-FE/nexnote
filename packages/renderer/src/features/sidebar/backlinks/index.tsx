import { openDocumentTab } from '../../../lib/open-document';
import { useEffect } from 'react';
import { Link2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { sidebarPanelRegistry } from '../../../registries';
import { useIndexStore } from '../../../stores/index-store';
import { useTabStore } from '../../../stores/tab-store';
import type { Backlink } from '@nexnote/shared';

/**
 * 反向链接面板（DEV-004 真实数据版）：Link Index 驱动。
 * 点击条目 → 打开来源页面；悬停 title 显示上下文片段。
 */
sidebarPanelRegistry.register({
  id: 'backlinks',
  title: 'sidebar.panel.backlinks',
  titleIsKey: true,
  icon: Link2,
  render: BacklinksPanel,
  renderBadge: BacklinksBadge,
});

/** 当前激活页面的反链数量角标；不主动改变侧栏当前面板。 */
export function BacklinksBadge() {
  const t = useI18n();
  const backlinks = useIndexStore((s) => s.backlinks);
  const backlinksFor = useIndexStore((s) => s.backlinksFor);
  const status = useIndexStore((s) => s.backlinksStatus);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activePath = tabs.find((tab) => tab.id === activeTabId)?.pagePath ?? null;

  useEffect(() => {
    if (activePath) useIndexStore.getState().ensureBacklinks(activePath);
    else useIndexStore.getState().clearBacklinks();
  }, [activePath]);

  const count =
    activePath && backlinksFor === activePath && status === 'ready' ? backlinks.length : 0;
  if (count === 0) return null;
  return (
    <span
      data-testid="sidebar-backlink-badge"
      title={t('sidebar.backlinks.badge', { count })}
      className="rounded-full bg-sidebar-accent px-1 text-[10px] leading-4 text-foreground"
    >
      {count}
    </span>
  );
}

function BacklinksPanel() {
  const t = useI18n();
  const backlinks = useIndexStore((s) => s.backlinks);
  const status = useIndexStore((s) => s.backlinksStatus);
  const forPath = useIndexStore((s) => s.backlinksFor);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  // 激活页面变化 → 加载反链（与角标共用 ensure 去重）
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab?.pagePath) useIndexStore.getState().ensureBacklinks(tab.pagePath);
    else useIndexStore.getState().clearBacklinks();
  }, [tabs, activeTabId]);

  const open = (b: Backlink): void => {
    void openDocumentTab(b.fromPath);
  };

  return (
    <div data-testid="sidebar-panel-backlinks" className="flex h-full min-h-0 flex-col">
      <p className="mb-2 shrink-0 text-[10px] text-muted-foreground">
        {t('sidebar.backlinks.subtitle')}
        {status === 'loading' && t('sidebar.backlinks.updating')}
        {forPath && status === 'ready' && t('sidebar.backlinks.count', { count: backlinks.length })}
      </p>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto">
        {status === 'error' && (
          <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {t('sidebar.backlinks.indexUnavailable')}
          </p>
        )}
        {status === 'ready' && backlinks.length === 0 && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('sidebar.backlinks.empty')}
          </p>
        )}
        {backlinks.map((b, i) => (
          <button
            key={`${b.fromPath}-${i}`}
            type="button"
            data-testid="backlink-item"
            onClick={() => open(b)}
            title={b.snippet || b.fromPath}
            className="w-full rounded-md border bg-card px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent"
          >
            <p className="mb-1 truncate font-medium text-foreground">{b.fromTitle || b.fromPath}</p>
            {b.snippet && (
              <p className="line-clamp-2 leading-relaxed text-muted-foreground">{b.snippet}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
