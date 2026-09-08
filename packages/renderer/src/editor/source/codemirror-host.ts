import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

export interface SourceEditorHandle {
  readonly scrollDOM: HTMLElement;
  getText(): string;
  setText(text: string): void;
  focus(): void;
  destroy(): void;
}

export function createSourceEditor(
  parent: HTMLElement,
  options: {
    initialText: string;
    onChange(text: string): void;
    onScroll?(scrollDOM: HTMLElement): void;
  },
): SourceEditorHandle {
  let programmatic = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.initialText,
      extensions: [
        lineNumbers(),
        history(),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          },
          '.cm-content': { padding: '16px 0' },
          '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--border)' },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !programmatic) options.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          scroll: () => {
            options.onScroll?.(view.scrollDOM);
            return false;
          },
        }),
      ],
    }),
  });

  return {
    scrollDOM: view.scrollDOM,
    getText: () => view.state.doc.toString(),
    setText(text) {
      if (text === view.state.doc.toString()) return;
      programmatic = true;
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      } finally {
        programmatic = false;
      }
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
