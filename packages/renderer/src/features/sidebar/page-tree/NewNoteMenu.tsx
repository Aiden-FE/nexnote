import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FilePlus2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useI18n } from '../../../lib/i18n';

/** DEV-084（DEV-098 撤销 docx 新建后仅 xlsx / xmind）。 */
type NewNoteKind =
  | { kind: 'note'; format: 'native-block' }
  | { kind: 'note'; format: 'markdown' }
  | { kind: 'binary'; binary: 'xlsx' }
  | { kind: 'binary'; binary: 'xmind' };

interface NewNoteMenuProps {
  /** 按所选格式新建（Markdown / native-block / 空白 xlsx/xmind）。 */
  onPick(item: NewNoteKind): void;
}

/**
 * 「新建」下拉按钮（DEV-084 + DEV-096）：
 * - 与「导入」并列的「导入」下拉已撤掉，导入入口统一在顶栏「文件」菜单；
 * - 主按钮直接创建块编辑笔记（默认格式），箭头展开格式菜单（含空白 xlsx/xmind）；
 * - 键盘：↑/↓ 打开并在项间移动，Enter 选中，Esc/Tab 关闭。
 */
export function NewNoteMenu({ onPick }: NewNoteMenuProps) {
  const t = useI18n();
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
        title={t('sidebar.newMenu.newBlockShort')}
        aria-label={t('sidebar.newMenu.newBlockShort')}
        onClick={() => onPick({ kind: 'note', format: 'native-block' })}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <FilePlus2 className="size-3.5" />
      </button>
      <button
        ref={triggerRef}
        type="button"
        data-testid="tree-new-note-menu"
        title={t('sidebar.newMenu.chooseFormat')}
        aria-label={t('sidebar.newMenu.chooseFormat')}
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
          aria-label={t('sidebar.newMenu.menuLabel')}
          data-testid="new-note-menu"
          style={{ left: Math.min(anchor.x, Math.max(8, window.innerWidth - 240)), top: anchor.y }}
          onKeyDown={onMenuKeyDown}
          className="fixed z-50 w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {ITEMS.map((item, i) => {
            const label = t(item.labelKey);
            const description = t(item.descriptionKey);
            const badge =
              item.badge === 'MD' || item.badge === 'XLSX' || item.badge === 'XMIND'
                ? item.badge
                : t('sidebar.pageTree.blockBadge');
            return (
              <button
                key={item.labelKey}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                data-testid={item.testId}
                title={`${label} — ${description}`}
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
                  {badge}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{label}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    {description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface MenuItem {
  badge: string;
  badgeClass: string;
  labelKey: string;
  descriptionKey: string;
  testId: string;
  value: NewNoteKind;
}

const ITEMS: MenuItem[] = [
  {
    badge: 'sidebar.newMenu.newBlockBadge',
    badgeClass: 'bg-primary/15 text-primary',
    labelKey: 'sidebar.newMenu.newBlock',
    descriptionKey: 'sidebar.newMenu.newBlock.description',
    testId: 'new-note-native-block',
    value: { kind: 'note', format: 'native-block' },
  },
  {
    badge: 'MD',
    badgeClass: 'bg-muted text-muted-foreground',
    labelKey: 'sidebar.newMenu.newMarkdown',
    descriptionKey: 'sidebar.newMenu.newMarkdown.description',
    testId: 'new-note-markdown',
    value: { kind: 'note', format: 'markdown' },
  },
  {
    badge: 'XLSX',
    badgeClass: 'bg-muted text-muted-foreground',
    labelKey: 'sidebar.newMenu.newXlsx',
    descriptionKey: 'sidebar.newMenu.newXlsx.description',
    testId: 'new-note-xlsx',
    value: { kind: 'binary', binary: 'xlsx' },
  },
  {
    badge: 'XMIND',
    badgeClass: 'bg-muted text-muted-foreground',
    labelKey: 'sidebar.newMenu.newXmind',
    descriptionKey: 'sidebar.newMenu.newXmind.description',
    testId: 'new-note-xmind',
    value: { kind: 'binary', binary: 'xmind' },
  },
];
