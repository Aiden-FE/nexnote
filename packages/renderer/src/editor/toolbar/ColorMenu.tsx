import { useEffect, useRef, useState } from 'react';
import { Baseline, Highlighter } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';
import { FORMAT_BACKGROUND_COLOR, FORMAT_TEXT_COLOR } from '../interactions/format-ids';

/**
 * 字体颜色 / 背景色选择器（挂在块编辑器工具栏右侧）。
 *
 * 颜色动作在动作目录里是普通语义 id（format:text-color / format:background-color），
 * 但它们不像粗体那样能直接 toggle——必须先选色值，所以这里用「触发器 + 弹层」承载：
 * 触发器本身只打开面板，真正执行由 onApply(id, color) 交给上层调用
 * applyColorAction。色值 null 表示清除该颜色。
 *
 * 预设色板对齐 Obsidian 的默认色板（8 色 + 透明）；自定义色用原生
 * `<input type="color">`，其值天然是 `#rrggbb`，与内核 textStyle 落盘一致。
 */
export type ColorMenuTarget = 'text' | 'background';
export type ColorApply = (id: string, color: string | null) => void;

/** Obsidian 预设色板：文字色 + 背景色共用一套明暗搭配。 */
const PALETTE = [
  '#6FA8DC',
  '#93C47D',
  '#F6B26B',
  '#E06666',
  '#B4A7D6',
  '#FFD966',
  '#CCCCCC',
  '#333333',
] as const;

export interface ColorMenuProps {
  /** 当前选区已有颜色（用于在触发器下方显示色条）。 */
  currentTextColor?: string | null;
  currentBackgroundColor?: string | null;
  onApply: ColorApply;
  /** 无选区时是否禁用（无 stored mark 目标）。默认不禁用，光标处设置颜色也有效。 */
  disabled?: boolean;
}

export function ColorMenu({
  currentTextColor,
  currentBackgroundColor,
  onApply,
  disabled,
}: ColorMenuProps) {
  const t = useI18n();
  const [target, setTarget] = useState<ColorMenuTarget>('text');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部或 Esc 关闭；打开时色板首个色格可 Tab 达（DOM 顺序即焦点顺序）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const isText = target === 'text';
  const actionId = isText ? FORMAT_TEXT_COLOR : FORMAT_BACKGROUND_COLOR;
  const current = isText ? currentTextColor : currentBackgroundColor;
  const triggerLabel = isText ? t('colorPicker.textColor') : t('colorPicker.backgroundColor');

  return (
    <div ref={rootRef} className="relative" data-testid="color-menu">
      <div className="flex items-center">
        <button
          type="button"
          data-testid="color-menu-text-trigger"
          aria-label={t('colorPicker.textColor')}
          aria-expanded={open && target === 'text'}
          disabled={disabled}
          className={cn(
            'flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground',
            open && target === 'text' && 'bg-accent text-foreground',
            disabled && 'cursor-not-allowed opacity-40',
          )}
          onClick={() => {
            setTarget('text');
            setOpen((v) => (target === 'text' ? !v : true));
          }}
        >
          <Baseline className="size-3.5" />
          {currentTextColor ? (
            <span
              className="absolute bottom-0.5 left-1/2 h-0.5 w-3.5 -translate-x-1/2 rounded-full"
              style={{ backgroundColor: currentTextColor }}
            />
          ) : null}
        </button>
        <button
          type="button"
          data-testid="color-menu-background-trigger"
          aria-label={t('colorPicker.backgroundColor')}
          aria-expanded={open && target === 'background'}
          disabled={disabled}
          className={cn(
            'flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground',
            open && target === 'background' && 'bg-accent text-foreground',
            disabled && 'cursor-not-allowed opacity-40',
          )}
          onClick={() => {
            setTarget('background');
            setOpen((v) => (target === 'background' ? !v : true));
          }}
        >
          <Highlighter className="size-3.5" />
          {currentBackgroundColor ? (
            <span
              className="absolute bottom-0.5 left-1/2 h-0.5 w-3.5 -translate-x-1/2 rounded-full"
              style={{ backgroundColor: currentBackgroundColor }}
            />
          ) : null}
        </button>
      </div>

      {open ? (
        <div
          role="menu"
          data-testid="color-menu-panel"
          className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border bg-popover p-2 shadow-md"
        >
          <p className="px-1 pb-1 text-xs text-muted-foreground">{triggerLabel}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                role="menuitem"
                aria-label={color}
                data-testid={`color-swatch-${color.slice(1)}`}
                className={cn(
                  'size-7 rounded border transition hover:scale-110',
                  current?.toLowerCase() === color.toLowerCase() && 'ring-2 ring-foreground',
                )}
                style={{ backgroundColor: color }}
                onClick={() => {
                  onApply(actionId, color);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 border-t pt-1.5">
            <label className="flex flex-1 cursor-pointer items-center gap-1.5 px-1 text-xs">
              <input
                type="color"
                data-testid="color-custom-input"
                aria-label={t('colorPicker.custom')}
                className="size-6 cursor-pointer rounded border"
                onChange={(event) => {
                  onApply(actionId, event.target.value);
                }}
              />
              <span className="text-muted-foreground">{t('colorPicker.custom')}</span>
            </label>
            <button
              type="button"
              role="menuitem"
              data-testid="color-clear"
              className="rounded px-1.5 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
              onClick={() => {
                onApply(actionId, null);
                setOpen(false);
              }}
            >
              {t('colorPicker.clear')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
