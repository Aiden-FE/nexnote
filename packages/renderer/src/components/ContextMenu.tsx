import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/utils';

export interface ContextMenuItem {
  kind?: 'item' | 'separator';
  label?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** 分组渲染内容（如 inline 重命名输入框），与 label 互斥 */
  render?: () => ReactNode;
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  testId?: string;
}

/**
 * 受控右键菜单（fixed 定位，自动防溢出；Esc/点击外部/滚动关闭）。
 * 页面树与 Tab 右键菜单共用（DEV-003）。
 */
export function ContextMenu({ open, x, y, items, onClose, testId }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer, true);
    window.addEventListener('contextmenu', onPointer, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer, true);
      window.removeEventListener('contextmenu', onPointer, true);
      window.removeEventListener('resize', onClose);
    };
  }, [open, onClose]);

  if (!open) return null;

  // 防溢出：粗略按 240x(items*30) 估算，超出视口时向内偏移
  const estHeight = items.length * 30 + 12;
  const left = Math.min(x, Math.max(8, window.innerWidth - 250));
  const top = Math.min(y, Math.max(8, window.innerHeight - estHeight - 8));

  return (
    <div
      ref={ref}
      data-testid={testId}
      role="menu"
      style={{ left, top }}
      className="fixed z-50 min-w-[180px] max-w-[260px] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {items.map((item, i) => {
        if (item.kind === 'separator') {
          return <div key={`sep-${i}`} className="my-1 h-px bg-border" />;
        }
        if (item.render) {
          return (
            <div key={`custom-${i}`} className="px-1.5 py-1">
              {item.render()}
            </div>
          );
        }
        return (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect?.();
              onClose();
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs',
              item.disabled
                ? 'cursor-not-allowed text-muted-foreground/50'
                : item.danger
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'hover:bg-accent',
            )}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && <span className="text-[10px] text-muted-foreground">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
