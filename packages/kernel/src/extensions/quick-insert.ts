import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { SLASH_ACTION_GROUP_ORDER } from '@nexnote/shared';
import type { EditorActionIconKey, QuickInsertKind } from '@nexnote/shared';
import { defaultQuickInsertItems } from './quick-insert-catalog';
import {
  canExecuteSlashAction,
  consumeSlashTrigger,
  type SlashExecutionContext,
  type SlashExecutionContract,
} from './slash-contract';
import { createQuickInsertView, quickInsertCaretCoords, type QuickInsertView } from './menu-view';

export interface QuickInsertItem {
  id: string;
  title: string;
  hint?: string;
  icon?: EditorActionIconKey;
  keywords?: string[];
  aliases?: string[];
  group?: string;
  kind?: QuickInsertKind;
  contract?: SlashExecutionContract;
  available?: (context: SlashExecutionContext) => boolean;
  action: (ctx: { view: EditorView; context: SlashExecutionContext }) => boolean;
}

export interface SlashMenuState {
  open: boolean;
  query: string;
  items: QuickInsertItem[];
  activeIndex: number;
}
export interface QuickInsertOptions {
  items: (query: string, context: SlashExecutionContext) => QuickInsertItem[];
  className: string;
}

export const slashMenuPluginKey = new PluginKey<SlashMenuState>('nexnoteSlashMenu');
export const SLASH_GROUP_ORDER = SLASH_ACTION_GROUP_ORDER;

export function dedupeQuickInsertItems(items: QuickInsertItem[]): QuickInsertItem[] {
  const last = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  return items.filter(
    (item) => !seen.has(item.id) && (seen.add(item.id), last.get(item.id) === item),
  );
}

function matchScore(item: QuickInsertItem, query: string): number | null {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return 0;
  const terms = [item.title, item.id, ...(item.aliases ?? []), ...(item.keywords ?? [])].map(
    (term) => term.toLocaleLowerCase(),
  );
  return terms.reduce<number | null>((best, term) => {
    const score = term === q ? 0 : term.startsWith(q) ? 1 : term.includes(q) ? 2 : null;
    return score === null || (best !== null && best <= score) ? best : score;
  }, null);
}

export function filterQuickInsertItems(
  items: QuickInsertItem[],
  query: string,
  context: SlashExecutionContext,
): QuickInsertItem[] {
  const rank = (group?: string) =>
    Math.max(0, (SLASH_GROUP_ORDER as readonly string[]).indexOf(group ?? '')) ||
    (group === '基础块' ? 0 : SLASH_GROUP_ORDER.length);
  return items
    .map((item, index) => ({ item, index, score: matchScore(item, query) }))
    .filter(
      (entry): entry is { item: QuickInsertItem; index: number; score: number } =>
        entry.score !== null &&
        canExecuteSlashAction(entry.item.contract, context) &&
        (entry.item.available?.(context) ?? true),
    )
    .sort(
      (a, b) => rank(a.item.group) - rank(b.item.group) || a.score - b.score || a.index - b.index,
    )
    .map(({ item }) => item);
}

function triggerContext(view: EditorView, from: number): SlashExecutionContext | null {
  const $from = view.state.doc.resolve(from);
  const parent = $from.parent;
  if (!['paragraph', 'heading'].includes(parent.type.name)) return null;
  const before = parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const after = parent.textBetween($from.parentOffset, parent.content.size, undefined, '\ufffc');
  const inMath = /(?:^|[^\\])\$(?:\$)?[^$]*$/.test(before);
  if (inMath || $from.marks().some((mark) => ['code', 'link'].includes(mark.type.name)))
    return null;
  if (before.length && !/\s$/.test(before)) return null;
  const emptyBlock = /^\s*$/.test(before) && /^\s*$/.test(after);
  const blockFrom = $from.before(1);
  const blockTo = $from.after(1);
  return {
    triggerFrom: from,
    // handleTextInput fires before the input transaction. Include the slash immediately;
    // later transactions advance this endpoint from the actual selection.
    triggerTo: from + 1,
    blockFrom,
    blockTo,
    emptyBlock,
    capabilities: new Set([
      'editable-line',
      'explicit-ai',
      'plugin-defined',
      ...(emptyBlock ? (['empty-block'] as const) : []),
    ]),
  };
}

export const QuickInsert = Extension.create<QuickInsertOptions, SlashMenuState>({
  name: 'nexnoteSlashMenu',
  addOptions: () => ({
    items: (query, context) => filterQuickInsertItems(defaultQuickInsertItems(), query, context),
    className: 'nexnote-slash-menu',
  }),
  addStorage: () => ({ open: false, query: '', items: [], activeIndex: 0 }),
  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const extension = this;
    let menu: QuickInsertView | null = null;
    let context: SlashExecutionContext | null = null;
    const sync = (view: EditorView) => {
      if (!menu) return;
      if (extension.storage.open && !menu.dom.isConnected) view.dom.parentElement?.append(menu.dom);
      if (extension.storage.open)
        menu.render({ ...extension.storage }, quickInsertCaretCoords(view));
      else menu.hide();
    };
    const close = (view: EditorView) => {
      Object.assign(extension.storage, { open: false, query: '', items: [], activeIndex: 0 });
      context = null;
      sync(view);
    };
    const selectionMatchesTrigger = (view: EditorView): boolean => {
      if (!context || !view.state.selection.empty) return false;
      const { from } = view.state.selection;
      if (from < context.triggerFrom || from > context.blockTo) return false;
      const $from = view.state.doc.resolve(from);
      return $from.depth >= 1 && $from.before(1) === context.blockFrom;
    };
    const refresh = (view: EditorView) => {
      if (!context) return;
      if (!selectionMatchesTrigger(view)) {
        close(view);
        return;
      }
      // ProseMirror may publish selection updates before DOMObserver has advanced the
      // selection. The exact owned range is therefore derived from the committed input
      // query, whose characters entered through handleTextInput, not from a stale cursor.
      context = {
        ...context,
        triggerTo: context.triggerFrom + 1 + extension.storage.query.length,
      };
      extension.storage.items = extension.options.items(extension.storage.query, context);
      extension.storage.activeIndex = Math.min(
        extension.storage.activeIndex,
        Math.max(0, extension.storage.items.length - 1),
      );
      sync(view);
    };
    const apply = (view: EditorView, item: QuickInsertItem) => {
      if (
        !context ||
        !canExecuteSlashAction(item.contract, context) ||
        !(item.available?.(context) ?? true)
      )
        return;
      const executingContext = context;
      // All action classes consume only the tracked `/query` span. Structural handlers
      // themselves insert at a top-level boundary and never replace current body text.
      consumeSlashTrigger(view, executingContext);
      if (!item.action({ view, context: executingContext })) return;
      close(view);
    };
    return [
      new Plugin<SlashMenuState>({
        key: slashMenuPluginKey,
        view(view) {
          menu = createQuickInsertView(extension.options.className);
          menu.dom.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const id = (event.target as HTMLElement).closest<HTMLElement>('[data-slash-item]')
              ?.dataset.slashItem;
            const item = extension.storage.items.find((candidate) => candidate.id === id);
            if (item) apply(view, item);
          });
          view.dom.parentElement?.append(menu.dom);
          return {
            update(view, previousState) {
              // A typing transaction maps the active selection. Only selection-only moves
              // may invalidate a trigger; closing during a doc change loses the next query char.
              if (
                extension.storage.open &&
                previousState.doc.eq(view.state.doc) &&
                !selectionMatchesTrigger(view)
              )
                close(view);
              else sync(view);
            },
            destroy: () => {
              menu?.destroy();
              menu = null;
            },
          };
        },
        props: {
          handleTextInput(view, from, _to, text) {
            if (!extension.storage.open) {
              const index = text.indexOf('/');
              if (index >= 0) {
                const next = triggerContext(view, from + index);
                if (next) {
                  context = next;
                  extension.storage.open = true;
                  extension.storage.query = text.slice(index + 1);
                  extension.storage.activeIndex = 0;
                  refresh(view);
                }
              }
              return false;
            }
            extension.storage.query += text.startsWith('/') ? text.slice(1) : text;
            if (context)
              context = {
                ...context,
                triggerTo: context.triggerFrom + 1 + extension.storage.query.length,
              };
            extension.storage.items = context
              ? extension.options.items(extension.storage.query, context)
              : [];
            sync(view);
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
              if (count)
                extension.storage.activeIndex =
                  (extension.storage.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) %
                  count;
              sync(view);
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              const item = extension.storage.items[extension.storage.activeIndex];
              if (item) apply(view, item);
              return true;
            }
            if (event.key === 'Backspace') {
              if (!extension.storage.query.length) close(view);
              else extension.storage.query = extension.storage.query.slice(0, -1);
            }
            return false;
          },
        },
      }),
    ];
  },
});
