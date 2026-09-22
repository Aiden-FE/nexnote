/**
 * docx 语义级往返的公共块模型与 HTML 子集解析（DEV-074，ADR-0015 Decision 4）。
 *
 * 块模型是 TipTap（渲染层 WebContentsView host）与 dolanmiu/docx（主进程重建 .docx）
 * 之间的稳定契约：两边都以 DocxBlock[] 为权威，HTML 只是 TipTap 的序列化形态。
 *
 * 明确保留：段落、标题（h1–h6）、加粗/斜体、表格、字体色、对齐。
 * 明确不保留：页眉页脚、编号列表样式、上下标（读取时计数，经 user guide 告知）。
 */

export type DocxAlignment = 'left' | 'center' | 'right' | 'both';

export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** 十六进制颜色（不带 `#`），如 `FF0000`。 */
  color?: string;
}

export type DocxBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; runs: DocxRun[]; alignment?: DocxAlignment }
  | { type: 'paragraph'; runs: DocxRun[]; alignment?: DocxAlignment }
  | { type: 'table'; rows: DocxRun[][][] };

// ── 轻量 HTML tokenizer（无 DOM 依赖；host 与 main 共用同一实现）─────────
interface Token {
  kind: 'open' | 'close' | 'text';
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

const VOID_TAGS = new Set(['br', 'hr', 'img']);

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)\/?>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const tagMatch = match;
    if (tagMatch.index > last) {
      const text = decodeEntities(html.slice(last, tagMatch.index));
      if (text) tokens.push({ kind: 'text', tag: '', attrs: {}, text });
    }
    last = tagRe.lastIndex;
    const isClose = tagMatch[0].startsWith('</');
    const tag = tagMatch[1]?.toLowerCase();
    if (!tag) continue;
    if (isClose) {
      tokens.push({ kind: 'close', tag, attrs: {}, text: '' });
    } else {
      tokens.push({ kind: 'open', tag, attrs: parseAttrs(tagMatch[2] ?? ''), text: '' });
      if (VOID_TAGS.has(tag)) tokens.push({ kind: 'close', tag, attrs: {}, text: '' });
    }
  }
  if (last < html.length) {
    const text = decodeEntities(html.slice(last));
    if (text) tokens.push({ kind: 'text', tag: '', attrs: {}, text });
  }
  return tokens;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const value = m[3] ?? m[4];
    if (m[1] !== undefined && value !== undefined) attrs[m[1].toLowerCase()] = value;
  }
  return attrs;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** 收集某标签 open 之后的 token，直到匹配的 close（含嵌套同名标签）。 */
function collectUntilClose(
  tokens: Token[],
  startIndex: number,
  tag: string,
): { tokens: Token[]; next: number } {
  const inner: Token[] = [];
  let depth = 0;
  let i = startIndex;
  for (; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t) continue;
    if (t.kind === 'open' && t.tag === tag) {
      depth += 1;
      if (depth === 1) continue;
    }
    if (t.kind === 'close' && t.tag === tag) {
      depth -= 1;
      if (depth === 0) {
        return { tokens: inner, next: i + 1 };
      }
    }
    if (depth >= 1) inner.push(t);
  }
  return { tokens: inner, next: tokens.length };
}

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

function collectRuns(tokens: Token[], style: RunStyle): DocxRun[] {
  const runs: DocxRun[] = [];
  const stack: RunStyle[] = [{ ...style }];
  const pushText = (text: string): void => {
    const current = stack[stack.length - 1]!;
    const decoded = decodeEntities(text);
    if (!decoded) return;
    const last = runs[runs.length - 1];
    if (
      last &&
      last.bold === current.bold &&
      last.italic === current.italic &&
      last.color === current.color
    ) {
      last.text += decoded;
    } else {
      runs.push({
        text: decoded,
        bold: current.bold,
        italic: current.italic,
        color: current.color,
      });
    }
  };
  for (const token of tokens) {
    if (token.kind === 'text') {
      pushText(token.text);
      continue;
    }
    if (token.kind === 'open') {
      const next: RunStyle = { ...stack[stack.length - 1] };
      if (token.tag === 'strong' || token.tag === 'b') next.bold = true;
      if (token.tag === 'em' || token.tag === 'i') next.italic = true;
      if (token.tag === 'span' || token.tag === 'font') {
        const color = colorFromStyle(token.attrs.style) ?? normalizeColor(token.attrs.color);
        if (color) next.color = color;
      }
      if (token.tag === 'br') {
        runs.push({ text: '\n' });
        continue;
      }
      stack.push(next);
      continue;
    }
    if (token.kind === 'close' && stack.length > 1) {
      stack.pop();
    }
  }
  return runs.filter((run) => run.text.length > 0);
}

function colorFromStyle(style: string | undefined): string | null {
  if (!style) return null;
  const match = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
  const captured = match?.[1];
  return captured ? normalizeColor(captured.trim()) : null;
}

function normalizeColor(value: string | undefined): string | null {
  if (!value) return null;
  const hex = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return hex?.[1] ? hex[1].toUpperCase() : null;
}

function collectTableRows(tokens: Token[]): DocxRun[][][] {
  const rows: DocxRun[][][] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token && token.kind === 'open' && token.tag === 'tr') {
      const rowInner = collectUntilClose(tokens, i, 'tr');
      const cells: DocxRun[][] = [];
      let j = 0;
      while (j < rowInner.tokens.length) {
        const cell = rowInner.tokens[j];
        if (cell && cell.kind === 'open' && (cell.tag === 'td' || cell.tag === 'th')) {
          const cellInner = collectUntilClose(rowInner.tokens, j, cell.tag);
          cells.push(collectRuns(cellInner.tokens, {}));
          j = cellInner.next;
          continue;
        }
        j += 1;
      }
      rows.push(cells);
      i = rowInner.next;
      continue;
    }
    i += 1;
  }
  return rows;
}

function alignmentFromStyle(style: string | undefined): DocxAlignment | undefined {
  if (!style) return undefined;
  const match = /text-align\s*:\s*(left|center|right|justify|both)/i.exec(style);
  const captured = match?.[1];
  const value = captured?.toLowerCase();
  if (!value) return undefined;
  if (value === 'justify') return 'both';
  return value as DocxAlignment;
}

/**
 * 把 HTML（TipTap / mammoth 输出子集）解析为语义块。
 * 支持：p、h1–h6、strong/b、em/i、span[style=color]、table/tr/td、段落对齐。
 */
export function htmlToBlocks(html: string): DocxBlock[] {
  const tokens = tokenize(html);
  const blocks: DocxBlock[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) {
      i += 1;
      continue;
    }
    if (token.kind === 'open' && /^h([1-6])$/.test(token.tag)) {
      const level = Number(/^h([1-6])$/.exec(token.tag)?.[1] ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
      const inner = collectUntilClose(tokens, i, token.tag);
      const runs = collectRuns(inner.tokens, {});
      blocks.push({
        type: 'heading',
        level,
        runs,
        alignment: alignmentFromStyle(token.attrs.style),
      });
      i = inner.next;
      continue;
    }
    if (token.kind === 'open' && token.tag === 'p') {
      const inner = collectUntilClose(tokens, i, 'p');
      const runs = collectRuns(inner.tokens, {});
      if (runs.length > 0) {
        blocks.push({ type: 'paragraph', runs, alignment: alignmentFromStyle(token.attrs.style) });
      }
      i = inner.next;
      continue;
    }
    if (token.kind === 'open' && token.tag === 'table') {
      const inner = collectUntilClose(tokens, i, 'table');
      const rows = collectTableRows(inner.tokens);
      if (rows.length > 0) blocks.push({ type: 'table', rows });
      i = inner.next;
      continue;
    }
    i += 1;
  }
  return blocks;
}
