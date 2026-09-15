import { createPortal } from 'react-dom';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

export const DOCK_POPOVER_Z_INDEX = 40;

type Placement = 'top' | 'bottom';

interface DockPopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  testId?: string;
  placement?: Placement;
}

let nextPopoverId = 0;

/** Dock 弹层的统一 portal、定位、翻转与生命周期行为。 */
export function DockPopover({
  open,
  anchorRef,
  onClose,
  children,
  className = '',
  testId,
  placement = 'top',
}: DockPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = anchorRef;
  const idRef = useRef(`dock-popover-${++nextPopoverId}`);
  const [position, setPosition] = useState({ top: 0, left: 0, placement });

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = triggerRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const rect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const gap = 4;
      const padding = 8;
      const spaceAbove = rect.top - padding;
      const spaceBelow = window.innerHeight - rect.bottom - padding;
      const canPlaceTop = spaceAbove >= popoverRect.height + gap;
      const canPlaceBottom = spaceBelow >= popoverRect.height + gap;
      const actualPlacement =
        placement === 'top'
          ? canPlaceTop || !canPlaceBottom
            ? 'top'
            : 'bottom'
          : canPlaceBottom || !canPlaceTop
            ? 'bottom'
            : 'top';
      const unclampedTop =
        actualPlacement === 'top' ? rect.top - popoverRect.height - gap : rect.bottom + gap;
      const top = Math.min(
        Math.max(padding, unclampedTop),
        Math.max(padding, window.innerHeight - popoverRect.height - padding),
      );
      const left = Math.min(
        Math.max(padding, rect.left),
        Math.max(padding, window.innerWidth - popoverRect.width - padding),
      );
      setPosition({ top, left, placement: actualPlacement });
    };

    updatePosition();
    const frame = requestAnimationFrame(updatePosition);
    const onScroll = () => onClose();
    const onResize = () => onClose();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, onClose, placement, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) onClose();
    };
    window.dispatchEvent(new CustomEvent('dock-popover-open', { detail: id }));
    window.addEventListener('dock-popover-open', closeOther);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = Array.from(
        popoverRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [role="menuitem"]',
        ) ?? [],
      );
      if (items.length === 0) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + delta + items.length) % items.length]?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    const focusFrame = requestAnimationFrame(() => {
      const first = popoverRef.current?.querySelector<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
      );
      first?.focus();
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('dock-popover-open', closeOther);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={popoverRef}
      data-testid={testId}
      data-placement={position.placement}
      style={{ top: position.top, left: position.left, zIndex: DOCK_POPOVER_Z_INDEX }}
      className={`fixed ${className}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
