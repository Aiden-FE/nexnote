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

/** Case folding may expand a character (İ → i + ◌̇). Map every folded UTF-16 unit back to the original span. */
function foldedText(text: string): { value: string; spans: TextMatch[] } {
  let value = '';
  const spans: TextMatch[] = [];
  let from = 0;
  for (const character of text) {
    const folded = character.toLocaleLowerCase();
    value += folded;
    for (let index = 0; index < folded.length; index++) {
      spans.push({ from, to: from + character.length });
    }
    from += character.length;
  }
  return { value, spans };
}

/** Return offsets in the original UTF-16 string, never offsets in case-folded text. */
export function textMatches(text: string, query: string): TextMatch[] {
  const needle = foldedText(query).value;
  if (!needle) return [];
  const { value, spans } = foldedText(text);
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

export function findInSourceView(
  view: CodeMirrorView,
  query: string,
  direction: 1 | -1,
  restart: boolean,
): EditorFindResult {
  const matches = textMatches(view.state.sliceDoc(), query);
  const index = targetIndex(matches, view.state.selection.main.from, direction, restart);
  if (index < 0) return { current: 0, total: 0 };
  const match = matches[index]!;
  revealSourceHeadingAt(view, match.from);
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
  return { current: index + 1, total: matches.length };
}

/** ProseMirror textBetween 插入的块分隔符会占一个偏移；遍历 text nodes 直接取 doc position。 */
function blockMatches(view: ProseMirrorView, query: string): TextMatch[] {
  const matches: TextMatch[] = [];
  view.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const match of textMatches(node.text, query)) {
      matches.push({ from: pos + match.from, to: pos + match.to });
    }
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
