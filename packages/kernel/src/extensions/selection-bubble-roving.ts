import type { BubbleAction } from './selection-bubble';

/** Top-level controls available to keyboard traversal in a selection bubble. */
function allToolbarControls(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    root.querySelectorAll<HTMLButtonElement>(
      ':scope > button, :scope > [data-ai-dropdown] > button',
    ),
  );
}

function toolbarControls(root: HTMLElement): HTMLButtonElement[] {
  return allToolbarControls(root).filter(
    (button) =>
      !button.hidden && button.getAttribute('aria-disabled') !== 'true' && !button.disabled,
  );
}

/** Maintain a single tabbable control, falling back when the prior one becomes hidden or disabled. */
export function syncSelectionBubbleToolbarTabStop(
  root: HTMLElement,
  preferred?: HTMLButtonElement | null,
): HTMLButtonElement | null {
  const controls = toolbarControls(root);
  const current =
    preferred && controls.includes(preferred)
      ? preferred
      : (controls.find((button) => button.tabIndex === 0) ?? controls[0] ?? null);
  allToolbarControls(root).forEach((button) => {
    button.tabIndex = button === current ? 0 : -1;
  });
  return current;
}

/** Shared roving focus for selection bubble's top-level controls. */
export function moveSelectionBubbleToolbarFocus(root: HTMLElement, event: KeyboardEvent): boolean {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
  const controls = toolbarControls(root);
  if (controls.length === 0) return false;

  event.preventDefault();
  const current = controls.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? controls.length - 1
        : event.key === 'ArrowRight'
          ? (current + 1 + controls.length) % controls.length
          : (current - 1 + controls.length) % controls.length;
  const target = controls[next] ?? controls[0]!;
  syncSelectionBubbleToolbarTabStop(root, target);
  target.focus();
  return true;
}

export function bindSelectionBubbleToolbarRoving(root: HTMLElement): () => void {
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof HTMLButtonElement) syncSelectionBubbleToolbarTabStop(root, target);
  };
  const observer = new MutationObserver(() => {
    syncSelectionBubbleToolbarTabStop(root, document.activeElement as HTMLButtonElement | null);
  });
  observer.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled', 'aria-disabled'],
  });
  root.addEventListener('focusin', onFocusIn);
  syncSelectionBubbleToolbarTabStop(root);
  return () => {
    observer.disconnect();
    root.removeEventListener('focusin', onFocusIn);
  };
}

export function matchesBubbleShortcut(event: KeyboardEvent, action: BubbleAction): boolean {
  const shortcut = action.shortcut;
  if (!shortcut) return false;
  const modOk = shortcut.mod ? event.metaKey || event.ctrlKey : true;
  const altOk = shortcut.alt ? event.altKey : !event.altKey;
  const shiftOk = shortcut.shift ? event.shiftKey : !event.shiftKey;
  return modOk && altOk && shiftOk && event.key.toLowerCase() === shortcut.key.toLowerCase();
}

/** Dispatch one explicit selection shortcut; matches are consumed, while disabled actions never trigger. */
export function dispatchBubbleShortcut(
  event: KeyboardEvent,
  actions: readonly BubbleAction[],
  trigger: (id: string) => void,
): boolean {
  const action = actions.find((candidate) => matchesBubbleShortcut(event, candidate));
  if (!action) return false;
  event.preventDefault();
  event.stopPropagation();
  const disabled =
    typeof action.disabled === 'function' ? action.disabled() : (action.disabled ?? false);
  if (!disabled) trigger(action.id);
  return true;
}
