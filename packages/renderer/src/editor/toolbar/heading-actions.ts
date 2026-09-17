import type { EditorKernelInstance } from '@nexnote/kernel';
import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { PARAGRAPH_ID, type HeadingLevel } from './entries';

export const COMPLEX_HEADING_SELECTION_REASON = '跨复杂结构的多块选区不能转换标题';
export const UNSAFE_MARKDOWN_HEADING_CONTEXT_REASON =
  '代码围栏、表格或其他复杂 Markdown 结构不能转换标题';
export const LIST_OR_QUOTE_HEADING_CONTEXT_REASON =
  '列表或引用行不能转换标题，请先解除列表或引用结构';
export const READ_ONLY_HEADING_CONTEXT_REASON = '只读视图不能转换标题';

/** Setext 下划线（`===` H1 / `---` H2）；与水平线、表格分隔行的歧义由配对规则消解。 */
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)\s*$/;
const BULLET_LINE = /^ {0,3}[-+*](?:$|\s)/;
const ORDERED_LINE = /^ {0,3}\d{1,9}[.)](?:$|\s)/;
const QUOTE_LINE = /^ {0,3}>/;
const TABLE_LINE = /^ {0,3}\|.*\|\s*$/;
const TABLE_SEPARATOR_LINE = /^ {0,3}(?:\|?\s*:?-{3,}:?\s*)+\|?\s*$/;
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/;
const HTML_BLOCK_LINE = /^ {0,3}<\/?[a-zA-Z]/;
const INDENTED_CODE_LINE = /^ {4,}\S/;

type SourceLine = ReturnType<EditorView['state']['doc']['line']>;
type MarkdownNode = ReturnType<typeof syntaxTree>['topNode'];

interface SourceSetextPair {
  text: SourceLine;
  underline: SourceLine;
  /** 多行 Setext 段落不能仅替换一行及下划线，必须 fail closed。 */
  singleLine: boolean;
}

/** 返回位置所属的顶层 Markdown 块。 */
function topMarkdownBlockAt(state: Parameters<typeof syntaxTree>[0], pos: number): MarkdownNode {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node.parent && node.parent.name !== 'Document') node = node.parent;
  return node;
}

/**
 * 只把解析器确认的 SetextHeading1/2 作为合法配对。由此 `---` 水平线不会误判，
 * 合法 inline Markdown/HTML 标题文字也不会被启发式正则误拒绝。
 */
function setextPairAt(state: EditorView['state'], pos: number): SourceSetextPair | null {
  const block = topMarkdownBlockAt(state, pos);
  if (!/^SetextHeading[12]$/.test(block.name) || block.to <= block.from) return null;
  const text = state.doc.lineAt(block.from);
  const underline = state.doc.lineAt(block.to - 1);
  if (!SETEXT_UNDERLINE.test(underline.text) || text.number >= underline.number) return null;
  return { text, underline, singleLine: underline.number === text.number + 1 };
}

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

type MarkdownBlockContext = 'list-or-quote' | 'unsafe' | null;

/**
 * 从 Lezer 顶层块判断转换边界：只允许普通段落、ATX/Setext 标题和空文档；
 * 列表/引用提供专用反馈，其他块结构一律 fail closed。
 */
function parsedMarkdownBlockContext(
  state: Parameters<typeof syntaxTree>[0],
  pos: number,
): MarkdownBlockContext {
  const node = topMarkdownBlockAt(state, pos);
  if (/^(?:BulletList|OrderedList|Blockquote)$/.test(node.name)) return 'list-or-quote';
  if (/^(?:Document|Paragraph|ATXHeading[1-6]|SetextHeading[12])$/.test(node.name)) return null;
  return 'unsafe';
}

/** 解析器未装配或增量解析未覆盖时，对围栏内部作保守兜底。 */
function insideMarkdownFence(state: Parameters<typeof syntaxTree>[0], pos: number): boolean {
  let fence: { marker: string; length: number } | null = null;
  for (let number = 1; number <= state.doc.lineAt(pos).number; number += 1) {
    const line = state.doc.line(number).text;
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!opening) continue;
    if (!fence) {
      fence = { marker: opening[1]![0]!, length: opening[1]!.length };
      continue;
    }
    const closing = new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`);
    if (closing.test(line)) fence = null;
  }
  return fence !== null;
}

/** Markdown 标题工具只改当前物理行的 ATX 前缀，保留正文、行尾与未触及字节。 */
export function sourceHeadingCapability(view: EditorView | null): {
  enabled: boolean;
  reason?: string;
} {
  if (!view) return { enabled: false, reason: '编辑器尚未就绪' };
  if (view.state.readOnly) return { enabled: false, reason: READ_ONLY_HEADING_CONTEXT_REASON };
  const selection = view.state.selection.main;
  if (view.state.doc.lineAt(selection.from).number !== view.state.doc.lineAt(selection.to).number) {
    return { enabled: false, reason: COMPLEX_HEADING_SELECTION_REASON };
  }
  const parsedContext = parsedMarkdownBlockContext(view.state, selection.from);
  if (parsedContext === 'list-or-quote') {
    return { enabled: false, reason: LIST_OR_QUOTE_HEADING_CONTEXT_REASON };
  }
  if (parsedContext === 'unsafe' || insideMarkdownFence(view.state, selection.from)) {
    return { enabled: false, reason: UNSAFE_MARKDOWN_HEADING_CONTEXT_REASON };
  }
  const line = view.state.doc.lineAt(selection.from);
  // Setext 对先于不安全行判断：合法单行配对中的 `---`/`===` 下划线是标题的一部分。
  const setextPair = setextPairAt(view.state, selection.from);
  if (setextPair) {
    return setextPair.singleLine
      ? { enabled: true }
      : { enabled: false, reason: COMPLEX_HEADING_SELECTION_REASON };
  }
  // Lezer 在不完整表格/围栏输入期间可能尚未形成完整节点，文本防线仍 fail closed。
  if (
    FENCE_LINE.test(line.text) ||
    TABLE_LINE.test(line.text) ||
    TABLE_SEPARATOR_LINE.test(line.text) ||
    HTML_BLOCK_LINE.test(line.text) ||
    INDENTED_CODE_LINE.test(line.text) ||
    SETEXT_UNDERLINE.test(line.text)
  ) {
    return { enabled: false, reason: UNSAFE_MARKDOWN_HEADING_CONTEXT_REASON };
  }
  if (BULLET_LINE.test(line.text) || ORDERED_LINE.test(line.text) || QUOTE_LINE.test(line.text)) {
    return { enabled: false, reason: LIST_OR_QUOTE_HEADING_CONTEXT_REASON };
  }
  return { enabled: true };
}

export function applySourceBlockTypeAction(view: EditorView, id: string): boolean {
  const capability = sourceHeadingCapability(view);
  if (!capability.enabled) return false;
  const level = headingLevelFromAction(id);
  if (id !== PARAGRAPH_ID && level === null) return false;
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const pair = setextPairAt(view.state, selection.from);
  if (pair) {
    // Setext → 正文：仅删除下划线行（含其前换行）；Setext → H1-H6：文本行加 ATX
    // 前缀并删除下划线行。两个局部编辑合入单个事务，一次 undo/redo。
    const specs =
      level === null
        ? [{ from: pair.text.to, to: pair.underline.to, insert: '' }]
        : [
            { from: pair.text.from, insert: `${'#'.repeat(level)} ` },
            { from: pair.text.to, to: pair.underline.to, insert: '' },
          ];
    const setextChanges = view.state.changes(specs);
    if (setextChanges.empty) return false;
    view.dispatch({
      changes: setextChanges,
      selection: view.state.selection.map(setextChanges, 1),
      annotations: isolateHistory.of('full'),
      scrollIntoView: true,
    });
    return true;
  }
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
