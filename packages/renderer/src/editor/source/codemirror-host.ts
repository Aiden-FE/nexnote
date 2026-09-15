import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { CODE_LANGUAGES } from '@nexnote/shared';
import { codeLanguages } from './fence-languages';
import { fenceHighlightExtension } from './fence-highlight';
import { EditorState, type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

export const sourceCodeLanguages = CODE_LANGUAGES;

export interface SourceEditorHandle {
  /** CodeMirror 视图实例（AI 辅助事务写回/坐标查询用）。 */
  readonly view: EditorView;
  readonly scrollDOM: HTMLElement;
  getText(): string;
  setText(text: string): void;
  focus(): void;
  destroy(): void;
}

/**
 * 行尾块锚点（`^id`，Obsidian `^` 后接字母/数字/连字符）在行内的区间。
 * 源码模式按字节显示原文，锚点是块编辑模式的内部元数据：视觉上弱化，但可正常编辑与保存。
 */
export function blockAnchorRange(line: string): { from: number; to: number } | null {
  const match = /(?:^|\s)(\^[A-Za-z0-9-]+)\s*$/.exec(line);
  const anchor = match?.[1];
  if (!match || !anchor) return null;
  const from = match.index + match[0].indexOf(anchor);
  return { from, to: from + anchor.length };
}

/** 位置处于代码围栏/行内代码内：其中的 `^id` 是字面内容，不做弱化。 */
function insideCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node) {
    if (node.name.includes('Code')) return true;
    const parent = node.parent;
    if (!parent) break;
    node = parent;
  }
  return false;
}

function anchorDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const mark = Decoration.mark({ class: 'cm-block-anchor' });
  const doc = view.state.doc;
  const visitedLines = new Set<number>();
  for (const visibleRange of view.visibleRanges) {
    let pos = visibleRange.from;
    while (pos <= visibleRange.to) {
      const line = doc.lineAt(pos);
      if (!visitedLines.has(line.from)) {
        visitedLines.add(line.from);
        const range = blockAnchorRange(line.text);
        if (range) {
          const from = line.from + range.from;
          if (!insideCode(view.state, from)) {
            decorations.push(mark.range(from, line.from + range.to));
          }
        }
      }
      if (line.to >= visibleRange.to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(decorations, true);
}

export function createSourceEditor(
  parent: HTMLElement,
  options: {
    initialText: string;
    onChange(text: string): void;
    onScroll?(scrollDOM: HTMLElement): void;
    /** 追加扩展（如划词工具栏、AI 辅助），随编辑器一次性装配。 */
    extraExtensions?: Extension[];
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
        markdown({ codeLanguages }),
        fenceHighlightExtension,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // 块锚点弱化显示（只读元数据）：低透明度，不改变任何字节。
        ViewPlugin.fromClass(
          class {
            decorations: DecorationSet;
            constructor(view: EditorView) {
              this.decorations = anchorDecorations(view);
            }
            update(update: ViewUpdate) {
              if (
                update.docChanged ||
                update.viewportChanged ||
                syntaxTree(update.startState) !== syntaxTree(update.state)
              ) {
                this.decorations = anchorDecorations(update.view);
              }
            }
          },
          { decorations: (v) => v.decorations },
        ),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          },
          '.cm-content': { padding: '16px 0', caretColor: 'var(--foreground)' },
          '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
          '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--border)' },
          '.cm-block-anchor': { opacity: '0.45' },
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
        ...(options.extraExtensions ?? []),
      ],
    }),
  });

  return {
    view,
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
