import type { EditorView } from '@tiptap/pm/view';
import type { SlashMenuState } from './quick-insert';

export interface QuickInsertView {
  dom: HTMLDivElement;
  render(state: SlashMenuState, coords: { top: number; left: number }): void;
  hide(): void;
  destroy(): void;
}

export function createQuickInsertView(className: string): QuickInsertView {
  const dom = document.createElement('div');
  dom.className = className;
  dom.dataset.slashMenu = '';
  dom.setAttribute('role', 'listbox');
  dom.setAttribute('aria-label', '快捷插入动作');
  dom.style.cssText = 'display:none;position:absolute;z-index:40';
  return {
    dom,
    render(state, coords) {
      dom.innerHTML = '';
      let lastGroup: string | undefined;
      for (const [index, item] of state.items.entries()) {
        if (item.group && item.group !== lastGroup) {
          lastGroup = item.group;
          const header = document.createElement('div');
          header.className = `${className}__group`;
          header.textContent = item.group;
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
        label.textContent = item.title;
        row.append(label);
        if (item.hint) {
          const hint = document.createElement('span');
          hint.className = `${className}__hint`;
          hint.textContent = ` ${item.hint}`;
          row.append(hint);
        }
        dom.append(row);
      }
      if (!state.items.length) {
        const empty = document.createElement('div');
        empty.className = `${className}__empty`;
        empty.dataset.slashEmpty = '';
        empty.textContent = '没有匹配的快捷动作';
        dom.append(empty);
      }
      if (state.items.length)
        dom.setAttribute('aria-activedescendant', `${className}-option-${state.activeIndex}`);
      else dom.removeAttribute('aria-activedescendant');
      dom.style.display = state.open ? 'block' : 'none';
      dom.style.top = `${coords.top}px`;
      dom.style.left = `${coords.left}px`;
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
  return { top: rect.bottom - (host?.top ?? 0) + 6, left: rect.left - (host?.left ?? 0) };
}
