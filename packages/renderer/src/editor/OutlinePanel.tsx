import { useEffect, useRef, useState } from 'react';
import { ChevronsDown, ListTree, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import type { OutlineEntry } from './outline';

export interface OutlinePanelProps {
  entries: OutlineEntry[];
  onNavigate: (entry: OutlineEntry) => void;
  onExpandAll: () => void;
  onClose: () => void;
  className?: string;
}

/**
 * 运行时悬浮目录：只消费标题模型并回调定位，不向正文注入锚点、不写盘。
 * 顶栏左侧图标是展开/收缩开关（DEV-048）：收缩后仅保留小图标按钮，避免遮挡正文；
 * 右侧关闭按钮仍是彻底隐藏面板。收缩/展开切换时焦点移到对侧按钮，键盘不落回 body。
 */
export function OutlinePanel({
  entries,
  onNavigate,
  onExpandAll,
  onClose,
  className,
}: OutlinePanelProps) {
  const t = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const expandRef = useRef<HTMLButtonElement | null>(null);
  const userToggledRef = useRef(false);

  useEffect(() => {
    if (!userToggledRef.current) return;
    (collapsed ? expandRef.current : toggleRef.current)?.focus();
  }, [collapsed]);

  const toggleCollapsed = (next: boolean): void => {
    userToggledRef.current = true;
    setCollapsed(next);
  };

  if (collapsed) {
    return (
      <aside
        data-testid="outline-panel"
        data-collapsed="true"
        aria-label={t('outline.title')}
        className={cn('rounded-lg border bg-popover/95 shadow-lg backdrop-blur', className)}
      >
        <button
          ref={expandRef}
          type="button"
          data-testid="outline-expand"
          aria-label={t('outline.expand')}
          aria-expanded="false"
          title={t('outline.expand')}
          onClick={() => toggleCollapsed(false)}
          className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ListTree className="size-4" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-testid="outline-panel"
      aria-label={t('outline.title')}
      className={cn(
        'w-60 overflow-hidden rounded-lg border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur',
        className,
      )}
    >
      <div className="flex h-9 items-center gap-2 border-b px-3 text-xs font-medium">
        <button
          ref={toggleRef}
          type="button"
          data-testid="outline-toggle"
          aria-label={t('outline.collapse')}
          aria-expanded="true"
          title={t('outline.collapse')}
          onClick={() => toggleCollapsed(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ListTree className="size-3.5" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1">{t('outline.title')}</span>
        <button
          type="button"
          aria-label={t('outline.expandAll')}
          title={t('outline.expandAll')}
          data-testid="outline-expand-all"
          onClick={onExpandAll}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronsDown className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t('outline.close')}
          data-testid="outline-close"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <nav
        className="max-h-[min(60vh,32rem)] overflow-auto p-1.5"
        aria-label={t('outline.headingList')}
      >
        {entries.length === 0 ? (
          <p
            data-testid="outline-empty"
            className="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            {t('outline.empty')}
          </p>
        ) : (
          entries.map((entry) => {
            const active = entry.id === activeId;
            return (
              <button
                key={`${entry.id}-${entry.ordinal}`}
                type="button"
                data-testid={`outline-entry-${entry.id}`}
                data-active={active ? 'true' : undefined}
                title={entry.text || t('outline.untitled')}
                style={{ paddingLeft: `${8 + (entry.level - 1) * 12}px` }}
                onClick={() => {
                  setActiveId(entry.id);
                  onNavigate(entry);
                }}
                aria-current={active ? 'location' : undefined}
                className={cn(
                  'block w-full truncate rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
                  active && 'bg-accent font-medium text-foreground',
                )}
              >
                {entry.text || t('outline.untitled')}
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
}
