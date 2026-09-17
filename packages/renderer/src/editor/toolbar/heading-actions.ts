import type { EditorKernelInstance } from '@nexnote/kernel';
import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { PARAGRAPH_ID } from './entries';

export const COMPLEX_HEADING_SELECTION_REASON = '跨复杂结构的多块选区不能转换标题';

export function headingLevelFromAction(id: string): 1 | 2 | 3 | 4 | 5 | 6 | null {
  if (id === PARAGRAPH_ID) return null;
  const match = /^block:heading:([1-6])$/.exec(id);
  return match ? (Number(match[1]) as 1 | 2 | 3 | 4 | 5 | 6) : null;
}

/** TipTap 标题工具只接受单个顶层 textblock；复杂结构 fail closed，不产生事务。 */
export function blockHeadingCapability(kernel: EditorKernelInstance | null): {
  enabled: boolean;
  reason?: string;
} {
  if (!kernel) return { enabled: false, reason: '编辑器尚未就绪' };
  const { selection } = kernel.editor.state;
  const node = selection.$from.depth >= 1 && selection.$to.depth >= 1 ? selection.$from.node(1) : null;
  const sameBlock = selection.$from.depth >= 1 && selection.$to.depth >= 1 && selection.$from.before(1) === selection.$to.before(1);
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
  return kernel.convertBlock(level === null ? 'paragraph' : `h${level}`, selection.from, selection.to);
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
  const changes = view.state.changes({ from: line.from, to: line.from + prefix.length, insert: nextPrefix });
  if (changes.empty) return false;
  view.dispatch({
    changes,
    selection: view.state.selection.map(changes, 1),
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
  });
  return true;
}
