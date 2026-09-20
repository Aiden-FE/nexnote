import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import {
  applyMenuViewportPlacement,
  findScrollViewport,
  readMenuHeight,
  readMenuViewport,
  scrollActiveMenuItemIntoView,
} from '@nexnote/kernel';
import { filterQuickInsertCandidates, quickInsertCatalog } from '@nexnote/shared';
import type {
  EditorActionCatalogEntry,
  EditorActionIconKey,
  QuickInsertCapability,
  QuickInsertMetadata,
} from '@nexnote/shared';
import {
  MARKDOWN_TABLE_SNIPPET,
  MERMAID_FLOWCHART_SOURCE,
  MERMAID_GANTT_SOURCE,
  mermaidFence,
  TABLE_OF_CONTENTS_MARKER,
} from '../toolbar/snippets';

interface SlashSession {
  from: number;
  to: number;
  query: string;
  items: SourceSlashAction[];
  activeIndex: number;
  emptyBlock: boolean;
  epoch: number;
}

interface SourceSlashAction extends Omit<EditorActionCatalogEntry, 'quickInsert'> {
  quickInsert: QuickInsertMetadata;
  /** Host capability gate. A disabled plugin must not leak into source quick insert. */
  available?: () => boolean;
  run?: (view: EditorView) => Promise<boolean | string | null>;
}

export interface SourceSlashMenuOptions {
  /** Source menus must never act on an inactive tab or read-only preview. */
  isEnabled(): boolean;
  /** Host notifies immediately when the tab or view becomes inactive. */
  onActivityChange?(notify: () => void): () => void;
  /** Start before consuming the trigger. A failed/cancelled start leaves the text intact. */
  onAiInsert(
    view: EditorView,
    instruction: string,
    apply: (generated: string) => void,
  ): Promise<boolean> | boolean;
  /** Media import returns a vault-relative path; cancelled or failed imports leave /query intact. */
  importMedia?(kind: 'image' | 'attachment'): Promise<string | null>;
  /** Host-owned plugin actions, filtered through the same catalog matching and capabilities. */
  pluginActions?(): SourceSlashAction[];
}

const icons: Record<EditorActionIconKey, string> = {
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
};

function matchesSlashContext(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  // A slash may follow only an otherwise empty Markdown block prefix. This keeps ordinary
  // paths, URLs and words literal while allowing headings, list items and quotes.
  if (
    !/^\s*(?:(?:#{1,6}\s*)|(?:[-+*]\s+(?:\[[ xX]\]\s*)?)|(?:\d+\.\s+)|(?:>\s*))?$/.test(before) &&
    !/\s$/.test(before)
  )
    return false;
  // CodeMirror's Markdown syntax tree identifies fenced/inline code, links and math
  // (including indented fences and nested markup) before textual fallback checks.
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(
    Math.max(0, pos - 1),
    1,
  );
  while (node) {
    if (/Code|URL|Link|Math/.test(node.name)) return false;
    node = node.parent;
  }
  // Lezer's Markdown parser does not register dollar math by default. The configured
  // source parser supplies MathBlock/InlineMath nodes; do not guess from dollar parity.
  return true;
}

function menuItems(
  query: string,
  emptyBlock: boolean,
  plugins: SourceSlashAction[] = [],
): SourceSlashAction[] {
  const capabilities = new Set<QuickInsertCapability>([
    'editable-line',
    'explicit-ai',
    'plugin-defined',
    ...(emptyBlock ? (['empty-block'] as QuickInsertCapability[]) : []),
  ]);
  return filterQuickInsertCandidates(
    [...quickInsertCatalog('source'), ...plugins].flatMap((action) =>
      action.quickInsert
        ? [
            {
              item: action as SourceSlashAction,
              id: action.id,
              title: action.name,
              aliases: action.quickInsert.aliases,
              group: action.quickInsert.group,
              contract: action.quickInsert,
              available: (action as SourceSlashAction).available?.() ?? true,
            },
          ]
        : [],
    ),
    query,
    capabilities,
    emptyBlock,
  );
}

function sourceBlockSnippet(id: string): { text: string; cursor: number } | null {
  if (id === 'block:paragraph') return { text: '', cursor: 0 };
  const heading = /^block:heading:(\d)$/.exec(id);
  if (heading)
    return { text: `${'#'.repeat(Number(heading[1]))} `, cursor: Number(heading[1]) + 1 };
  if (id === 'block:bullet-list') return { text: '- ', cursor: 2 };
  if (id === 'block:ordered-list') return { text: '1. ', cursor: 3 };
  if (id === 'block:task-list') return { text: '- [ ] ', cursor: 6 };
  if (id === 'block:blockquote') return { text: '> ', cursor: 2 };
  if (id === 'block:code') return { text: '```\n\n```', cursor: 4 };
  return null;
}

function structureSnippet(id: string): string | null {
  if (id === 'insert:horizontal-rule') return '---';
  if (id === 'insert:table') return MARKDOWN_TABLE_SNIPPET;
  if (id === 'insert:mermaid-flowchart') return mermaidFence(MERMAID_FLOWCHART_SOURCE);
  if (id === 'insert:mermaid-gantt') return mermaidFence(MERMAID_GANTT_SOURCE);
  if (id === 'insert:toc') return TABLE_OF_CONTENTS_MARKER;
  return null;
}

/** Consume only the owned query, then insert at a whole-line boundary. Never split text. */
function insertSafeBlock(view: EditorView, session: SlashSession, snippet: string): void {
  const state = view.state;
  const line = state.doc.lineAt(session.from);
  const break_ = state.lineBreak;
  const beforeTrigger = state.sliceDoc(line.from, session.from);
  const afterTrigger = state.sliceDoc(session.to, line.to);
  // Find the end of the enclosing top-level Markdown block, not merely this line.
  // Soft-wrapped paragraphs remain one block and may not be split by a structure action.
  let blockEnd = line.to;
  let node = syntaxTree(state).resolveInner(Math.max(line.from, session.from - 1), 1);
  while (node.parent && node.parent.name !== 'Document') node = node.parent;
  if (node.parent?.name === 'Document' && node.to > blockEnd) blockEnd = node.to;
  const replaceLine =
    !`${beforeTrigger}${afterTrigger}`.trim() &&
    /^\s*(?:(?:#{1,6}\s*)|(?:[-+*]\s+(?:\[[ xX]\]\s*)?)|(?:\d+\.\s+)|(?:>\s*))?$/.test(
      beforeTrigger,
    );
  const insertAt = replaceLine ? line.from : blockEnd;
  const replaceTo = replaceLine ? line.to : insertAt;
  const before = state.sliceDoc(0, insertAt);
  const after = state.sliceDoc(replaceTo);
  const prefix =
    before && !before.endsWith(break_ + break_)
      ? before.endsWith(break_)
        ? break_
        : break_ + break_
      : '';
  const suffix =
    after && !after.startsWith(break_ + break_)
      ? after.startsWith(break_)
        ? break_
        : break_ + break_
      : break_;
  const text = `${prefix}${snippet.replace(/\r\n?|\n/g, break_)}${suffix}`;
  const insertedLength = state.toText(text).length;
  // Non-overlapping changes stay in the same local CodeMirror transaction/history event.
  const changes = replaceLine
    ? [{ from: insertAt, to: replaceTo, insert: text }]
    : [
        { from: session.from, to: session.to, insert: '' },
        { from: insertAt, insert: text },
      ];
  view.dispatch({
    changes,
    selection: {
      anchor: insertAt + insertedLength - (replaceLine ? 0 : session.to - session.from),
    },
    scrollIntoView: true,
    userEvent: 'input.complete',
  });
}

/**
 * Markdown-only CodeMirror implementation of the shared quick-insert contract. Its state is
 * deliberately local to the mounted editor: stale menus cannot affect another tab, and every
 * successful non-AI confirmation is one CodeMirror transaction.
 */
export function sourceSlashMenu(options: SourceSlashMenuOptions): Extension {
  let session: SlashSession | null = null;
  let menu: HTMLDivElement | null = null;
  let composing = false;
  let expectedChange = false;
  let ownedBeforeChange: string | null = null;
  let revision = 0;
  let active = false;
  let epoch = 0;
  const enabled = () => {
    const now = options.isEnabled();
    if (active && !now) {
      epoch++;
      close();
    }
    active = now;
    return now;
  };

  const close = () => {
    session = null;
    ownedBeforeChange = null;
    if (menu) menu.style.display = 'none';
  };
  const render = (view: EditorView) => {
    if (!menu || !session || !enabled() || session.epoch !== epoch) return close();
    menu.innerHTML = '';
    let previousGroup: string | undefined;
    for (const [index, action] of session.items.entries()) {
      const quick = action.quickInsert!;
      if (quick.group !== previousGroup) {
        previousGroup = quick.group;
        const group = document.createElement('div');
        group.className = 'nexnote-slash-menu__group';
        group.textContent = quick.group;
        menu.append(group);
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'nexnote-slash-menu__item';
      row.dataset.slashItem = action.id;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === session.activeIndex));
      row.dataset.active = String(index === session.activeIndex);
      row.id = `nexnote-source-slash-option-${index}`;
      const icon = document.createElement('span');
      icon.dataset.slashIcon = action.icon;
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = icons[action.icon];
      row.append(icon, document.createTextNode(action.name));
      if (action.hint) {
        const hint = document.createElement('span');
        hint.className = 'nexnote-slash-menu__hint';
        hint.textContent = ` ${action.hint}`;
        row.append(hint);
      }
      menu.append(row);
    }
    if (session.items.length)
      menu.setAttribute(
        'aria-activedescendant',
        `nexnote-source-slash-option-${session.activeIndex}`,
      );
    else menu.removeAttribute('aria-activedescendant');
    if (!session.items.length) {
      const empty = document.createElement('div');
      empty.dataset.slashEmpty = '';
      empty.className = 'nexnote-slash-menu__empty';
      empty.textContent = '没有匹配的快捷动作';
      menu.append(empty);
    }
    menu.style.display = 'block';
    const place = () => {
      const coords = view.coordsAtPos(view.state.selection.main.head);
      const hostEl = view.dom.parentElement;
      if (!coords || !hostEl) return false;
      const viewportEl = findScrollViewport(view.dom);
      const viewport = readMenuViewport(viewportEl);
      // applyMenuViewportPlacement 已经写好 top/left/maxHeight/overflowY（含上下翻转），
      // 这里不再覆盖原始 caret 坐标，否则视口约束失效。
      applyMenuViewportPlacement({
        menu: menu!,
        host: hostEl,
        anchor: { top: coords.top, bottom: coords.bottom, left: coords.left },
        viewport,
        desiredHeight: readMenuHeight(menu!),
      });
      return true;
    };
    view.requestMeasure({
      read: () => true,
      write: place,
    });
    scrollActiveMenuItemIntoView(menu);
  };
  const availableItems = (query: string, emptyBlock: boolean) => {
    try {
      return menuItems(query, emptyBlock, options.pluginActions?.());
    } catch {
      // A broken plugin registry must not interrupt native CodeMirror input.
      return menuItems(query, emptyBlock);
    }
  };
  const refresh = (view: EditorView) => {
    if (!session) return;
    session.items = availableItems(session.query, session.emptyBlock);
    session.activeIndex = Math.min(session.activeIndex, Math.max(0, session.items.length - 1));
    render(view);
  };
  const confirm = (view: EditorView, action = session?.items[session?.activeIndex ?? 0]) => {
    const current = session;
    if (
      !current ||
      !action ||
      !enabled() ||
      current.epoch !== epoch ||
      view.state.selection.main.head !== current.to
    )
      return;
    const quick = action.quickInsert!;
    if (!availableItems(current.query, current.emptyBlock).some((item) => item.id === action.id))
      return;
    if (quick.execution === 'external-command' || (quick.kind === 'plugin' && action.run)) {
      if (!action.run) return;
      close();
      const startedAt = revision;
      const startedEpoch = epoch;
      void Promise.resolve()
        .then(() => action.run!(view))
        .then((result) => {
          if (
            !result ||
            !view.dom.isConnected ||
            !enabled() ||
            revision !== startedAt ||
            epoch !== startedEpoch ||
            view.state.selection.main.head !== current.to ||
            view.state.sliceDoc(current.from, current.to) !== `/${current.query}`
          )
            return;
          if (typeof result === 'string') insertSafeBlock(view, current, result);
          else
            view.dispatch({
              changes: { from: current.from, to: current.to, insert: '' },
              userEvent: 'input.complete',
            });
        })
        .catch(() => undefined);
      return;
    }
    if (quick.execution === 'convert-empty-block') {
      const snippet = sourceBlockSnippet(action.id);
      const line = view.state.doc.lineAt(current.from);
      if (
        !snippet ||
        !/^\s*(?:(?:#{1,6}\s*)|(?:[-+*]\s+(?:\[[ xX]\]\s*)?)|(?:\d+\.\s+)|(?:>\s*))?$/.test(
          view.state.sliceDoc(line.from, current.from),
        )
      )
        return;
      view.dispatch({
        changes: {
          from: line.from,
          to: current.to,
          insert: snippet.text.replace(/\n/g, view.state.lineBreak),
        },
        selection: {
          anchor: line.from + view.state.toText(snippet.text.slice(0, snippet.cursor)).length,
        },
        scrollIntoView: true,
        userEvent: 'input.complete',
      });
      close();
      return;
    }
    if (quick.execution === 'insert-safe-block') {
      if (action.id === 'insert:image' || action.id === 'insert:attachment') {
        if (!options.importMedia) return;
        const kind = action.id === 'insert:image' ? 'image' : 'attachment';
        close();
        const startedAt = revision;
        const startedEpoch = epoch;
        void Promise.resolve()
          .then(() => options.importMedia!(kind))
          .then((path) => {
            if (
              !path ||
              !view.dom.isConnected ||
              !enabled() ||
              revision !== startedAt ||
              epoch !== startedEpoch ||
              view.state.selection.main.head !== current.to ||
              view.state.sliceDoc(current.from, current.to) !== `/${current.query}`
            )
              return;
            const escaped = encodeURI(path).replace(/\)/g, '%29');
            insertSafeBlock(
              view,
              current,
              kind === 'image' ? `![](${escaped})` : `[附件](${escaped})`,
            );
          })
          .catch(() => undefined);
        return;
      }
      const snippet = structureSnippet(action.id);
      if (!snippet) return;
      insertSafeBlock(view, current, snippet);
      close();
      return;
    }
    if (action.id === 'format:wikilink') {
      view.dispatch({
        changes: { from: current.from, to: current.to, insert: '[[]]' },
        selection: { anchor: current.from + 2 },
        userEvent: 'input.complete',
      });
      close();
      return;
    }
    if (quick.execution === 'explicit-ai') {
      const instruction = window.prompt('AI 插入指令', '请基于当前上下文补充内容');
      if (!instruction?.trim()) return;
      if (
        !view.dom.isConnected ||
        !enabled() ||
        view.state.selection.main.head !== current.to ||
        view.state.sliceDoc(current.from, current.to) !== `/${current.query}`
      )
        return;
      // The writing request is an explicit intent, but the typed trigger belongs to the source
      // until that request actually starts. Capture no remappable position: any intervening edit,
      // tab switch, or unmount makes the eventual Accept a no-op.
      const startedAt = revision;
      const startedEpoch = epoch;
      let committed = false;
      let anchor = -1;
      let source = '';
      let anchorRevision = -1;
      let anchorEpoch = -1;
      const apply = (generated: string) => {
        if (
          !committed ||
          !generated ||
          !view.dom.isConnected ||
          !enabled() ||
          view.state.sliceDoc() !== source ||
          revision !== anchorRevision ||
          epoch !== anchorEpoch
        )
          return;
        view.dispatch({
          changes: { from: anchor, insert: generated },
          selection: { anchor: anchor + generated.length },
          scrollIntoView: true,
          userEvent: 'input.complete',
        });
      };
      void Promise.resolve()
        .then(() => options.onAiInsert(view, instruction, apply))
        .then((started) => {
          if (
            !started ||
            !view.dom.isConnected ||
            !enabled() ||
            revision !== startedAt ||
            epoch !== startedEpoch ||
            view.state.selection.main.head !== current.to ||
            view.state.sliceDoc(current.from, current.to) !== `/${current.query}`
          )
            return;
          anchor = current.from;
          view.dispatch({
            changes: { from: current.from, to: current.to, insert: '' },
            selection: { anchor },
            userEvent: 'input.complete',
          });
          source = view.state.sliceDoc();
          anchorRevision = revision;
          anchorEpoch = epoch;
          committed = true;
          close();
        })
        .catch(() => undefined);
    }
  };

  return [
    EditorView.updateListener.of((update) => {
      enabled();
      if (update.docChanged) revision += 1;
    }),
    EditorView.inputHandler.of((view, from, to, text, insert) => {
      if (!enabled() || composing) return false;
      if (!session) {
        // Only a typed slash opens a menu. Pasting a word/path containing slash stays literal.
        if (text !== '/' || to !== from || !matchesSlashContext(view.state, from)) return false;
        const start = from;
        session = {
          from: start,
          to: start + 1,
          query: '',
          items: [],
          activeIndex: 0,
          epoch,
          emptyBlock:
            /^\s*(?:(?:#{1,6}\s*)|(?:[-+*]\s+(?:\[[ xX]\]\s*)?)|(?:\d+\.\s+)|(?:>\s*))?$/.test(
              view.state.sliceDoc(view.state.doc.lineAt(start).from, start),
            ) && !view.state.sliceDoc(start).split(view.state.lineBreak, 1)[0]?.trim(),
        };
        refresh(view);
        expectedChange = true;
        ownedBeforeChange = view.state.sliceDoc();
        view.dispatch(insert());
        return true;
      }
      if (text.includes('/')) {
        close();
        return false;
      }
      const current = session;
      if (from !== current.to || to !== from) {
        close();
        return false;
      }
      current.query += text;
      current.to += text.length;
      expectedChange = true;
      ownedBeforeChange = view.state.sliceDoc();
      view.dispatch(insert());
      refresh(view);
      return true;
    }),
    Prec.highest(
      keymap.of([
        {
          key: 'Escape',
          run: () => {
            if (!session) return false;
            close();
            return true;
          },
        },
        {
          key: 'ArrowDown',
          run: (view) => {
            if (!session) return false;
            if (session.items.length)
              session.activeIndex = (session.activeIndex + 1) % session.items.length;
            render(view);
            return true;
          },
        },
        {
          key: 'ArrowUp',
          run: (view) => {
            if (!session) return false;
            if (session.items.length)
              session.activeIndex =
                (session.activeIndex - 1 + session.items.length) % session.items.length;
            render(view);
            return true;
          },
        },
        {
          key: 'Enter',
          run: (view) => {
            if (!session) return false;
            if (!enabled() || session.epoch !== epoch) {
              close();
              return true;
            }
            confirm(view);
            return true;
          },
        },
        {
          key: 'Tab',
          run: (view) => {
            if (!session) return false;
            if (!enabled() || session.epoch !== epoch) {
              close();
              return true;
            }
            confirm(view);
            return true;
          },
        },
        {
          key: 'Backspace',
          run: (view) => {
            if (!session) return false;
            if (!session.query.length) {
              close();
              return false;
            }
            const current = session;
            const cursor = view.state.selection.main.head;
            if (cursor !== current.to) {
              close();
              return false;
            }
            current.query = current.query.slice(0, -1);
            current.to -= 1;
            expectedChange = true;
            ownedBeforeChange = view.state.sliceDoc();
            view.dispatch({
              changes: { from: cursor - 1, to: cursor, insert: '' },
              selection: { anchor: cursor - 1 },
              userEvent: 'delete.backward',
            });
            refresh(view);
            return true;
          },
        },
      ]),
    ),
    EditorView.domEventHandlers({
      compositionstart: () => {
        composing = true;
        return false;
      },
      compositionend: () => {
        composing = false;
        return false;
      },
    }),
    ViewPlugin.fromClass(
      class {
        private readonly unsubscribe: () => void;
        private readonly contentDOM: HTMLElement;
        private readonly onKeyDown = (event: KeyboardEvent) => {
          if (event.key !== 'Escape' || !session) return;
          event.preventDefault();
          event.stopPropagation();
          close();
        };
        constructor(view: EditorView) {
          this.unsubscribe =
            options.onActivityChange?.(() => {
              enabled();
            }) ?? (() => undefined);
          this.contentDOM = view.contentDOM;
          this.contentDOM.addEventListener('keydown', this.onKeyDown, true);
          menu = document.createElement('div');
          menu.className = 'nexnote-slash-menu';
          menu.dataset.slashMenu = '';
          menu.dataset.testid = 'source-slash-menu';
          menu.setAttribute('role', 'listbox');
          menu.setAttribute('aria-label', '快捷插入动作');
          menu.style.cssText = 'display:none;position:absolute;z-index:40';
          const activate = (event: MouseEvent) => {
            if (event.type === 'mousedown') event.preventDefault();
            const id = (event.target as HTMLElement).closest<HTMLElement>('[data-slash-item]')
              ?.dataset.slashItem;
            const action = session?.items.find((item) => item.id === id);
            if (action) confirm(view, action);
          };
          menu.addEventListener('mousedown', activate);
          // Keyboard activation of a menu button delivers click without mousedown.
          menu.addEventListener('click', activate);
          view.dom.parentElement?.append(menu);
        }
        update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean }) {
          if (!session) return;
          if (
            session.epoch !== epoch ||
            !enabled() ||
            !update.view.state.selection.main.empty ||
            update.view.state.selection.main.head !== session.to ||
            update.view.state.sliceDoc(session.from, session.to) !== `/${session.query}`
          )
            return close();
          if (
            update.docChanged &&
            (!expectedChange ||
              ownedBeforeChange === null ||
              !update.view.state.sliceDoc().startsWith(ownedBeforeChange.slice(0, session.from)))
          )
            return close();
          expectedChange = false;
          ownedBeforeChange = null;
          if (update.docChanged || update.selectionSet) render(update.view);
        }
        destroy() {
          this.unsubscribe?.();
          this.contentDOM.removeEventListener('keydown', this.onKeyDown, true);
          menu?.remove();
          menu = null;
          session = null;
        }
      },
    ),
  ];
}
