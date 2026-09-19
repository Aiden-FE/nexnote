import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import { SLASH_ACTION_GROUP_ORDER, filterQuickInsertCandidates } from '@nexnote/shared';
import type { EditorActionIconKey, QuickInsertKind } from '@nexnote/shared';
import { defaultQuickInsertItems } from './quick-insert-catalog';
import {
  canExecuteSlashAction,
  consumeSlashTrigger,
  type SlashActionTransaction,
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
  /**
   * 可编辑器写入的 action 只能修改 `transaction.tr`，由菜单在成功后统一 dispatch。
   * 异步媒体动作仅在原始文档未变时提交；显式 AI 意图保留 trigger，不回溯消费。
   */
  action: (transaction: SlashActionTransaction) => boolean | Promise<boolean>;
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

export function filterQuickInsertItems(
  items: QuickInsertItem[],
  query: string,
  context: SlashExecutionContext,
): QuickInsertItem[] {
  return filterQuickInsertCandidates(
    items.map((item) => ({
      item,
      id: item.id,
      title: item.title,
      aliases: item.aliases,
      keywords: item.keywords,
      group: item.group,
      contract: item.contract,
      available: item.available?.(context) ?? true,
    })),
    query,
    context.capabilities,
    context.emptyBlock,
  );
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
  const textblockFrom = $from.before($from.depth);
  const textblockTo = $from.after($from.depth);
  return {
    triggerFrom: from,
    // handleTextInput fires before the input transaction. Include the slash immediately;
    // later transactions advance this endpoint from the actual selection.
    triggerTo: from + 1,
    textblockFrom,
    textblockTo,
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
    let composing = false;
    let suppressNextDomSlashFallback = false;
    let pendingInput: {
      from: number;
      text: string;
      before: string;
      previousCursor: number;
      documentDelta: number;
    } | null = null;
    const sync = (view: EditorView) => {
      if (!menu) return;
      if (extension.storage.open && !menu.dom.isConnected) view.dom.parentElement?.append(menu.dom);
      if (extension.storage.open)
        menu.render({ ...extension.storage }, quickInsertCaretCoords(view));
      else menu.hide();
    };
    const close = (view: EditorView) => {
      pendingInput = null;
      Object.assign(extension.storage, { open: false, query: '', items: [], activeIndex: 0 });
      context = null;
      sync(view);
    };
    const sessionIsCurrent = (
      view: EditorView,
      candidate = context,
    ): candidate is SlashExecutionContext => {
      if (!candidate || !view.state.selection.empty) return false;
      const { from } = view.state.selection;
      if (from !== candidate.triggerTo) return false;
      const $from = view.state.doc.resolve(from);
      if ($from.depth < 1 || $from.before($from.depth) !== candidate.textblockFrom) return false;
      if (candidate.triggerTo > $from.after($from.depth)) return false;
      return (
        candidate.triggerTo <= view.state.doc.content.size &&
        view.state.doc.textBetween(
          candidate.triggerFrom,
          candidate.triggerTo,
          undefined,
          '\ufffc',
        ) === `/${extension.storage.query}`
      );
    };
    const refresh = (view: EditorView) => {
      if (!context) return;
      // The input hook sees the next character before DOMObserver commits it. Recompute the
      // owned range only after that input transaction; no other transaction may reinterpret it.
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
        !sessionIsCurrent(view) ||
        view.state.selection.from !== context.triggerTo ||
        !canExecuteSlashAction(item.contract, context) ||
        !(item.available?.(context) ?? true)
      )
        return;
      const executingContext = context;
      const ownedText = `/${extension.storage.query}`;
      // A false/rejected/cancelled action must leave `/query` untouched. Synchronous actions
      // receive one un-dispatched transaction: trigger consumption and the action therefore form
      // exactly one TipTap history step. Explicit AI is deliberately separate: its prompt/request
      // may stream later, so it closes the menu but preserves the source text rather than
      // attempting an unsafe future transaction after a streamed result.
      const afterSlashCommit: Array<() => void> = [];
      const transaction: SlashActionTransaction = {
        view,
        tr: view.state.tr,
        context: executingContext,
        afterSlashCommit: (callback) => afterSlashCommit.push(callback),
      };
      const commitExplicitAi = () => {
        const committed = view.state.tr;
        consumeSlashTrigger(committed, executingContext);
        view.dispatch(closeHistory(committed.scrollIntoView()));
        for (const callback of afterSlashCommit) callback();
        close(view);
      };
      try {
        if (
          item.contract?.execution !== 'explicit-ai' &&
          item.contract?.execution !== 'external-command'
        )
          consumeSlashTrigger(transaction.tr, executingContext);
        const outcome = item.action(transaction);
        if (outcome instanceof Promise) {
          void outcome.then(
            (success) => {
              if (!success) return;
              // All async completions must revalidate the owned range and exact source.
              // AI consumes only on explicit success; cancelled/failed requests retain the query.
              if (
                view.isDestroyed ||
                !extension.storage.open ||
                context !== executingContext ||
                !sessionIsCurrent(view, executingContext) ||
                view.state.doc.textBetween(
                  executingContext.triggerFrom,
                  executingContext.triggerTo,
                  undefined,
                  '\ufffc',
                ) !== ownedText
              )
                return;
              if (item.contract?.execution === 'explicit-ai') {
                commitExplicitAi();
                return;
              }
              if (item.contract?.execution === 'external-command') {
                // The plugin has no editor transaction of its own; consume only after the host
                // confirms success, even if unrelated document edits happened while awaiting it.
                const committed = view.state.tr;
                consumeSlashTrigger(committed, executingContext);
                view.dispatch(closeHistory(committed.scrollIntoView()));
              } else {
                if (!view.state.doc.eq(transaction.tr.before)) return;
                view.dispatch(closeHistory(transaction.tr.scrollIntoView()));
              }
              close(view);
            },
            () => undefined,
          );
          return;
        }
        if (!outcome) return;
        if (
          item.contract?.execution === 'explicit-ai' ||
          item.contract?.execution === 'external-command'
        ) {
          if (!sessionIsCurrent(view, executingContext)) return;
          if (item.contract?.execution === 'explicit-ai') {
            commitExplicitAi();
            return;
          }
          const committed = view.state.tr;
          consumeSlashTrigger(committed, executingContext);
          view.dispatch(closeHistory(committed.scrollIntoView()));
          close(view);
          return;
        }
        view.dispatch(closeHistory(transaction.tr.scrollIntoView()));
        close(view);
      } catch {
        // Keep original text after an action failure; the un-dispatched transaction is discarded.
      }
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
              const isElectronInput = /Electron/i.test(
                view.dom.ownerDocument.defaultView?.navigator.userAgent ?? '',
              );
              if (
                isElectronInput &&
                !extension.storage.open &&
                !previousState.doc.eq(view.state.doc)
              ) {
                const sel = view.state.selection;
                const delta = view.state.doc.content.size - previousState.doc.content.size;
                if (suppressNextDomSlashFallback) {
                  suppressNextDomSlashFallback = false;
                  sync(view);
                  return;
                }
                const insertedOne =
                  sel.empty &&
                  delta === 1 &&
                  view.state.doc.textBetween(sel.from - 1, sel.from, undefined, '\ufffc');
                const insertedTwo =
                  sel.empty &&
                  delta === 2 &&
                  view.state.doc.textBetween(sel.from - 2, sel.from, undefined, '\ufffc');
                const slashPos =
                  insertedOne === '/' ? sel.from - 1 : insertedTwo === ' /' ? sel.from - 1 : -1;
                if (slashPos >= 0) {
                  const next = triggerContext(view, slashPos);
                  if (next) {
                    context = next;
                    pendingInput = {
                      from: next.triggerFrom,
                      text: insertedTwo === ' /' ? ' /' : '/',
                      before: '',
                      previousCursor: slashPos,
                      documentDelta: insertedTwo === ' /' ? 2 : 1,
                    };
                    extension.storage.open = true;
                    extension.storage.query = '';
                    extension.storage.activeIndex = 0;
                    refresh(view);
                  }
                }
                sync(view);
                return;
              }
              if (!extension.storage.open || !context) {
                sync(view);
                return;
              }
              if (!previousState.doc.eq(view.state.doc)) {
                // A DOMObserver input is the only operation allowed to grow/shrink the query.
                // Before accepting it, verify the previous owned text, the exact inserted
                // input and the current textblock; an unrelated transaction fails closed.
                const input = pendingInput;
                pendingInput = null;
                const validInput =
                  input &&
                  previousState.selection.from === input.previousCursor &&
                  previousState.doc.content.size + input.documentDelta ===
                    view.state.doc.content.size &&
                  previousState.doc.textBetween(
                    context.triggerFrom,
                    input.from,
                    undefined,
                    '\ufffc',
                  ) === input.before &&
                  view.state.doc.textBetween(
                    input.from,
                    input.from + input.text.length,
                    undefined,
                    '\ufffc',
                  ) === input.text;
                if (!validInput || !sessionIsCurrent(view)) {
                  close(view);
                  return;
                }
              } else if (!sessionIsCurrent(view)) {
                close(view);
                return;
              }
              sync(view);
            },
            destroy: () => {
              menu?.destroy();
              menu = null;
            },
          };
        },
        props: {
          handleDOMEvents: {
            compositionstart() {
              composing = true;
              return false;
            },
            compositionend() {
              composing = false;
              suppressNextDomSlashFallback = true;
              return false;
            },
          },
          handleTextInput(view, from, _to, text) {
            if (composing || view.composing) return false;
            if (!extension.storage.open) {
              const index = text.indexOf('/');
              if (index >= 0) {
                const next = triggerContext(view, from + index);
                if (next) {
                  context = next;
                  pendingInput = {
                    from: next.triggerFrom,
                    text: text.slice(index),
                    before: '',
                    previousCursor: from,
                    documentDelta: text.slice(index).length,
                  };
                  extension.storage.open = true;
                  extension.storage.query = text.slice(index + 1);
                  extension.storage.activeIndex = 0;
                  refresh(view);
                }
              }
              return false;
            }
            // A second slash turns this into a path/URL-like token. Close and retain
            // ordinary text; subsequent characters cannot reopen from inside the token.
            if (text.includes('/')) {
              close(view);
              return false;
            }
            if (context)
              pendingInput = {
                from: context.triggerTo,
                text,
                before: `/${extension.storage.query}`,
                previousCursor: view.state.selection.from,
                documentDelta: text.length,
              };
            extension.storage.query += text;
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
              if (!sessionIsCurrent(view)) {
                close(view);
                return false;
              }
              if (!extension.storage.query.length) close(view);
              else {
                pendingInput = {
                  from: context?.triggerTo ?? 0,
                  text: '',
                  before: `/${extension.storage.query}`,
                  previousCursor: view.state.selection.from,
                  documentDelta: -1,
                };
                extension.storage.query = extension.storage.query.slice(0, -1);
                if (context) context = { ...context, triggerTo: context.triggerTo - 1 };
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
