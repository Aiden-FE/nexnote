import type { EditorKernelInstance } from '@nexnote/kernel';
import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { PARAGRAPH_ID, type HeadingLevel } from './entries';

export const COMPLEX_HEADING_SELECTION_REASON = '跨复杂结构的多块选区不能转换标题';
export const UNSAFE_MARKDOWN_HEADING_CONTEXT_REASON =
  '代码围栏、表格或其他复杂 Markdown 结构不能转换标题';

export function headingLevelFromAction(id: string): HeadingLevel | null {
  if (id === PARAGRAPH_ID) return null;
  const match = /^block:heading:([1-6])$/.exec(id);
  return match ? (Number(match[1]) as HeadingLevel) : null;
}

/** TipTap 标题工具只接受单个顶层 textblock；复杂结构 fail closed，不产生事务。 */
export function blockHeadingCapability(kernel: EditorKernelInstance | null): {
  enabled: boolean;
  reason?: string;
} {
  if (!kernel) return { enabled: false, reason: '编辑器尚未就绪' };
  const { selection } = kernel.editor.state;
  const node =
    selection.$from.depth >= 1 && selection.$to.depth >= 1 ? selection.$from.node(1) : null;
  const sameBlock =
    selection.$from.depth >= 1 &&
    selection.$to.depth >= 1 &&
    selection.$from.before(1) === selection.$to.before(1);
  if (!sameBlock || !node?.isTextblock || node.type.name === 'codeBlock') {
    return { enabled: false, reason: COMPLEX_HEADING_SELECTION_REASON };
  }
  return { enabled: true };
}

export function applyBlockTypeAction(kernel: EditorKernelInstance, id: string): boolean {
  const capability = blockHeadingCapability(kernel);
  if (!capability.enabled) return false;
  const level = headingLevelFromAction(id);
  if (id !== PARAGRAPH_ID && level === null) return false;
  const { selection } = kernel.editor.state;
  return kernel.convertBlock(
    level === null ? 'paragraph' : `h${level}`,
    selection.from,
    selection.to,
  );
}

/** 位置处于代码围栏/表格语法节点内（含祖先链）。 */
function insideComplexMarkdown(state: Parameters<typeof syntaxTree>[0], pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  for (;;) {
    if (/Code|Table/.test(node.name)) return true;
    const parent = node.parent;
    if (!parent) break;
    node = parent;
  }
  // 解析器尚未装配或处于增量未完成态时，用原文围栏扫描作保守兜底。
  let fence: { marker: string; length: number } | null = null;
  for (let number = 1; number <= state.doc.lineAt(pos).number; number += 1) {
    const line = state.doc.line(number).text;
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    if (!fence) fence = { marker: match[1]![0]!, length: match[1]!.length };
    else if (match[1]![0] === fence.marker && match[1]!.length >= fence.length) fence = null;
  }
  return fence !== null;
}

/** Markdown 标题工具只改当前物理行的 ATX 前缀，保留正文、行尾与未触及字节。 */
export function sourceHeadingCapability(view: EditorView | null): {
  enabled: boolean;
  reason?: string;
} {
  if (!view) return { enabled: false, reason: '编辑器尚未就绪' };
  const selection = view.state.selection.main;
  if (view.state.doc.lineAt(selection.from).number !== view.state.doc.lineAt(selection.to).number) {
    return { enabled: false, reason: COMPLEX_HEADING_SELECTION_REASON };
  }
  if (insideComplexMarkdown(view.state, selection.from)) {
    return { enabled: false, reason: UNSAFE_MARKDOWN_HEADING_CONTEXT_REASON };
  }
  const line = view.state.doc.lineAt(selection.from);
  // Lezer 在不完整表格/围栏输入期间可能尚未形成完整节点，文本防线仍 fail closed。
  if (
    /^ {0,3}(`{3,}|~{3,})/.test(line.text) ||
    /^ {0,3}\|.*\|\s*$/.test(line.text) ||
    /^ {0,3}(?:\|?\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.text)
  ) {
    return { enabled: false, reason: UNSAFE_MARKDOWN_HEADING_CONTEXT_REASON };
  }
  return { enabled: true };
}

export function applySourceBlockTypeAction(view: EditorView, id: string): boolean {
  const capability = sourceHeadingCapability(view);
  if (!capability.enabled || view.state.readOnly) return false;
  const level = headingLevelFromAction(id);
  if (id !== PARAGRAPH_ID && level === null) return false;
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const prefix = /^ {0,3}#{1,6}[ \t]+/.exec(line.text)?.[0] ?? '';
  const nextPrefix = level === null ? '' : `${'#'.repeat(level)} `;
  if (prefix === nextPrefix) return false;
  const changes = view.state.changes({
    from: line.from,
    to: line.from + prefix.length,
    insert: nextPrefix,
  });
  if (changes.empty) return false;
  view.dispatch({
    changes,
    selection: view.state.selection.map(changes, 1),
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
  });
  return true;
}
