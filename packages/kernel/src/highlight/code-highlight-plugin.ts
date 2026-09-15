import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { fenceHighlighter, type FenceHighlighter } from './fence-highlight';

export const codeHighlightPluginKey = new PluginKey<DecorationSet>('nexnote-code-highlight');

function buildDecorations(doc: PMNode, highlighter: FenceHighlighter): DecorationSet {
  const decorations: ReturnType<typeof Decoration.inline>[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    const spans = highlighter.tokenSpans(node.attrs.language as string | null, node.textContent);
    for (const span of spans ?? []) {
      if (span.to > span.from) {
        decorations.push(
          Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, { class: span.className }),
        );
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}

function languagesInDocument(doc: PMNode): string[] {
  const languages = new Set<string>();
  doc.descendants((node) => {
    if (
      node.type.name === 'codeBlock' &&
      typeof node.attrs.language === 'string' &&
      node.attrs.language
    ) {
      languages.add(node.attrs.language);
    }
  });
  return [...languages];
}

export function createCodeHighlightPlugin(highlighter = fenceHighlighter): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: codeHighlightPluginKey,
    state: {
      init: (_, state) => buildDecorations(state.doc, highlighter),
      apply: (transaction, decorations, _oldState, newState) => {
        if (transaction.docChanged || transaction.getMeta(codeHighlightPluginKey) === 'refresh') {
          return buildDecorations(newState.doc, highlighter);
        }
        return decorations.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations: (state) => codeHighlightPluginKey.getState(state) ?? DecorationSet.empty,
    },
    view: (view: EditorView) => {
      let queued = false;
      const requestRefresh = (): void => {
        if (queued || view.isDestroyed) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (!view.isDestroyed)
            view.dispatch(view.state.tr.setMeta(codeHighlightPluginKey, 'refresh'));
        });
      };
      const unsubscribe = highlighter.subscribe(requestRefresh);
      const ensureDocumentLanguages = (): void => {
        for (const language of languagesInDocument(view.state.doc))
          void highlighter.ensure(language);
      };
      ensureDocumentLanguages();
      return {
        update() {
          ensureDocumentLanguages();
        },
        destroy() {
          unsubscribe();
        },
      };
    },
  });
}
