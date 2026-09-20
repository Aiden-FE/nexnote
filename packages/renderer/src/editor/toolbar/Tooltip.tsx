import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

export interface ToolbarTooltipProps {
  text: string;
  children: ReactElement<React.HTMLAttributes<HTMLElement>>;
}

/**
 * DEV-067：tooltip 渲染到 body 的 fixed 定位浮层。
 *
 * 工具栏 actions 行带 `overflow-hidden`（单行溢出裁剪），absolute 定位的 tooltip
 * 伸出 32px 行下缘会被裁掉；fixed + portal 脱离该裁剪上下文。水平方向以触发按钮
 * 中心对齐，靠近视口左/右缘时夹紧，避免溢出视口。
 */
function FixedTooltip({
  wrapRef,
  id,
  text,
}: {
  wrapRef: RefObject<HTMLSpanElement | null>;
  id: string;
  text: string;
}) {
  const tipRef = useRef<HTMLSpanElement>(null);

  // 命令式写定位（layout effect 中读 ref 是合法时机）：锚点取 wrapper 内首个工具栏
  // 按钮，避免覆盖按钮原有 ref（EditorToolbar 用它注册元素做宽度测量与菜单定位）。
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const wrap = wrapRef.current;
    if (!tip || !wrap) return;
    const anchor = wrap.querySelector<HTMLElement>('button[data-toolbar-item="true"]') ?? wrap;
    const rect = anchor.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const minLeft = 8 + half;
    const maxLeft = window.innerWidth - 8 - half;
    const cx = Math.min(Math.max(rect.left + rect.width / 2, minLeft), Math.max(minLeft, maxLeft));
    tip.style.left = `${cx}px`;
    tip.style.top = `${rect.bottom + 4}px`;
  }, [wrapRef, text]);

  return createPortal(
    <span
      ref={tipRef}
      id={id}
      role="tooltip"
      data-testid="toolbar-tooltip"
      className="pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap rounded border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
    >
      {text}
    </span>,
    document.body,
  );
}

/** Pointer hover 与 keyboard focus 共用的非原生 Tooltip；Escape 关闭。 */
export function ToolbarTooltip({ text, children }: ToolbarTooltipProps) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex shrink-0"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={(event: PointerEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      {open && <FixedTooltip wrapRef={wrapRef} id={id} text={text} />}
    </span>
  );
}
