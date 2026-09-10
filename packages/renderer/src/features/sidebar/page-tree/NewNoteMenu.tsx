import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FilePlus2, FileType2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { NewNoteFormat } from './ops';

interface NewNoteMenuItem {
  format: NewNoteFormat;
  /** 格式徽标短字：块 / MD */
  badge: string;
  badgeClass: string;
  label: string;
  /** 悬停说明：解释与另一格式的差异 */
  description: string;
}

const ITEMS: NewNoteMenuItem[] = [
  {
    format: 'native-block',
    badge: '块',
    badgeClass: 'bg-primary/15 text-primary',
    label: '新建文档（块编辑）',
    description: '所见即所得的块编辑体验（默认）',
  },
  {
    format: 'markdown',
    badge: 'MD',
    badgeClass: 'bg-muted text-muted-foreground',
    label: '新建 Markdown（源码模式）',
    description: '编辑 Markdown 源码，右侧实时预览',
  },
];

interface NewNoteMenuProps {
  /** 按所选格式新建（两种格式都写纯标准 Markdown，format 持久化到 sidecar）。 */
  onCreate(format: NewNoteFormat): void;
  /** 经主进程文件选择器导入 DOCX 原件。 */
  onImportDocx(): void;
}

/**
 * 「新建」下拉按钮：主按钮保持原单一按钮行为（默认格式直接新建），箭头展开格式菜单。
 * 键盘：↑/↓ 打开并在项间移动，Enter 选中，Esc/Tab 关闭（Esc 后焦点回到触发按钮）。
 */
export function NewNoteMenu({ onCreate, onImportDocx }: NewNoteMenuProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const openMenu = (): void => {
    const rect = wrapRef.current?.getBoundingClientRect();
    setAnchor({ x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4 });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onResize = (): void => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const focusItem = (index: number): void => {
    const n = ITEMS.length;
    itemRefs.current[((index % n) + n) % n]?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(current + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(ITEMS.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="flex items-center">
      <button
        type="button"
        data-testid="tree-new-note"
        title="新建文档（块编辑）"
        aria-label="新建文档（块编辑）"
        onClick={() => onCreate('native-block')}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <FilePlus2 className="size-3.5" />
      </button>
      <button
        ref={triggerRef}
        type="button"
        data-testid="tree-new-note-menu"
        title="选择文档格式"
        aria-label="选择文档格式"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openMenu();
          }
        }}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="新建文档格式"
          data-testid="new-note-menu"
          style={{ left: Math.min(anchor.x, Math.max(8, window.innerWidth - 240)), top: anchor.y }}
          onKeyDown={onMenuKeyDown}
          className="fixed z-50 w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {ITEMS.map((item, i) => (
            <button
              key={item.format}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              data-testid={`new-note-${item.format}`}
              title={`${item.label}——${item.description}`}
              onClick={() => {
                onCreate(item.format);
                close(true);
              }}
              className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 inline-flex w-7 shrink-0 items-center justify-center rounded px-1 py-0.5 text-[10px] font-medium',
                  item.badgeClass,
                )}
              >
                {item.badge}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{item.label}</span>
                <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </button>
          ))}
          <div className="my-1 border-t" />
          <button
            type="button"
            role="menuitem"
            data-testid="new-note-docx"
            title="导入 DOCX——原件只读，编辑时创建 Markdown 副本"
            onClick={() => {
              onImportDocx();
              close(true);
            }}
            className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex w-7 shrink-0 items-center justify-center rounded bg-muted px-1 py-0.5 text-muted-foreground"
            >
              <FileType2 className="size-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs">导入 DOCX</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                原件只读，编辑时创建 Markdown 副本
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
