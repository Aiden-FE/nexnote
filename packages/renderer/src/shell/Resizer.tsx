import { useCallback } from 'react';
import { cn } from '../lib/utils';

interface ResizerProps {
  orientation: 'vertical' | 'horizontal';
  /** 拖拽回调：movementX/movementY（像素增量） */
  onDrag: (movement: number) => void;
  /** 键盘调整回调；传入方向与 Shift 状态。 */
  onKeyAdjust?: (direction: 1 | -1, coarse: boolean) => void;
  /** 双击行为（如折叠/重置） */
  onDoubleClick?: () => void;
  className?: string;
  testId?: string;
}

/**
 * 可拖拽分隔线：pointer capture 拖拽，双击触发附加行为。
 * 用于侧栏宽度、dock 宽度、分屏比例。
 */
export function Resizer({
  orientation,
  onDrag,
  onKeyAdjust,
  onDoubleClick,
  className,
  testId,
}: ResizerProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        onDrag(orientation === 'vertical' ? ev.movementX : ev.movementY);
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    },
    [onDrag, orientation],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onKeyAdjust) return;
      const key = event.key;
      const positive = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
      const negative = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
      if (key !== positive && key !== negative) return;
      event.preventDefault();
      onKeyAdjust(key === positive ? 1 : -1, event.shiftKey);
    },
    [onKeyAdjust, orientation],
  );

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-valuemin={onKeyAdjust ? 20 : undefined}
      aria-valuemax={onKeyAdjust ? 80 : undefined}
      tabIndex={onKeyAdjust ? 0 : undefined}
      data-testid={testId}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        'group relative z-10 shrink-0 bg-border transition-colors',
        orientation === 'vertical' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
        'hover:bg-primary/40',
        className,
      )}
    />
  );
}
