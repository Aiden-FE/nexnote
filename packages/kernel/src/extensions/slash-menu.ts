import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { SLASH_ACTION_GROUP_ORDER, sharedSlashAction } from '@nexnote/shared';

/** 快捷插入条目；渲染层和插件可追加条目，内核始终负责输入边界与键盘语义。 */
export interface SlashMenuItem {
  id: string;
  title: string;
  hint?: string;
  keywords?: string[];
  aliases?: string[];
  group?: string;
  /** block-type 只在触发词前没有有效正文时显示。 */
  kind?: 'block-type' | 'structure' | 'inline' | 'ai' | 'plugin';
  action: (ctx: { view: EditorView }) => boolean;
}

export interface SlashMenuState {
  open: boolean;
  query: string;
  items: SlashMenuItem[];
  activeIndex: number;
}

export interface SlashMenuContext {
  /** 当前触发词前没有有效正文，因此允许块类型转换。 */
  emptyBeforeTrigger: boolean;
}

export interface SlashMenuOptions {
  items: (query: string, context?: SlashMenuContext) => SlashMenuItem[];
  className: string;
}

export const slashMenuPluginKey = new PluginKey<SlashMenuState>('nexnoteSlashMenu');
export const SLASH_GROUP_ORDER = SLASH_ACTION_GROUP_ORDER;

export function sortSlashItemsByGroup(items: SlashMenuItem[]): SlashMenuItem[] {
  const rank = (group: string | undefined): number => {
    const index = group ? (SLASH_GROUP_ORDER as readonly string[]).indexOf(group) : -1;
    return index < 0 ? SLASH_GROUP_ORDER.length : index;
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.group) - rank(b.item.group) || a.index - b.index)
    .map(({ item }) => item);
}

export function dedupeSlashItems(items: SlashMenuItem[]): SlashMenuItem[] {
  const lastWins = new Map<string, SlashMenuItem>();
  for (const item of items) lastWins.set(item.id, item);
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return lastWins.get(item.id) === item;
  });
}

function matchingScore(item: SlashMenuItem, query: string): number | null {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return 0;
  const terms = [item.title, item.id, ...(item.aliases ?? []), ...(item.keywords ?? [])].map(
    (term) => term.toLocaleLowerCase(),
  );
  let best: number | null = null;
  for (const term of terms) {
    const score = term === q ? 0 : term.startsWith(q) ? 1 : term.includes(q) ? 2 : null;
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best;
}

/** 按固定分组、组内匹配度稳定排序；最近使用者只能在调用方进一步做组内排序。 */
export function filterSlashItems(
  items: SlashMenuItem[],
  query: string,
  context: SlashMenuContext = { emptyBeforeTrigger: true },
): SlashMenuItem[] {
  return items
    .map((item, index) => ({ item, index, score: matchingScore(item, query) }))
    .filter(
      (entry): entry is { item: SlashMenuItem; index: number; score: number } =>
        entry.score !== null && !(entry.item.kind === 'block-type' && !context.emptyBeforeTrigger),
    )
    .sort((a, b) => {
      const groupA = a.item.group
        ? (SLASH_GROUP_ORDER as readonly string[]).indexOf(a.item.group)
        : -1;
      const groupB = b.item.group
        ? (SLASH_GROUP_ORDER as readonly string[]).indexOf(b.item.group)
        : -1;
      const rankA = groupA < 0 ? SLASH_GROUP_ORDER.length : groupA;
      const rankB = groupB < 0 ? SLASH_GROUP_ORDER.length : groupB;
      return rankA - rankB || a.score - b.score || a.index - b.index;
    })
    .map(({ item }) => item);
}

function replaceCurrentEmptyBlock(
  view: EditorView,
  node: Parameters<typeof view.state.tr.replaceSelectionWith>[0],
): boolean {
  const { $from } = view.state.selection;
  const from = $from.before($from.depth);
  const to = $from.after($from.depth);
  view.dispatch(view.state.tr.replaceWith(from, to, node).scrollIntoView());
  return true;
}

/** 已有正文时，结构块一律附加到当前顶层块后，不从光标处截断内容。 */
function insertAfterCurrentTopLevelBlock(
  view: EditorView,
  node: Parameters<typeof view.state.tr.insert>[1],
): boolean {
  const { $from } = view.state.selection;
  if ($from.depth < 1) return false;
  const at = $from.after(1);
  view.dispatch(view.state.tr.insert(at, node).scrollIntoView());
  return true;
}

function sharedItem(id: string, action: SlashMenuItem['action']): SlashMenuItem {
  const definition = sharedSlashAction(id);
  if (!definition) throw new Error(`Unknown slash action: ${id}`);
  return {
    id,
    title: definition.label,
    hint: definition.aliases.find((alias) => /[#>`|\-[.]/.test(alias)),
    aliases: [...definition.aliases],
    keywords: [...definition.aliases],
    group: definition.group,
    kind: definition.kind,
    action,
  };
}

/** 内核默认动作。结构动作在安全顶层块边界插入；块类型只改写当前空行。 */
export function defaultSlashMenuItems(query = '', context?: SlashMenuContext): SlashMenuItem[] {
  const items: SlashMenuItem[] = [
    sharedItem('paragraph', ({ view }) => {
      const { paragraph } = view.state.schema.nodes;
      if (!paragraph) return false;
      view.dispatch(
        view.state.tr.setBlockType(view.state.selection.from, view.state.selection.to, paragraph),
      );
      return true;
    }),
    ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
      sharedItem(`heading${level}`, ({ view }) => {
        const heading = view.state.schema.nodes.heading;
        if (!heading) return false;
        view.dispatch(
          view.state.tr
            .setBlockType(view.state.selection.from, view.state.selection.to, heading, { level })
            .scrollIntoView(),
        );
        return true;
      }),
    ),
    sharedItem('bulletList', ({ view }) => {
      const { bulletList, listItem, paragraph } = view.state.schema.nodes;
      return bulletList && listItem && paragraph
        ? replaceCurrentEmptyBlock(
            view,
            bulletList.create(null, listItem.create(null, paragraph.create())),
          )
        : false;
    }),
    sharedItem('orderedList', ({ view }) => {
      const { orderedList, listItem, paragraph } = view.state.schema.nodes;
      return orderedList && listItem && paragraph
        ? replaceCurrentEmptyBlock(
            view,
            orderedList.create(null, listItem.create(null, paragraph.create())),
          )
        : false;
    }),
    sharedItem('taskList', ({ view }) => {
      const { taskList, taskItem, paragraph } = view.state.schema.nodes;
      return taskList && taskItem && paragraph
        ? replaceCurrentEmptyBlock(
            view,
            taskList.create(null, taskItem.create(null, paragraph.create())),
          )
        : false;
    }),
    sharedItem('blockquote', ({ view }) => {
      const range = view.state.selection.$from.blockRange(view.state.selection.$to);
      const wrapping = range ? findWrapping(range, view.state.schema.nodes.blockquote!) : null;
      if (!range || !wrapping) return false;
      view.dispatch(view.state.tr.wrap(range, wrapping).scrollIntoView());
      return true;
    }),
    sharedItem('codeBlock', ({ view }) => {
      const codeBlock = view.state.schema.nodes.codeBlock;
      if (!codeBlock) return false;
      view.dispatch(
        view.state.tr
          .setBlockType(view.state.selection.from, view.state.selection.to, codeBlock, {
            language: 'plaintext',
          })
          .scrollIntoView(),
      );
      return true;
    }),
    sharedItem('horizontalRule', ({ view }) => {
      const rule = view.state.schema.nodes.horizontalRule;
      return rule ? insertAfterCurrentTopLevelBlock(view, rule.create()) : false;
    }),
    sharedItem('table', ({ view }) => {
      const { table, tableRow, tableHeader, tableCell, paragraph } = view.state.schema.nodes;
      if (!table || !tableRow || !tableHeader || !tableCell || !paragraph) return false;
      const row = (cell: typeof tableHeader) =>
        tableRow.create(null, [
          cell.create(null, paragraph.create()),
          cell.create(null, paragraph.create()),
        ]);
      return insertAfterCurrentTopLevelBlock(
        view,
        table.create(null, [row(tableHeader), row(tableCell)]),
      );
    }),
    sharedItem('tableOfContents', ({ view }) => {
      const tableOfContents = view.state.schema.nodes.tableOfContents;
      return tableOfContents
        ? insertAfterCurrentTopLevelBlock(view, tableOfContents.create())
        : false;
    }),
    sharedItem('wikilink', ({ view }) => {
      view.dispatch(view.state.tr.insertText('[[').scrollIntoView());
      return true;
    }),
  ];
  return filterSlashItems(items, query, context);
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
  dom.setAttribute('role', 'listbox');
  dom.style.display = 'none';
  dom.style.position = 'absolute';
  dom.style.zIndex = '40';
  return {
    dom,
    render(state, coords) {
      dom.innerHTML = '';
      let lastGroup: string | undefined;
      for (const [index, item] of state.items.entries()) {
        if (item.group !== lastGroup && item.group) {
          lastGroup = item.group;
          const header = document.createElement('div');
          header.className = `${className}__group`;
          header.textContent = item.group;
          dom.append(header);
        }
        const row = document.createElement('div');
        row.className = `${className}__item`;
        row.dataset.slashItem = item.id;
        row.dataset.active = String(index === state.activeIndex);
        row.setAttribute('role', 'option');
        row.textContent = item.hint ? `${item.title}  ${item.hint}` : item.title;
        dom.append(row);
      }
      if (state.items.length === 0) {
        const empty = document.createElement('div');
        empty.className = `${className}__empty`;
        empty.dataset.slashEmpty = '';
        empty.textContent = '没有匹配的快捷动作';
        dom.append(empty);
      }
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

function caretCoords(view: EditorView): { top: number; left: number } {
  const rect = view.coordsAtPos(view.state.selection.from);
  const host = view.dom.parentElement?.getBoundingClientRect();
  return { top: rect.bottom - (host?.top ?? 0) + 6, left: rect.left - (host?.left ?? 0) };
}

function triggerContext(view: EditorView, from: number): SlashMenuContext | null {
  const $from = view.state.doc.resolve(from);
  const parent = $from.parent;
  if (!['paragraph', 'heading'].includes(parent.type.name)) return null;
  if ($from.marks().some((mark) => mark.type.name === 'code' || mark.type.name === 'link'))
    return null;
  const before = parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  if (before.length > 0 && !/\s$/.test(before)) return null;
  return { emptyBeforeTrigger: /^\s*$/.test(before) };
}

export const SlashMenu = Extension.create<SlashMenuOptions, SlashMenuState>({
  name: 'nexnoteSlashMenu',
  addOptions() {
    return { items: defaultSlashMenuItems, className: 'nexnote-slash-menu' };
  },
  addStorage() {
    return { open: false, query: '', items: [], activeIndex: 0 } satisfies SlashMenuState;
  },
  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const extension = this;
    let menu: MenuView | null = null;
    let slashFrom = -1;
    let context: SlashMenuContext = { emptyBeforeTrigger: true };
    const sync = (view: EditorView) => {
      if (!menu) return;
      if (extension.storage.open && !menu.dom.isConnected) view.dom.parentElement?.append(menu.dom);
      if (extension.storage.open) menu.render({ ...extension.storage }, caretCoords(view));
      else menu.hide();
    };
    const close = (view: EditorView) => {
      extension.storage.open = false;
      extension.storage.query = '';
      extension.storage.items = [];
      extension.storage.activeIndex = 0;
      slashFrom = -1;
      sync(view);
    };
    const refresh = (view: EditorView) => {
      extension.storage.items = extension.options.items(extension.storage.query, context);
      extension.storage.activeIndex = Math.min(
        extension.storage.activeIndex,
        Math.max(0, extension.storage.items.length - 1),
      );
      sync(view);
    };
    const open = (view: EditorView, from: number, nextContext: SlashMenuContext) => {
      slashFrom = from;
      context = nextContext;
      extension.storage.open = true;
      extension.storage.query = '';
      extension.storage.activeIndex = 0;
      refresh(view);
    };
    const applyItem = (view: EditorView, item: SlashMenuItem) => {
      const to = view.state.selection.from;
      if (slashFrom < 0 || to < slashFrom) return;
      // Prompt cancellation (AI) returns false before this mutation: Escape/cancel preserves source text.
      if (item.id === 'ai-insert' && !item.action({ view })) return;
      if (to > slashFrom) view.dispatch(view.state.tr.delete(slashFrom, to).scrollIntoView());
      if (item.id !== 'ai-insert' && !item.action({ view })) return;
      close(view);
    };
    return [
      new Plugin<SlashMenuState>({
        key: slashMenuPluginKey,
        view(view) {
          menu = createMenuDom(extension.options.className);
          menu.dom.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const id = (event.target as HTMLElement).closest<HTMLElement>('[data-slash-item]')
              ?.dataset.slashItem;
            const item = extension.storage.items.find((candidate) => candidate.id === id);
            if (item) applyItem(view, item);
          });
          view.dom.parentElement?.append(menu.dom);
          return {
            update: sync,
            destroy: () => {
              menu?.destroy();
              menu = null;
            },
          };
        },
        props: {
          handleTextInput(view, from, _to, text) {
            if (!extension.storage.open) {
              const slashIndex = text.indexOf('/');
              if (slashIndex >= 0) {
                const triggerFrom = from + slashIndex;
                const nextContext = triggerContext(view, triggerFrom);
                if (nextContext) {
                  open(view, triggerFrom, nextContext);
                  extension.storage.query = text.slice(slashIndex + 1);
                  refresh(view);
                }
              }
              return false;
            }
            const inserted = text.startsWith('/') ? text.slice(1) : text;
            if (text === '/' && view.state.selection.from > slashFrom) {
              close(view);
              return false;
            }
            extension.storage.query += inserted;
            refresh(view);
            return false;
          },
          handleKeyDown(view, event) {
            if (!extension.storage.open) return false;
            if (event.key === 'Escape') {
              event.preventDefault();
              close(view);
              return true;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const count = extension.storage.items.length;
              if (count) {
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                extension.storage.activeIndex =
                  (extension.storage.activeIndex + direction + count) % count;
                sync(view);
              }
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              const item = extension.storage.items[extension.storage.activeIndex];
              if (item) applyItem(view, item);
              return true;
            }
            if (event.key === 'Backspace') {
              if (extension.storage.query.length === 0) close(view);
              else {
                extension.storage.query = extension.storage.query.slice(0, -1);
                refresh(view);
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
