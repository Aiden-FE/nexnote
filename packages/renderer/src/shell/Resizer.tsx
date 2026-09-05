import { useCallback } from 'react';
import { cn } from '../lib/utils';

interface ResizerProps {
  orientation: 'vertical' | 'horizontal';
  /** 拖拽回调：movementX/movementY（像素增量） */
  onDrag: (movement: number) => void;
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

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-testid={testId}
      onPointerDown={handlePointerDown}
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
