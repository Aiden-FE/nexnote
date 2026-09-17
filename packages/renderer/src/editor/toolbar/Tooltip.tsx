import { cloneElement, useEffect, useId, useState, type ReactElement } from 'react';

export interface ToolbarTooltipProps {
  text: string;
  children: ReactElement<React.HTMLAttributes<HTMLElement>>;
}

/** Pointer hover 与 keyboard focus 共用的非原生 Tooltip；Escape 关闭。 */
export function ToolbarTooltip({ text, children }: ToolbarTooltipProps) {
  const id = useId();
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
      className="relative inline-flex shrink-0"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {open && (
        <span
          id={id}
          role="tooltip"
          data-testid="toolbar-tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-[60] mt-1 -translate-x-1/2 whitespace-nowrap rounded border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
        >
          {text}
        </span>
      )}
    </span>
  );
}
