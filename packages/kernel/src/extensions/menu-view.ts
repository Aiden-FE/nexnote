import type { EditorView } from '@tiptap/pm/view';
import { tCurrent } from '@nexnote/shared';
import type { SlashMenuState } from './quick-insert';
import {
  applyMenuViewportPlacement,
  findScrollViewport,
  MENU_VIEWPORT_GAP,
  readMenuHeight,
  readMenuViewport,
  scrollActiveMenuItemIntoView,
} from './menu-viewport';

export interface QuickInsertView {
  dom: HTMLDivElement;
  render(state: SlashMenuState, coords: { top: number; left: number }): void;
  hide(): void;
  destroy(): void;
}

export function createQuickInsertView(className: string): QuickInsertView {
  const dom = document.createElement('div');
  dom.className = className;
  // Block and CodeMirror menus share the visual class but need distinct stable smoke seams.
  // Keep the semantic listbox/data-slash-menu contract unchanged for existing consumers.
  dom.dataset.slashMenu = '';
  dom.dataset.testid = 'block-slash-menu';
  dom.setAttribute('role', 'listbox');
  dom.setAttribute('aria-label', tCurrent('source.slash.ariaLabel'));
  dom.style.cssText = 'display:none;position:absolute;z-index:40;overflow-y:auto';
  return {
    dom,
    render(state, coords) {
      dom.innerHTML = '';
      dom.setAttribute('aria-label', tCurrent('source.slash.ariaLabel'));
      let lastGroup: string | undefined;
      for (const [index, item] of state.items.entries()) {
        if (item.group && item.group !== lastGroup) {
          lastGroup = item.group;
          const header = document.createElement('div');
          header.className = `${className}__group`;
          header.textContent = tCurrent(`editorAction.group.${item.group}.name`);
          dom.append(header);
        }
        const row = document.createElement('div');
        row.className = `${className}__item`;
        row.dataset.slashItem = item.id;
        row.id = `${className}-option-${index}`;
        row.dataset.active = String(index === state.activeIndex);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(index === state.activeIndex));
        if (item.icon) {
          const icon = document.createElement('span');
          icon.dataset.slashIcon = item.icon;
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = {
            undo: '↶',
            redo: '↷',
            heading: 'H',
            paragraph: '¶',
            bold: 'B',
            italic: 'I',
            strike: 'S̶',
            code: '</>',
            link: '↗',
            wikilink: '[[]]',
            selection: '▣',
            wand: '✦',
            table: '▦',
            image: '▧',
            attachment: '▤',
            flowchart: '◇',
            gantt: '▥',
            outline: '☷',
            rule: '─',
            quote: '❝',
            list: '☷',
            task: '☑',
            sparkles: '✧',
            plugin: '⬡',
          }[item.icon];
          row.append(icon);
        }
        const label = document.createElement('span');
        label.textContent =
          item.titleText ?? (item.titleKey ? tCurrent(item.titleKey, item.titleParams) : item.id);
        row.append(label);
        const hintText = item.hintText ?? (item.hintKey ? tCurrent(item.hintKey) : undefined);
        if (hintText) {
          const hint = document.createElement('span');
          hint.className = `${className}__hint`;
          hint.textContent = ` ${hintText}`;
          row.append(hint);
        }
        dom.append(row);
      }
      if (!state.items.length) {
        const empty = document.createElement('div');
        empty.className = `${className}__empty`;
        empty.dataset.slashEmpty = '';
        empty.textContent = tCurrent('source.slash.empty');
        dom.append(empty);
      }
      if (state.items.length)
        dom.setAttribute('aria-activedescendant', `${className}-option-${state.activeIndex}`);
      else dom.removeAttribute('aria-activedescendant');
      dom.style.display = state.open ? 'block' : 'none';
      dom.style.top = `${coords.top}px`;
      dom.style.left = `${coords.left}px`;
      if (state.open && state.items.length) scrollActiveMenuItemIntoView(dom);
    },
    hide() {
      dom.style.display = 'none';
    },
    destroy() {
      dom.remove();
    },
  };
}

export function quickInsertCaretCoords(view: EditorView): { top: number; left: number } {
  const rect = view.coordsAtPos(view.state.selection.from);
  const host = view.dom.parentElement?.getBoundingClientRect();
  return {
    top: rect.bottom - (host?.top ?? 0) + MENU_VIEWPORT_GAP,
    left: rect.left - (host?.left ?? 0),
  };
}

export function positionQuickInsertMenu(view: EditorView, dom: HTMLDivElement): void {
  const host = view.dom.parentElement;
  if (!host) return;
  const rect = view.coordsAtPos(view.state.selection.from);
  const viewport = findScrollViewport(view.dom);
  applyMenuViewportPlacement({
    menu: dom,
    host,
    anchor: { top: rect.top, bottom: rect.bottom, left: rect.left },
    viewport: readMenuViewport(viewport),
    desiredHeight: readMenuHeight(dom),
  });
}
