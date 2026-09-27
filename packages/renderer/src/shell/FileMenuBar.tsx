import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * 应用顶栏「文件」菜单（DEV-096）：
 * - 把页面树工具栏的「新建 ▾」「导入 ▾」两个并列下拉箭头并入此处，
 *   并补齐 DEV-084 的空白 docx / xlsx / xmind 新建项；
 * - 文档编辑操作集合与 DEV-003 保持一致（创建笔记、打开导入对话框等）。
 *
 * 设计取舍：采用应用内顶栏而非 Electron 原生菜单——
 * 跨平台表现统一、无 main↔renderer IPC 中转、与现有 ToolbarTooltip / 快捷键生态一致；
 * macOS 上不破坏系统菜单栏惯例（暂不引入应用原生菜单，留待后续按平台需要再加）。
 */

export interface FileMenuHandlers {
  /** 按 NewNoteFormat 直接新建笔记（已写盘 + 打开 tab）。 */
  createNote(format: 'native-block' | 'markdown'): void;
  /** 在 vault 内创建空白二进制文档（docx / xlsx / xmind）。 */
  createBlankBinary(kind: 'docx' | 'xlsx' | 'xmind'): void;
  /** 打开文件导入对话框。 */
  importDocx(): void;
  importXlsx(): void;
  importXmind(): void;
}

interface MenuEntry {
  label: string;
  hint?: string;
  onSelect(): void;
}

interface Submenu {
  label: string;
  items: MenuEntry[];
}

const FILE_MENU: Submenu[] = [
  {
    label: '文件',
    items: [
      // 新建分组（DEV-084：补齐空白二进制）
      {
        label: '新建文档（块编辑）',
        hint: '默认格式',
        onSelect: () => undefined /* 由 handler 装配 */,
      },
      { label: '新建 Markdown（源码模式）', onSelect: () => undefined },
      { label: '新建空白 DOCX', onSelect: () => undefined },
      { label: '新建空白 XLSX', onSelect: () => undefined },
      { label: '新建空白 XMind', onSelect: () => undefined },
      // 导入分组（DEV-074）
      { label: '导入 DOCX…', onSelect: () => undefined },
      { label: '导入 XLSX…', onSelect: () => undefined },
      { label: '导入 XMind…', onSelect: () => undefined },
    ],
  },
];

export function FileMenuBar({ handlers }: { handlers: FileMenuHandlers }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 把 FILE_MENU 的 onSelect 占位替换成真实的 handler，避免在外层每次 render 重排数组。
  const submenus: Submenu[] = FILE_MENU.map((s) => ({
    label: s.label,
    items: s.items.map((it, i) => ({
      label: it.label,
      hint: it.hint,
      onSelect: bindHandler(s.label, i, handlers),
    })),
  }));

  useEffect(() => {
    const onPointer = (e: Event): void => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenIndex(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenIndex(null);
    };
    window.addEventListener('mousedown', onPointer, { capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div
      ref={barRef}
      data-testid="app-file-menu"
      role="menubar"
      className="flex h-7 shrink-0 items-center gap-1 border-b bg-muted/40 px-2 text-xs"
    >
      {submenus.map((s, i) => {
        const open = openIndex === i;
        return (
          <div key={s.label} className="relative">
            <button
              type="button"
              data-testid={`app-file-menu-${s.label}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpenIndex(open ? null : i)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setOpenIndex(i);
                }
              }}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded px-2 text-muted-foreground hover:bg-accent hover:text-foreground',
                open && 'bg-accent text-foreground',
              )}
            >
              {s.label}
              <ChevronDown className="size-3" />
            </button>
            {open && (
              <div
                role="menu"
                data-testid={`app-file-menu-${s.label}-panel`}
                className="absolute left-0 top-full z-50 mt-1 min-w-[18rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
              >
                {s.items.map((it, idx) => (
                  <button
                    key={it.label}
                    type="button"
                    role="menuitem"
                    data-testid={`app-file-menu-item-${s.label}-${idx}`}
                    title={it.hint ?? it.label}
                    onClick={() => {
                      it.onSelect();
                      setOpenIndex(null);
                    }}
                    className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <span className="text-xs">{it.label}</span>
                    {it.hint && (
                      <span className="text-[10px] text-muted-foreground">{it.hint}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** FILE_MENU 是常量，条目下标对应具体动作。固定索引避免渲染期重新闭包。 */
function bindHandler(menu: string, index: number, h: FileMenuHandlers): () => void {
  if (menu !== '文件') return () => undefined;
  switch (index) {
    case 0:
      return () => h.createNote('native-block');
    case 1:
      return () => h.createNote('markdown');
    case 2:
      return () => h.createBlankBinary('docx');
    case 3:
      return () => h.createBlankBinary('xlsx');
    case 4:
      return () => h.createBlankBinary('xmind');
    case 5:
      return () => h.importDocx();
    case 6:
      return () => h.importXlsx();
    case 7:
      return () => h.importXmind();
    default:
      return () => undefined;
  }
}
