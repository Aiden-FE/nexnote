/**
 * Shared roving focus for selection bubble's top-level controls.
 * Menus own their vertical navigation; this only traverses the toolbar row.
 */
export function moveSelectionBubbleToolbarFocus(root: HTMLElement, event: KeyboardEvent): boolean {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
  const controls = Array.from(
    root.querySelectorAll<HTMLButtonElement>(
      ':scope > button:not([hidden]), :scope > [data-ai-dropdown] > button:not([hidden])',
    ),
  ).filter((button) => button.getAttribute('aria-disabled') !== 'true' && !button.disabled);
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
  controls[next]?.focus();
  return true;
}
