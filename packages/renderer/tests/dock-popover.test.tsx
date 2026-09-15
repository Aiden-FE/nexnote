// @vitest-environment happy-dom
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DockPopover } from '../src/features/ai/chat/DockPopover';

function Harness({ label, placement = 'top' }: { label: string; placement?: 'top' | 'bottom' }) {
  const triggerRef = { current: null } as React.RefObject<HTMLButtonElement | null>;
  return (
    <div>
      <button ref={triggerRef} data-testid={`trigger-${label}`}>
        {label}
      </button>
      <DockPopover
        open
        anchorRef={triggerRef}
        onClose={() => undefined}
        placement={placement}
        testId={`popover-${label}`}
      >
        <button type="button">{label} item</button>
      </DockPopover>
    </div>
  );
}

describe('DockPopover', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it('mounts in body, uses fixed positioning and flips when the preferred side has no room', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(<Harness label="skill" />));
    const trigger = document.querySelector('[data-testid="trigger-skill"]') as HTMLElement;
    Object.defineProperty(trigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 4, bottom: 24, left: 40, right: 100, width: 60, height: 20 }),
    });
    const popover = document.querySelector('[data-testid="popover-skill"]') as HTMLElement;
    Object.defineProperty(popover, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 180, left: 0, right: 240, width: 240, height: 180 }),
    });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(popover.parentElement).toBe(document.body);
    expect(popover.className).toContain('fixed');
    expect(popover.dataset.placement).toBe('bottom');
    expect(popover.style.zIndex).toBe('40');
  });

  it('closes an existing dock popover when another one opens', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    function TwoPopovers() {
      const [open, setOpen] = useState<'first' | 'second' | null>(null);
      const firstRef = useRef<HTMLButtonElement>(null);
      const secondRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={firstRef} onClick={() => setOpen('first')}>
            first
          </button>
          <DockPopover
            open={open === 'first'}
            anchorRef={firstRef}
            onClose={() => setOpen(null)}
            testId="first-popover"
          >
            first
          </DockPopover>
          <button ref={secondRef} onClick={() => setOpen('second')}>
            second
          </button>
          <DockPopover
            open={open === 'second'}
            anchorRef={secondRef}
            onClose={() => setOpen(null)}
            testId="second-popover"
          >
            second
          </DockPopover>
        </>
      );
    }
    act(() => root!.render(<TwoPopovers />));
    const first = document.querySelector('button:first-of-type') as HTMLButtonElement;
    const second = document.querySelector('button:nth-of-type(2)') as HTMLButtonElement;
    act(() => first.click());
    expect(document.querySelector('[data-testid="first-popover"]')).not.toBeNull();
    act(() => {
      second.click();
    });
    expect(document.querySelector('[data-testid="first-popover"]')).toBeNull();
    expect(document.querySelector('[data-testid="second-popover"]')).not.toBeNull();
  });
});
