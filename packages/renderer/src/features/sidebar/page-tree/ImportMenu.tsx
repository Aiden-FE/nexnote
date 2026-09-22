import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';

type ImportKind = 'docx' | 'xlsx' | 'xmind';

interface ImportMenuItem {
  kind: ImportKind;
  /** 格式徽标：DOCX / XLSX / XMIND */
  badge: string;
  label: string;
  description: string;
}

const ITEMS: ImportMenuItem[] = [
  {
    kind: 'docx',
    badge: 'DOCX',
    label: '导入 DOCX',
    description: '语义级往返：段落/标题/加粗斜体/表格/字体色/对齐保留；页眉页脚、编号样式、上下标不保留',
  },
  {
    kind: 'xlsx',
    badge: 'XLSX',
    label: '导入 XLSX',
    description: '多 sheet、公式、合并单元格可编辑；宏/图表/透视表只读标注',
  },
  {
    kind: 'xmind',
    badge: 'XMIND',
    label: '导入 XMIND',
    description: '文本/树结构/备注/超链接/标签/概要可编辑；外框/关联线只读标注',
  },
];

interface ImportMenuProps {
  /** 按所选 kind 触发对应导入（docx/xlsx/xmind）。 */
  onImport(kind: ImportKind): void;
}

/**
 * 「导入」下拉按钮：与「新建」并列于页面树工具栏右侧。
 * 键盘：↑/↓ 打开并在项间移动，Enter 选中，Esc/Tab 关闭。
 */
export function ImportMenu({ onImport }: ImportMenuProps) {
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
        ref={triggerRef}
        type="button"
        data-testid="tree-import-menu"
        title="导入文档"
        aria-label="导入文档"
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
          aria-label="导入文档"
          data-testid="import-menu"
          style={{ left: Math.min(anchor.x, Math.max(8, window.innerWidth - 240)), top: anchor.y }}
          onKeyDown={onMenuKeyDown}
          className="fixed z-50 w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {ITEMS.map((item, i) => (
            <button
              key={item.kind}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              data-testid={`import-${item.kind}`}
              title={`${item.label}——${item.description}`}
              onClick={() => {
                onImport(item.kind);
                close(true);
              }}
              className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 inline-flex w-9 shrink-0 items-center justify-center rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground',
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
        </div>
      )}
    </div>
  );
}
