import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import { computeEditorActionContext, type EditorActionContext } from './action-context';

/**
 * 编辑器右键菜单（框架无关 DOM 实现）。
 *
 * - 选中文本右键：菜单动作作用于选区（ctx.target = selection）
 * - 折叠状态 / 块上右键：动作作用于指针所在整块（ctx.target = block）
 * - 支持二级子菜单（AI 写作 → 六个动作）
 * - 菜单 position:fixed 挂载到 document.body，避免滚动容器裁剪
 */

export interface ContextMenuItem {
  id?: string;
  title: string;
  hint?: string;
  disabled?: boolean;
  separator?: boolean;
  submenu?: ContextMenuItem[];
}

export interface ContextMenuOptions {
  build: (ctx: EditorActionContext) => ContextMenuItem[];
  onAction: (id: string, ctx: EditorActionContext) => void;
  className: string;
}

export const contextMenuPluginKey = new PluginKey<{ open: boolean }>('nexnoteContextMenu');

export interface MenuHandle {
  destroy(): void;
}

export function buildMenuDom(
  className: string,
  items: ContextMenuItem[],
  coords: { x: number; y: number },
  onAction: (id: string) => void,
): MenuHandle {
  const root = document.createElement('div');
  root.className = className;
  root.dataset.contextMenu = '';
  root.style.position = 'fixed';
  root.style.zIndex = '50';
  root.style.top = `${coords.y}px`;
  root.style.left = `${coords.x}px`;

  // ── 键盘导航状态（DEV-017：↑↓ 移动 / Enter 执行 / → 进子菜单 / ← 返回 / Esc 关闭）──
  /** 每个容器（root 或 submenu）内可聚焦的启用按钮，按文档序 */
  const rowsByContainer = new Map<HTMLElement, HTMLButtonElement[]>();
  /** 有子菜单的行 → 子菜单元素 */
  const subByRow = new Map<HTMLButtonElement, HTMLElement>();
  /** 子菜单容器 → 其父级行（返回时恢复焦点） */
  const parentRowBySub = new Map<HTMLElement, HTMLButtonElement>();

  const renderItems = (
    container: HTMLElement,
    list: ContextMenuItem[],
    depth: number,
  ): void => {
    const rows: HTMLButtonElement[] = [];
    rowsByContainer.set(container, rows);
    for (const item of list) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = `${className}__separator`;
        container.append(sep);
        continue;
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `${className}__item`;
      row.dataset.contextMenuItem = item.id ?? '';
      row.disabled = item.disabled ?? false;
      const label = document.createElement('span');
      label.className = `${className}__label`;
      label.textContent = item.title;
      row.append(label);
      if (item.hint) {
        const hint = document.createElement('code');
        hint.className = `${className}__hint`;
        hint.textContent = item.hint;
        row.append(hint);
      }

      if (item.submenu && item.submenu.length > 0) {
        row.classList.add(`${className}__item--has-sub`);
        const arrow = document.createElement('span');
        arrow.className = `${className}__arrow`;
        arrow.textContent = '›';
        row.append(arrow);
        const wrap = document.createElement('div');
        wrap.className = `${className}__sub-wrap`;
        wrap.style.position = 'relative';
        const sub = document.createElement('div');
        sub.className = `${className}__sub`;
        sub.style.display = 'none';
        renderItems(sub, item.submenu, depth + 1);
        subByRow.set(row, sub);
        parentRowBySub.set(sub, row);
        wrap.addEventListener('mouseenter', () => {
          sub.style.display = 'block';
        });
        wrap.addEventListener('mouseleave', () => {
          sub.style.display = 'none';
        });
        row.addEventListener('click', (e) => {
          e.preventDefault();
          openSubmenu(row);
        });
        wrap.append(row);
        wrap.append(sub);
        container.append(wrap);
      } else if (item.id) {
        row.addEventListener('click', (e) => {
          e.preventDefault();
          onAction(item.id!);
        });
        container.append(row);
      } else {
        container.append(row);
      }
      if (!row.disabled) rows.push(row);
    }
  };

  /** 键盘焦点所在的菜单层级栈（栈底是 root） */
  const levelStack: HTMLElement[] = [];
  const currentRows = (): HTMLButtonElement[] => {
    const top = levelStack[levelStack.length - 1];
    return (top && rowsByContainer.get(top)) ?? [];
  };

  const focusRow = (row: HTMLButtonElement | undefined) => row?.focus();

  const moveFocus = (dir: 1 | -1) => {
    const rows = currentRows();
    if (rows.length === 0) return;
    const idx = rows.findIndex((r) => r === document.activeElement);
    const next = idx < 0 ? (dir === 1 ? 0 : rows.length - 1) : (idx + dir + rows.length) % rows.length;
    focusRow(rows[next]);
  };

  const openSubmenu = (row: HTMLButtonElement) => {
    const sub = subByRow.get(row);
    if (!sub) return;
    sub.style.display = 'block';
    levelStack.push(sub);
    focusRow(rowsByContainer.get(sub)?.[0]);
  };

  const closeSubmenu = (): boolean => {
    const sub = levelStack.pop();
    if (!sub || levelStack.length === 0) {
      if (sub) levelStack.push(sub);
      return false;
    }
    sub.style.display = 'none';
    focusRow(parentRowBySub.get(sub));
    return true;
  };

  renderItems(root, items, 0);
  document.body.append(root);
  levelStack.push(root);
  // 打开即聚焦首项，键盘用户无需先 Tab
  focusRow(currentRows()[0]);

  let closed = false;
  /** 全量拆除（移除 document 监听 + 根节点）；幂等。 */
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', onDocClick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('scroll', onScroll, true);
    root.remove();
  };
  const onDocClick = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-1);
        return;
      case 'ArrowRight': {
        const active = document.activeElement as HTMLButtonElement | null;
        if (active && subByRow.has(active)) {
          e.preventDefault();
          openSubmenu(active);
        }
        return;
      }
      case 'ArrowLeft':
        e.preventDefault();
        closeSubmenu();
        return;
      case 'Enter':
      case ' ': {
        const active = document.activeElement as HTMLButtonElement | null;
        if (active && root.contains(active)) {
          e.preventDefault();
          if (subByRow.has(active)) openSubmenu(active);
          else active.click();
        }
        return;
      }
      case 'Escape':
        e.preventDefault();
        if (!closeSubmenu()) close();
        return;
      default:
    }
  };
  const onScroll = () => close();
  // contextmenu 之前的右键 mousedown 已派发完毕，此处立即绑定不会误关。
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('scroll', onScroll, true);

  return {
    destroy() {
      close();
    },
  };
}

export const ContextMenu = Extension.create<ContextMenuOptions, { open: boolean }>({
  name: 'nexnoteContextMenu',

  addOptions() {
    return {
      build: () => [],
      onAction: () => undefined,
      className: 'nexnote-context-menu',
    };
  },

  addStorage() {
    return { open: false };
  },

  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const ext = this;
    let active: MenuHandle | null = null;

    const close = () => {
      active?.destroy();
      active = null;
      ext.storage.open = false;
    };

    return [
      new Plugin({
        key: contextMenuPluginKey,
        props: {
          handleDOMEvents: {
            contextmenu(view, event: Event) {
              const mouse = event as MouseEvent;
              mouse.preventDefault();
              close();

              const hasSelection =
                !view.state.selection.empty && view.state.selection.from !== view.state.selection.to;
              const ctx = computeEditorActionContext(
                view,
                hasSelection ? 'selection' : 'block',
                { x: mouse.clientX, y: mouse.clientY },
              );
              const items = ext.options.build(ctx);
              if (items.length === 0) return false;
              active = buildMenuDom(
                ext.options.className,
                items,
                { x: mouse.clientX, y: mouse.clientY },
                (id) => {
                  close();
                  ext.options.onAction(id, ctx);
                },
              );
              ext.storage.open = true;
              return true;
            },
          },
        },
        view() {
          return {
            destroy() {
              close();
            },
          };
        },
      }),
    ];
  },
});
