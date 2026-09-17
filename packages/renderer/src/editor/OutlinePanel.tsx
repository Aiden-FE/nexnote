import { useEffect, useRef, useState } from 'react';
import { ListTree, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { OutlineEntry } from './outline';

export interface OutlinePanelProps {
  entries: OutlineEntry[];
  onNavigate: (entry: OutlineEntry) => void;
  onClose: () => void;
  className?: string;
}

/**
 * 运行时悬浮目录：只消费标题模型并回调定位，不向正文注入锚点、不写盘。
 * 顶栏左侧图标是展开/收缩开关（DEV-048）：收缩后仅保留小图标按钮，避免遮挡正文；
 * 右侧关闭按钮仍是彻底隐藏面板。收缩/展开切换时焦点移到对侧按钮，键盘不落回 body。
 */
export function OutlinePanel({ entries, onNavigate, onClose, className }: OutlinePanelProps) {
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
        aria-label="悬浮目录"
        className={cn('rounded-lg border bg-popover/95 shadow-lg backdrop-blur', className)}
      >
        <button
          ref={expandRef}
          type="button"
          data-testid="outline-expand"
          aria-label="展开悬浮目录"
          aria-expanded="false"
          title="展开悬浮目录"
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
      aria-label="悬浮目录"
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
          aria-label="收起悬浮目录"
          aria-expanded="true"
          title="收起悬浮目录"
          onClick={() => toggleCollapsed(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ListTree className="size-3.5" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1">悬浮目录</span>
        <button
          type="button"
          aria-label="关闭悬浮目录"
          data-testid="outline-close"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <nav className="max-h-[min(60vh,32rem)] overflow-auto p-1.5" aria-label="标题列表">
        {entries.length === 0 ? (
          <p
            data-testid="outline-empty"
            className="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            暂无标题
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
                title={entry.text || '未命名标题'}
                style={{ paddingLeft: `${8 + (entry.level - 1) * 12}px` }}
                onClick={() => {
                  setActiveId(entry.id);
                  onNavigate(entry);
                }}
                className={cn(
                  'block w-full truncate rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
                  active && 'bg-accent font-medium text-foreground',
                )}
              >
                {entry.text || '未命名标题'}
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
}
