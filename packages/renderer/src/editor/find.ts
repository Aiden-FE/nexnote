import type { EditorView as CodeMirrorView } from '@codemirror/view';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView as ProseMirrorView } from '@tiptap/pm/view';
import { revealBlockFoldAt } from '@nexnote/kernel';
import { revealSourceHeadingAt } from './source/heading-fold';

export interface EditorFindResult {
  current: number;
  total: number;
}

export interface TextMatch {
  from: number;
  to: number;
}

/**
 * Fold whole strings to preserve context-sensitive casing (ΟΣ → ος), then map folded
 * UTF-16 units to source spans. Per-code-point folds retain length mapping when casing expands
 * (İ → i + ◌̇). For contextual substitutions the whole-string fold has the same length;
 * if that invariant fails, fail closed rather than selecting an incorrect source range.
 */
function foldedText(text: string): { value: string; spans: TextMatch[] } {
  const value = text.toLocaleLowerCase();
  const spans: TextMatch[] = [];
  let from = 0;
  for (const character of text) {
    for (let index = 0; index < character.toLocaleLowerCase().length; index++) {
      spans.push({ from, to: from + character.length });
    }
    from += character.length;
  }
  return { value, spans: spans.length === value.length ? spans : [] };
}

/** Return offsets in the original UTF-16 string, never offsets in case-folded text. */
export function textMatches(text: string, query: string): TextMatch[] {
  const needle = foldedText(query).value;
  if (!needle) return [];
  const { value, spans } = foldedText(text);
  if (spans.length !== value.length) return [];
  const matches: TextMatch[] = [];
  let start = 0;
  while (start <= value.length - needle.length) {
    const index = value.indexOf(needle, start);
    if (index < 0) break;
    const match = { from: spans[index]!.from, to: spans[index + needle.length - 1]!.to };
    if (matches.at(-1)?.from !== match.from || matches.at(-1)?.to !== match.to) {
      matches.push(match);
    }
    start = index + Math.max(1, needle.length);
  }
  return matches;
}

function targetIndex(
  matches: readonly TextMatch[],
  currentFrom: number,
  direction: 1 | -1,
  restart: boolean,
): number {
  if (matches.length === 0) return -1;
  if (restart) return direction === 1 ? 0 : matches.length - 1;
  if (direction === 1) {
    const next = matches.findIndex((match) => match.from > currentFrom);
    return next >= 0 ? next : 0;
  }
  for (let index = matches.length - 1; index >= 0; index--) {
    if (matches[index]!.from < currentFrom) return index;
  }
  return matches.length - 1;
}

/** CodeMirror positions count any configured line separator as one UTF-16 unit, including CRLF. */
function sourceSearchText(view: CodeMirrorView): string {
  const { doc } = view.state;
  return Array.from({ length: doc.lines }, (_unused, index) => doc.line(index + 1).text).join('\n');
}

export function findInSourceView(
  view: CodeMirrorView,
  query: string,
  direction: 1 | -1,
  restart: boolean,
): EditorFindResult {
  const matches = textMatches(sourceSearchText(view), query);
  const index = targetIndex(matches, view.state.selection.main.from, direction, restart);
  if (index < 0) return { current: 0, total: 0 };
  const match = matches[index]!;
  revealSourceHeadingAt(view, match.from);
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
  return { current: index + 1, total: matches.length };
}

/**
 * Search one textblock at a time: adjacent marked text nodes are continuous visible text, but
 * adjacent blocks are not. Map its raw UTF-16 offsets back to ProseMirror document positions.
 */
function blockMatches(view: ProseMirrorView, query: string): TextMatch[] {
  const matches: TextMatch[] = [];
  view.state.doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return;
    let text = '';
    const positions: number[] = [];
    block.forEach((node, offset) => {
      if (!node.isText || !node.text) {
        // A hard break or inline atom is not continuous text across its boundary.
        text += '\u0000';
        positions.push(-1);
        return;
      }
      text += node.text;
      for (let index = 0; index < node.text.length; index++) {
        positions.push(blockPos + 1 + offset + index);
      }
    });
    for (const match of textMatches(text, query)) {
      const from = positions[match.from];
      const end = positions[match.to - 1];
      if (from !== undefined && from >= 0 && end !== undefined && end >= 0) {
        matches.push({ from, to: end + 1 });
      }
    }
    return false;
  });
  return matches;
}

export function findInBlockView(
  view: ProseMirrorView,
  query: string,
  direction: 1 | -1,
  restart: boolean,
): EditorFindResult {
  const matches = blockMatches(view, query);
  const index = targetIndex(matches, view.state.selection.from, direction, restart);
  if (index < 0) return { current: 0, total: 0 };
  const match = matches[index]!;
  revealBlockFoldAt(view, match.from);
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
      .scrollIntoView(),
  );
  return { current: index + 1, total: matches.length };
}
