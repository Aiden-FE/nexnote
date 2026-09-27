import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FilePlus2 } from 'lucide-react';
import { cn } from '../../../lib/utils';

/** DEV-084：新建菜单支持的格式（连同 DEV-074 的二进制创建）。 */
type NewNoteKind =
  | { kind: 'note'; format: 'native-block' }
  | { kind: 'note'; format: 'markdown' }
  | { kind: 'binary'; binary: 'docx' }
  | { kind: 'binary'; binary: 'xlsx' }
  | { kind: 'binary'; binary: 'xmind' };

interface NewNoteMenuProps {
  /** 按所选格式新建（Markdown / native-block / 空白 docx/xlsx/xmind）。 */
  onPick(item: NewNoteKind): void;
}

/**
 * 「新建」下拉按钮（DEV-084 + DEV-096）：
 * - 与「导入」并列的「导入」下拉已撤掉，导入入口统一在顶栏「文件」菜单；
 * - 主按钮直接创建块编辑笔记（默认格式），箭头展开格式菜单（含空白 docx/xlsx/xmind）；
 * - 键盘：↑/↓ 打开并在项间移动，Enter 选中，Esc/Tab 关闭。
 */
export function NewNoteMenu({ onPick }: NewNoteMenuProps) {
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
        onClick={() => onPick({ kind: 'note', format: 'native-block' })}
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
              key={item.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              data-testid={item.testId}
              title={`${item.label}——${item.description}`}
              onClick={() => {
                onPick(item.value);
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
        </div>
      )}
    </div>
  );
}

interface MenuItem {
  badge: string;
  badgeClass: string;
  label: string;
  description: string;
  testId: string;
  value: NewNoteKind;
}

const ITEMS: MenuItem[] = [
  {
    badge: '块',
    badgeClass: 'bg-primary/15 text-primary',
    label: '新建文档（块编辑）',
    description: '所见即所得的块编辑体验（默认）',
    testId: 'new-note-native-block',
    value: { kind: 'note', format: 'native-block' },
  },
  {
    badge: 'MD',
    badgeClass: 'bg-muted text-muted-foreground',
    label: '新建 Markdown（源码模式）',
    description: '编辑 Markdown 源码，右侧实时预览',
    testId: 'new-note-markdown',
    value: { kind: 'note', format: 'markdown' },
  },
  {
    badge: 'DOCX',
    badgeClass: 'bg-muted text-muted-foreground',
    label: '新建空白 DOCX',
    description: '在 vault 内创建空白 .docx 并打开编辑器',
    testId: 'new-note-docx',
    value: { kind: 'binary', binary: 'docx' },
  },
  {
    badge: 'XLSX',
    badgeClass: 'bg-muted text-muted-foreground',
    label: '新建空白 XLSX',
    description: '在 vault 内创建空白 .xlsx 并打开表格编辑器',
    testId: 'new-note-xlsx',
    value: { kind: 'binary', binary: 'xlsx' },
  },
  {
    badge: 'XMIND',
    badgeClass: 'bg-muted text-muted-foreground',
    label: '新建空白 XMind',
    description: '在 vault 内创建空白 .xmind 并打开思维导图',
    testId: 'new-note-xmind',
    value: { kind: 'binary', binary: 'xmind' },
  },
];
