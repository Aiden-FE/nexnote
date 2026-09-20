export const MENU_VIEWPORT_GAP = 6;
export const MENU_VIEWPORT_MARGIN = 8;

export interface MenuAnchorRect {
  top: number;
  bottom: number;
  left: number;
}

export interface MenuViewportRect {
  top: number;
  bottom: number;
}

export interface MenuViewportPlacement {
  placement: 'above' | 'below';
  maxHeight: number;
  top: number;
}

export function computeMenuViewportPlacement(options: {
  anchor: Pick<MenuAnchorRect, 'top' | 'bottom'>;
  viewport: MenuViewportRect;
  desiredHeight: number;
  gap?: number;
  margin?: number;
}): MenuViewportPlacement {
  return realComputeMenuViewportPlacement(options);
}

export function realComputeMenuViewportPlacement(options: {
  anchor: Pick<MenuAnchorRect, 'top' | 'bottom'>;
  viewport: MenuViewportRect;
  desiredHeight: number;
  gap?: number;
  margin?: number;
}): MenuViewportPlacement {
  const gap = options.gap ?? MENU_VIEWPORT_GAP;
  const margin = options.margin ?? MENU_VIEWPORT_MARGIN;
  const viewportTop = options.viewport.top + margin;
  const viewportBottom = options.viewport.bottom - margin;
  const below = Math.max(0, viewportBottom - options.anchor.bottom - gap);
  const above = Math.max(0, options.anchor.top - gap - viewportTop);
  const placement = options.desiredHeight <= below || below >= above ? 'below' : 'above';
  const maxHeight = placement === 'below' ? below : above;
  const renderedHeight = Math.min(Math.max(0, options.desiredHeight), maxHeight);
  return {
    placement,
    maxHeight,
    top:
      placement === 'below'
        ? options.anchor.bottom + gap
        : options.anchor.top - gap - renderedHeight,
  };
}

const SCROLL_VIEWPORT_SELECTORS = [
  '.cm-scroller',
  '.ProseMirror',
  '[data-testid="source-editor-pane"]',
  '[data-testid="editor-host"]',
];

export function findScrollViewport(element: HTMLElement | null): HTMLElement | null {
  if (!element || typeof element.closest !== 'function') return null;
  for (const selector of SCROLL_VIEWPORT_SELECTORS) {
    const match = element.closest<HTMLElement>(selector);
    if (match && typeof match.getBoundingClientRect === 'function') {
      const rect = match.getBoundingClientRect();
      if (rect && rect.bottom > rect.top && match.scrollHeight - match.clientHeight > 1) {
        return match;
      }
    }
  }
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY || '';
    const overflow = style.overflow || '';
    const cssScrollable =
      /^(auto|scroll|overlay|hidden|clip)$/.test(overflowY) ||
      /^(auto|scroll|overlay|hidden|clip)$/.test(overflow);
    const hasScroll = current.scrollHeight - current.clientHeight > 1;
    if (cssScrollable && hasScroll) return current;
    current = current.parentElement;
  }
  return null;
}

export function readMenuViewport(viewportElement?: HTMLElement | null): MenuViewportRect {
  const windowViewport = {
    top: 0,
    bottom: window.visualViewport?.height ?? window.innerHeight,
  };
  if (!viewportElement || typeof viewportElement.getBoundingClientRect !== 'function')
    return windowViewport;
  const rect = viewportElement.getBoundingClientRect();
  if (!rect || rect.bottom <= rect.top) return windowViewport;
  return {
    top: Math.max(windowViewport.top, rect.top),
    bottom: Math.min(windowViewport.bottom, rect.bottom),
  };
}

export function readMenuHeight(menu: HTMLElement): number {
  const rectHeight = menu.getBoundingClientRect().height;
  return Math.max(menu.scrollHeight, rectHeight);
}

export interface ApplyMenuViewportPlacementOptions {
  menu: HTMLElement;
  host: HTMLElement | DOMRect;
  anchor: MenuAnchorRect;
  viewport: MenuViewportRect;
  desiredHeight: number;
}

export function applyMenuViewportPlacement(
  options: ApplyMenuViewportPlacementOptions,
): MenuViewportPlacement {
  const placement = computeMenuViewportPlacement(options);
  const hostRect =
    options.host instanceof HTMLElement ? options.host.getBoundingClientRect() : options.host;
  options.menu.style.top = `${placement.top - hostRect.top}px`;
  options.menu.style.left = `${options.anchor.left - hostRect.left}px`;
  options.menu.style.maxHeight = `${Math.floor(placement.maxHeight)}px`;
  options.menu.style.overflowY = 'auto';
  options.menu.dataset.placement = placement.placement;
  return placement;
}

export function positionMenuInViewport(options: {
  menu: HTMLElement;
  host: HTMLElement;
  anchor: MenuAnchorRect;
  viewportElement?: HTMLElement | null;
}): MenuViewportPlacement {
  options.menu.style.maxHeight = 'none';
  return applyMenuViewportPlacement({
    ...options,
    viewport: readMenuViewport(options.viewportElement),
    desiredHeight: readMenuHeight(options.menu),
  });
}

export function scrollActiveMenuItemIntoView(menu: HTMLElement): void {
  const target =
    menu.querySelector<HTMLElement>('[data-active="true"]') ??
    menu.querySelector<HTMLElement>('[aria-selected="true"]') ??
    (() => {
      const id = menu.getAttribute('aria-activedescendant');
      return id ? menu.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null;
    })();
  target?.scrollIntoView({ block: 'nearest' });
}
