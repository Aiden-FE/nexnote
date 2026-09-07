import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';

/**
 * 斜杠菜单骨架（框架无关 DOM 实现）。
 *
 * 空行/行尾输入 `/` 弹出插入菜单：过滤 + ↑↓ 导航 + Enter 执行 + Esc 关闭。
 * 项集为内核默认（结构块类型），渲染层后续票据可经 configure({ items }) 扩展。
 */

export interface SlashMenuItem {
  id: string;
  title: string;
  hint?: string;
  keywords?: string[];
  /** 分组标题（DEV-017：基础块 / 媒体 / 高级 / AI）；缺省按追加顺序归组 */
  group?: string;
  /** 执行插入；返回 false 表示当前上下文不可用 */
  action: (ctx: { view: EditorView }) => boolean;
}

export interface SlashMenuState {
  open: boolean;
  query: string;
  items: SlashMenuItem[];
  activeIndex: number;
}

export interface SlashMenuOptions {
  items: (query: string) => SlashMenuItem[];
  /** 弹层容器 class（默认 nexnote-slash-menu，渲染层用 CSS 变量主题化） */
  className: string;
}

export const slashMenuPluginKey = new PluginKey<SlashMenuState>('nexnoteSlashMenu');

/** 分组展示顺序（渲染按首次出现顺序抬头，需先按此排序保证同组连续）。 */
export const SLASH_GROUP_ORDER = ['基础块', '媒体', '高级', 'AI', '插件'] as const;

/**
 * 按分组稳定排序（同组保持原有相对顺序），未分组项排最后。
 * 渲染层只在 group 变化时插分组头，非连续同组会出现重复分组头，故合并后必须排序。
 */
export function sortSlashItemsByGroup(items: SlashMenuItem[]): SlashMenuItem[] {
  const rank = (g: string | undefined): number => {
    if (!g) return SLASH_GROUP_ORDER.length;
    const i = (SLASH_GROUP_ORDER as readonly string[]).indexOf(g);
    return i < 0 ? SLASH_GROUP_ORDER.length : i;
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.group) - rank(b.item.group) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * 按 id 去重：后出现者覆盖先出现者（渲染层/插件可覆盖内核默认项），
 * 保留首次出现位置以维持分组排序稳定。
 */
export function dedupeSlashItems(items: SlashMenuItem[]): SlashMenuItem[] {
  const lastWins = new Map<string, SlashMenuItem>();
  for (const item of items) lastWins.set(item.id, item);
  const seen = new Set<string>();
  const out: SlashMenuItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(lastWins.get(item.id)!);
  }
  return out;
}

/** 默认项集：结构块插入（动作全部用 TipTap 命令语义，经 view.dispatch 执行）。 */
export function defaultSlashMenuItems(query: string): SlashMenuItem[] {
  const q = query.trim().toLowerCase();
  const items: SlashMenuItem[] = [
    {
      id: 'heading1',
      title: '标题 1',
      hint: '# ',
      group: '基础块',
      keywords: ['heading', 'h1', 'biaoti'],
      action: ({ view }) => {
        view.dispatch(view.state.tr.setBlockType(0, view.state.doc.content.size, view.state.schema.nodes.heading!, { level: 1 }));
        return true;
      },
    },
    {
      id: 'heading2',
      title: '标题 2',
      hint: '## ',
      group: '基础块',
      keywords: ['heading', 'h2'],
      action: ({ view }) => {
        view.dispatch(view.state.tr.setBlockType(0, view.state.doc.content.size, view.state.schema.nodes.heading!, { level: 2 }));
        return true;
      },
    },
    {
      id: 'heading3',
      title: '标题 3',
      hint: '### ',
      group: '基础块',
      keywords: ['heading', 'h3'],
      action: ({ view }) => {
        view.dispatch(view.state.tr.setBlockType(0, view.state.doc.content.size, view.state.schema.nodes.heading!, { level: 3 }));
        return true;
      },
    },
    {
      id: 'paragraph',
      title: '段落',
      hint: 'p',
      keywords: ['text', 'paragraph', 'duanluo'],
      group: '基础块',
      action: ({ view }) => {
        const { schema, selection } = view.state;
        const current = selection.$from.parent;
        if (current.type.name === 'paragraph') return false;
        view.dispatch(view.state.tr.setBlockType(selection.from, selection.to, schema.nodes.paragraph!, {}));
        return true;
      },
    },
    {
      id: 'bulletList',
      title: '无序列表',
      hint: '- ',
      group: '基础块',
      keywords: ['list', 'bullet', 'ul', 'liebiao', 'wuxu'],
      action: ({ view }) => {
        const { bulletList, listItem, paragraph } = view.state.schema.nodes;
        if (!bulletList || !listItem || !paragraph) return false;
        view.dispatch(
          view.state.tr
            .replaceSelectionWith(bulletList.create(null, [listItem.create(null, paragraph.create())]))
            .scrollIntoView(),
        );
        return true;
      },
    },
    {
      id: 'orderedList',
      title: '有序列表',
      hint: '1. ',
      group: '基础块',
      keywords: ['list', 'ordered', 'ol', 'number', 'youxu'],
      action: ({ view }) => {
        const { orderedList, listItem, paragraph } = view.state.schema.nodes;
        if (!orderedList || !listItem || !paragraph) return false;
        view.dispatch(
          view.state.tr
            .replaceSelectionWith(orderedList.create(null, [listItem.create(null, paragraph.create())]))
            .scrollIntoView(),
        );
        return true;
      },
    },
    {
      id: 'table',
      title: '表格',
      hint: '| … |',
      group: '基础块',
      keywords: ['table', 'grid', 'biaoge'],
      action: ({ view }) => {
        const { table, tableRow, tableHeader, tableCell, paragraph } = view.state.schema.nodes;
        if (!table || !tableRow || !tableHeader || !tableCell || !paragraph) return false;
        const header = tableRow.create(null, [
          tableHeader.create(null, paragraph.create()),
          tableHeader.create(null, paragraph.create()),
        ]);
        const row = tableRow.create(null, [
          tableCell.create(null, paragraph.create()),
          tableCell.create(null, paragraph.create()),
        ]);
        view.dispatch(
          view.state.tr.replaceSelectionWith(table.create(null, [header, row])).scrollIntoView(),
        );
        return true;
      },
    },
    {
      id: 'taskList',
      title: '任务列表',
      hint: '- [ ]',
      group: '基础块',
      keywords: ['task', 'todo', 'checkbox'],
      action: ({ view }) => {
        const { schema } = view.state;
        view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.taskList!.create(null, [schema.nodes.taskItem!.create(null, schema.nodes.paragraph!.create())])).scrollIntoView());
        return true;
      },
    },
    {
      id: 'callout',
      title: '标注块',
      hint: '> [!note]',
      group: '高级',
      keywords: ['callout', 'admonition', 'biaozhu'],
      action: ({ view }) => {
        const { schema } = view.state;
        view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.callout!.create({ type: 'note' }, schema.nodes.paragraph!.create())).scrollIntoView());
        return true;
      },
    },
    {
      id: 'codeBlock',
      title: '代码块',
      hint: '```',
      group: '基础块',
      keywords: ['code', 'daima'],
      action: ({ view }) => {
        const { schema } = view.state;
        view.dispatch(view.state.tr.setBlockType(0, view.state.doc.content.size, schema.nodes.codeBlock!, { language: 'plaintext' }));
        return true;
      },
    },
    {
      id: 'blockquote',
      title: '引用',
      hint: '> ',
      group: '基础块',
      keywords: ['quote', 'yinyong'],
      action: ({ view }) => {
        const { schema, selection } = view.state;
        const $from = selection.$from;
        const range = $from.blockRange(selection.$to);
        const wrapping = range ? findWrapping(range, schema.nodes.blockquote!) : null;
        if (!range || !wrapping) return false;
        view.dispatch(view.state.tr.wrap(range, wrapping).scrollIntoView());
        return true;
      },
    },
    {
      id: 'horizontalRule',
      title: '分隔线',
      hint: '---',
      group: '基础块',
      keywords: ['hr', 'rule', 'fenge'],
      action: ({ view }) => {
        const { schema } = view.state;
        view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.horizontalRule!.create()).scrollIntoView());
        return true;
      },
    },
  ];
  if (!q) return sortSlashItemsByGroup(items);
  return sortSlashItemsByGroup(
    items.filter(
      (it) => it.title.toLowerCase().includes(q) || (it.keywords ?? []).some((k) => k.includes(q)),
    ),
  );
}

interface MenuView {
  dom: HTMLDivElement;
  render(state: SlashMenuState, coords: { top: number; left: number }): void;
  hide(): void;
  destroy(): void;
}

function createMenuDom(className: string): MenuView {
  const dom = document.createElement('div');
  dom.className = className;
  dom.dataset.slashMenu = '';
  dom.style.display = 'none';
  dom.style.position = 'absolute';
  dom.style.zIndex = '40';
  const render = (state: SlashMenuState, coords: { top: number; left: number }) => {
    dom.innerHTML = '';
    let lastGroup: string | null = null;
    state.items.forEach((item, i) => {
      const group = item.group ?? null;
      if (group !== lastGroup) {
        lastGroup = group;
        if (group) {
          const header = document.createElement('div');
          header.className = `${className}__group`;
          header.textContent = group;
          dom.append(header);
        }
      }
      const row = document.createElement('div');
      row.className = `${className}__item`;
      row.dataset.slashItem = item.id;
      row.dataset.active = i === state.activeIndex ? 'true' : 'false';
      const title = document.createElement('span');
      title.className = `${className}__title`;
      title.textContent = item.title;
      row.append(title);
      if (item.hint) {
        const hint = document.createElement('code');
        hint.className = `${className}__hint`;
        hint.textContent = item.hint;
        row.append(hint);
      }
      dom.append(row);
    });
    dom.style.display = state.open && state.items.length > 0 ? 'block' : 'none';
    dom.style.top = `${coords.top}px`;
    dom.style.left = `${coords.left}px`;
  };
  const hide = () => {
    dom.style.display = 'none';
  };
  const destroy = () => dom.remove();
  return { dom, render, hide, destroy };
}

/** 计算 `/` 触发光标的屏幕坐标（弹层锚点）。 */
function caretCoords(view: EditorView): { top: number; left: number } {
  const start = view.state.selection.from;
  const domAt = view.domAtPos(start);
  const node = domAt.node;
  const el = node.nodeType === 1 ? (node as HTMLElement) : (node.parentElement as HTMLElement | null);
  if (!el) return { top: 0, left: 0 };
  const range = document.createRange();
  range.setStart(domAt.node, domAt.offset);
  const rect = range.getBoundingClientRect();
  const hostRect = view.dom.parentElement?.getBoundingClientRect();
  return {
    top: rect.bottom - (hostRect?.top ?? 0) + 6,
    left: rect.left - (hostRect?.left ?? 0),
  };
}

export const SlashMenu = Extension.create<SlashMenuOptions, SlashMenuState>({
  name: 'nexnoteSlashMenu',

  addOptions() {
    return {
      items: defaultSlashMenuItems,
      className: 'nexnote-slash-menu',
    };
  },

  addStorage() {
    return { open: false, query: '', items: [], activeIndex: 0 } satisfies SlashMenuState;
  },

  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const ext = this;
    let menu: MenuView | null = null;
    /** `/` 前的文本位置（含斜杠），执行后需要删除的范围 */
    let slashFrom = -1;

    const close = (view: EditorView) => {
      ext.storage.open = false;
      ext.storage.query = '';
      ext.storage.items = [];
      ext.storage.activeIndex = 0;
      slashFrom = -1;
      menu?.hide();
      view.updateState(view.state);
    };

    const open = (view: EditorView, from: number) => {
      slashFrom = from;
      ext.storage.open = true;
      ext.storage.query = '';
      ext.storage.items = ext.options.items('');
      ext.storage.activeIndex = 0;
      sync(view);
    };

    const sync = (view: EditorView) => {
      if (!menu) return;
      const state = ext.storage;
      const host = view.dom.parentElement;
      if (state.open && !menu.dom.isConnected && host) host.append(menu.dom);
      if (!state.open) {
        menu.hide();
        return;
      }
      menu.render({ ...state }, caretCoords(view));
    };

    const applyItem = (view: EditorView, item: SlashMenuItem) => {
      // 先删掉 `/query` 文本
      const to = view.state.selection.from;
      if (slashFrom >= 0 && to > slashFrom) {
        view.dispatch(view.state.tr.delete(slashFrom, to));
      }
      item.action({ view });
      close(view);
    };

    return [
      new Plugin<SlashMenuState>({
        key: slashMenuPluginKey,
        view(editorView) {
          menu = createMenuDom(ext.options.className);
          menu.dom.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const target = e.target as HTMLElement;
            const row = target.closest<HTMLElement>('[data-slash-item]');
            if (!row) return;
            const id = row.dataset.slashItem;
            const item = ext.storage.items.find((it) => it.id === id);
            if (item) applyItem(editorView, item);
          });
          if (editorView.dom.parentElement) {
            editorView.dom.parentElement.append(menu.dom);
          }
          return {
            update(view) {
              sync(view);
            },
            destroy() {
              menu?.destroy();
              menu = null;
            },
          };
        },
        props: {
          handleTextInput(view, from, _to, text) {
            if (!ext.storage.open) {
              // 空段落或行尾输入 `/` 触发（限制在段首空行，避免路径/数字里的斜杠）
              if (text === '/') {
                const $from = view.state.doc.resolve(from);
                const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
                if ($from.parent.type.name === 'paragraph' && textBefore.trim() === '') {
                  open(view, from);
                }
              }
              return false;
            }
            // 菜单开启：更新 query
            if (text === '/') {
              close(view);
              return false;
            }
            ext.storage.query += text;
            ext.storage.items = ext.options.items(ext.storage.query);
            ext.storage.activeIndex = Math.min(ext.storage.activeIndex, Math.max(0, ext.storage.items.length - 1));
            if (ext.storage.items.length === 0) close(view);
            sync(view);
            return false;
          },
          handleKeyDown(view, event) {
            if (!ext.storage.open) return false;
            const key = event.key;
            if (key === 'Escape') {
              close(view);
              return true;
            }
            if (key === 'ArrowDown' || key === 'ArrowUp') {
              event.preventDefault();
              const count = ext.storage.items.length;
              if (count === 0) return true;
              const dir = key === 'ArrowDown' ? 1 : -1;
              ext.storage.activeIndex = (ext.storage.activeIndex + dir + count) % count;
              sync(view);
              return true;
            }
            if (key === 'Enter') {
              event.preventDefault();
              const item = ext.storage.items[ext.storage.activeIndex];
              if (item) applyItem(view, item);
              return true;
            }
            if (key === 'Backspace') {
              if (ext.storage.query.length > 0) {
                ext.storage.query = ext.storage.query.slice(0, -1);
                ext.storage.items = ext.options.items(ext.storage.query);
                ext.storage.activeIndex = 0;
                sync(view);
                if (ext.storage.items.length === 0) close(view);
                return false; // 让编辑器真正删字符
              }
              close(view);
            }
            return false;
          },
        },
      }),
    ];
  },
});
