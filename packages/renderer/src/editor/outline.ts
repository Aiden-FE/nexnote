/**
 * 共享标题目录（Table of Contents）纯模型（DEV-047）。
 *
 * 同一套 OutlineEntry 服务两种文档形态，供源码模式与块模式的目录 UI 复用：
 * - Markdown 源码：parseMarkdownOutline（ATX/Setext，含块引用内标题，排除 frontmatter
 *   与 fenced code 伪标题）
 * - 块编辑器文档：parseBlockOutline（TipTap JSON 或 ProseMirror doc，无 DOM 依赖）
 *
 * 纯函数约定：不修改正文、不写入/注入锚点；id 仅为运行时标识（React key、滚动定位），
 * 由文本 slug 加序号去重生成，确定可复现，绝不落盘。
 */

export interface OutlineEntry {
  /** 运行时稳定 id：slug 去重生成，不写入正文。 */
  id: string;
  /** 标题级别，1-6。允许跳级，目录渲染自行决定缩进策略。 */
  level: number;
  /** 标题可见文本（Markdown 模式会剥离常见行内语法）；空标题为 ''。 */
  text: string;
  /** 文档内出现顺序，0 起。 */
  ordinal: number;
  /** Markdown 定位：1-based 行号。 */
  line?: number;
  /** Markdown 定位：标题文本首行起始偏移（Setext 指向文本行而非下划线行）。 */
  from?: number;
  /** Markdown 定位：标题文本末行结束偏移（不含行尾 \r\n）。 */
  to?: number;
  /** 块文档定位：heading 节点相对 doc 起点的 ProseMirror 位置。 */
  pos?: number;
}

/** 已占用 id 注册表：键存在即占用（值仅作参考计数）。 */
export type UsedOutlineIds = Map<string, number>;

/** 目录 id 的可读 slug：小写、去标点、保留字母数字与中日韩统一表意文字。 */
export function slugifyOutlineText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 依据标题文本生成集合内唯一的目录 id。
 *
 * 规则：首次用 slug 本身，之后追加 -2、-3…；与字面量撞名（如文本恰为 "A-2"）时继续避让，
 * 保证同一注册表内 id 严格唯一且确定。注册表由调用方持有，解析函数内部自建。
 */
export function createOutlineId(text: string, used: UsedOutlineIds): string {
  const base = slugifyOutlineText(text) || 'heading';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.set(candidate, 1);
  return candidate;
}

interface MarkdownLine {
  /** 行内容，不含行尾 \r\n。 */
  text: string;
  /** 行首在整个文档中的偏移。 */
  start: number;
  /** 行内容结束偏移（不含 \r\n），即 start + text.length。 */
  end: number;
  /** 1-based 行号。 */
  number: number;
}

const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const ATX_CLOSING_RE = /(?:^|[ \t]+)#+[ \t]*$/;
/** 行尾块锚点 token（NexNote/Obsidian 方言），须由空格分隔，不误伤 a^b。 */
const BLOCK_ANCHOR_RE = /(?:^|[ \t]+)\^[A-Za-z0-9-]+[ \t]*$/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const BLANK_RE = /^[ \t]*$/;
const LINK_REFERENCE_DEFINITION_RE = /^ {0,3}\[((?:\\.|[^\\\]])+)\]:[ \t]*\S/;
/** 行首块引用前缀（可嵌套、可缩进，> 后至多一个空格），与 source-formatting 的围栏保护口径一致。 */
const BLOCKQUOTE_PREFIX_RE = /^(?:[ \t]*>[ \t]?)+/;

/**
 * 剥离行首块引用前缀：引用内标题（`> # x`）与围栏按剥后的内容识别，
 * 与 kernel 的 blockquote heading 行为对齐；定位偏移仍由调用方指向原始行。
 */
function stripBlockquotePrefix(text: string): string {
  return text.replace(BLOCKQUOTE_PREFIX_RE, '');
}

function splitMarkdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let pos = 0;
  while (pos <= markdown.length) {
    const nl = markdown.indexOf('\n', pos);
    const raw = nl === -1 ? markdown.slice(pos) : markdown.slice(pos, nl);
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ text, start: pos, end: pos + text.length, number: lines.length + 1 });
    if (nl === -1) break;
    pos = nl + 1;
  }
  return lines;
}

function normalizeHeadingText(raw: string, atx: boolean): string {
  // 收尾 # 序列仅对 ATX 内容有意义；Setext 文本中的 # 是字面字符。
  let text = atx ? raw.replace(ATX_CLOSING_RE, '') : raw;
  text = text.replace(BLOCK_ANCHOR_RE, '');
  return text.trim();
}

const MARKDOWN_ESCAPABLE_RE = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;
const HTML_ENTITY_RE = /^&(?:#(\d+)|#x([\da-f]+)|([a-z][\da-z]+));/i;
/**
 * 仅剥离不会引入可执行内容的 phrasing tags。未知标签以及 script/style 等保持源码字面，
 * 避免把目录提取器变成宽松的 HTML sanitizer（本函数始终只处理字符串，不创建 DOM）。
 */
const SAFE_INLINE_HTML_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
]);
const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  copy: '©',
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lsquo: '‘',
  mdash: '—',
  middot: '·',
  nbsp: '\u00a0',
  ndash: '–',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  reg: '®',
  rsquo: '’',
  trade: '™',
  lt: '<',
};

function decodeHtmlEntity(source: string): { text: string; length: number } | null {
  const match = HTML_ENTITY_RE.exec(source);
  if (!match) return null;

  const raw = match[0];
  if (match[1] || match[2]) {
    const codePoint = Number.parseInt(match[1] ?? match[2] ?? '', match[1] ? 10 : 16);
    if (codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return null;
    }
    return { text: String.fromCodePoint(codePoint), length: raw.length };
  }

  const decoded = HTML_NAMED_ENTITIES[(match[3] ?? '').toLowerCase()];
  return decoded === undefined ? null : { text: decoded, length: raw.length };
}

function findUnescaped(source: string, token: string, from: number): number {
  for (let index = from; index <= source.length - token.length; index += 1) {
    if (source.startsWith(token, index)) {
      let slashes = 0;
      for (let before = index - 1; before >= 0 && source[before] === '\\'; before -= 1)
        slashes += 1;
      if (slashes % 2 === 0) return index;
    }
  }
  return -1;
}

function findClosingBracket(source: string, from: number): number {
  let depth = 1;
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === '[') depth += 1;
    if (source[index] === ']') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function inlineHtmlTagEnd(source: string, start: number): number {
  if (source[start] !== '<') return -1;
  const match = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?\s*\/?>/.exec(source.slice(start));
  if (!match || !SAFE_INLINE_HTML_TAGS.has((match[1] ?? '').toLowerCase())) return -1;
  return start + match[0].length;
}

function normalizeReferenceLabel(label: string): string {
  return label
    .trim()
    .replace(/[ \t\r\n]+/g, ' ')
    .toLowerCase();
}

function findClosingParenthesis(source: string, from: number): number {
  let depth = 1;
  let quote = '';
  for (let index = from; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function inlineCodeText(source: string, start: number): { text: string; end: number } | null {
  let markerLength = 1;
  while (source[start + markerLength] === '`') markerLength += 1;
  const marker = '`'.repeat(markerLength);
  const close = source.indexOf(marker, start + markerLength);
  if (close < 0) return null;

  let text = source.slice(start + markerLength, close).replace(/[\r\n]+/g, ' ');
  if (/^ .* $/.test(text) && !/^ +$/.test(text)) text = text.slice(1, -1);
  return { text, end: close + markerLength };
}

/** 收集文档中 link reference definition 的归一化 label，忽略 fenced code 内的伪定义。 */
function collectReferenceLabels(markdown: string): Set<string> {
  const labels = new Set<string>();
  let fence: { close: RegExp } | null = null;
  for (const line of splitMarkdownLines(markdown)) {
    if (fence) {
      if (fence.close.test(line.text)) fence = null;
      continue;
    }

    const open = OPEN_FENCE_RE.exec(line.text);
    if (open) {
      const marker = open[1] ?? '```';
      fence = { close: new RegExp(`^ {0,3}\\${marker.charAt(0)}{${marker.length},}[ \t]*$`) };
      continue;
    }

    const match = LINK_REFERENCE_DEFINITION_RE.exec(line.text);
    if (match && match[1] !== undefined) labels.add(normalizeReferenceLabel(match[1]));
  }
  return labels;
}

/**
 * 提取 Markdown 标题渲染后的可见文本。仅识别目录需要的常见行内语法，不借助 DOM，
 * 因而既不会执行 HTML，也不会改动用于定位的源码。references 用于判定引用式链接/图片。
 */
function markdownHeadingVisibleText(source: string, references: ReadonlySet<string>): string {
  let text = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? '';

    if (char === '\\' && MARKDOWN_ESCAPABLE_RE.test(source[index + 1] ?? '')) {
      text += source[index + 1];
      index += 2;
      continue;
    }

    if (char === '`') {
      const code = inlineCodeText(source, index);
      if (code) {
        text += code.text;
        index = code.end;
        continue;
      }
    }

    const wikiStart = source.startsWith('[[', index)
      ? index
      : source.startsWith('![[', index)
        ? index + 1
        : -1;
    if (wikiStart >= 0) {
      const close = findUnescaped(source, ']]', wikiStart + 2);
      if (close >= 0) {
        const value = source.slice(wikiStart + 2, close);
        const alias = findUnescaped(value, '|', 0);
        text += markdownHeadingVisibleText(alias >= 0 ? value.slice(alias + 1) : value, references);
        index = close + 2;
        continue;
      }
    }

    const image = char === '!' && source[index + 1] === '[';
    const link = char === '[' || image;
    if (link) {
      const labelStart = index + (image ? 2 : 1);
      const labelEnd = findClosingBracket(source, labelStart);
      if (labelEnd >= 0) {
        const label = source.slice(labelStart, labelEnd);
        if (source[labelEnd + 1] === '(') {
          const destinationEnd = findClosingParenthesis(source, labelEnd + 2);
          if (destinationEnd >= 0) {
            text += markdownHeadingVisibleText(label, references);
            index = destinationEnd + 1;
            continue;
          }
        }

        let referenceEnd = labelEnd + 1;
        let referenceLabel = label;
        if (source[labelEnd + 1] === '[') {
          const explicitEnd = findClosingBracket(source, labelEnd + 2);
          if (explicitEnd >= 0) {
            referenceLabel = source.slice(labelEnd + 2, explicitEnd) || label;
            referenceEnd = explicitEnd + 1;
          }
        }
        if (references.has(normalizeReferenceLabel(referenceLabel))) {
          text += markdownHeadingVisibleText(label, references);
          index = referenceEnd;
          continue;
        }
      }
    }

    if (char === '<') {
      const tagEnd = inlineHtmlTagEnd(source, index);
      if (tagEnd >= 0) {
        index = tagEnd;
        continue;
      }
    }

    const marker = source.startsWith('~~', index)
      ? '~~'
      : source.startsWith('**', index)
        ? '**'
        : source.startsWith('__', index)
          ? '__'
          : char === '*' || char === '_'
            ? char
            : '';
    if (marker) {
      const close = findUnescaped(source, marker, index + marker.length);
      const inner = close < 0 ? '' : source.slice(index + marker.length, close);
      if (close >= 0 && inner.length > 0 && !/^\s|\s$/.test(inner)) {
        text += markdownHeadingVisibleText(inner, references);
        index = close + marker.length;
        continue;
      }
    }

    if (char === '&') {
      const entity = decodeHtmlEntity(source.slice(index));
      if (entity) {
        text += entity.text;
        index += entity.length;
        continue;
      }
    }

    text += char;
    index += 1;
  }

  return text;
}

/** 从 Markdown 源码解析标题目录。纯函数：markdown 不被修改。 */
export function parseMarkdownOutline(markdown: string): OutlineEntry[] {
  const lines = splitMarkdownLines(markdown);
  const entries: OutlineEntry[] = [];
  const used = new Map<string, number>();
  const references = collectReferenceLabels(markdown);
  const push = (
    level: number,
    rawText: string,
    atx: boolean,
    line: MarkdownLine | { start: number; end: number; number: number },
  ): void => {
    const text = markdownHeadingVisibleText(normalizeHeadingText(rawText, atx), references);
    entries.push({
      id: createOutlineId(text, used),
      level,
      text,
      ordinal: entries.length,
      line: line.number,
      from: line.start,
      to: line.end,
    });
  };

  // frontmatter：仅识别文档起始且成功闭合的 --- 块；未闭合时按 title-sync 的防御约定视为正文。
  let first = 0;
  if (lines[0]?.text.trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && line.text.trim() === '---');
    if (close > 0) first = close + 1;
  }

  let fence: { close: RegExp } | null = null;
  let pending: { texts: string[]; start: number; end: number; number: number } | null = null;

  for (const line of lines.slice(first)) {
    // 块引用内标题/围栏：识别基于剥掉引用前缀的内容，from/to 仍指向原始行。
    const content = stripBlockquotePrefix(line.text);

    if (fence) {
      if (fence.close.test(content)) fence = null;
      continue;
    }

    if (BLANK_RE.test(content)) {
      pending = null;
      continue;
    }

    const atx = ATX_HEADING_RE.exec(content);
    if (atx) {
      push((atx[1] ?? '').length, atx[2] ?? '', true, line);
      pending = null;
      continue;
    }

    const open = OPEN_FENCE_RE.exec(content);
    if (open) {
      const marker = open[1] ?? '```';
      fence = {
        close: new RegExp(`^ {0,3}\\${marker.charAt(0)}{${marker.length},}[ \\t]*$`),
      };
      pending = null;
      continue;
    }

    const underline = SETEXT_UNDERLINE_RE.exec(content);
    if (underline) {
      // 有待定段落则是 Setext 标题；否则 --- 是主题分隔线，只终结段落。
      const paragraph = pending;
      if (paragraph) {
        push(
          (underline[1] ?? '').startsWith('=') ? 1 : 2,
          paragraph.texts.join('\n'),
          false,
          paragraph,
        );
      }
      pending = null;
      continue;
    }

    if (THEMATIC_BREAK_RE.test(content)) {
      pending = null;
      continue;
    }

    const paragraph: { texts: string[]; start: number; end: number; number: number } = pending ?? {
      texts: [],
      start: line.start,
      end: line.end,
      number: line.number,
    };
    paragraph.texts.push(content);
    paragraph.end = line.end;
    pending = paragraph;
  }

  return entries;
}

/** TipTap JSON 节点的最小结构契约（不引入 DOM 或 Editor 实例）。 */
export interface OutlineJsonNode {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: OutlineJsonNode[] | null;
  text?: string;
  marks?: unknown[];
}

/** ProseMirror 节点的最小结构契约；真实 PM Node 结构兼容。 */
export interface OutlinePmNode {
  type: { name: string };
  attrs?: Record<string, unknown> | null;
  textContent?: string;
}

/** ProseMirror document 的最小结构契约；真实 EditorState doc 结构兼容。 */
export interface OutlinePmDocument {
  descendants(visitor: (node: OutlinePmNode, pos: number) => boolean | void): void;
}

export type OutlineBlockSource = OutlinePmDocument | OutlineJsonNode;

function headingLevel(attrs?: Record<string, unknown> | null): number | null {
  const level = attrs?.level;
  return typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 6
    ? level
    : null;
}

function jsonNodeText(node: OutlineJsonNode): string {
  if (typeof node.text === 'string') return node.text;
  let text = '';
  for (const child of node.content ?? []) text += jsonNodeText(child);
  return text;
}

function jsonNodeSize(node: OutlineJsonNode): number {
  if (typeof node.text === 'string') return node.text.length;
  let size = 2;
  for (const child of node.content ?? []) size += jsonNodeSize(child);
  return size;
}

/**
 * 从块编辑器文档解析标题目录。接受 TipTap JSON（getJSON() 结果）或 ProseMirror doc
 * （含 EditorState.doc）；仅做结构遍历，不依赖 DOM。
 */
export function parseBlockOutline(source: OutlineBlockSource): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const used = new Map<string, number>();
  const push = (level: number, text: string, pos: number): void => {
    entries.push({ id: createOutlineId(text, used), level, text, ordinal: entries.length, pos });
  };

  if (source && typeof (source as OutlinePmDocument).descendants === 'function') {
    (source as OutlinePmDocument).descendants((node, pos) => {
      if (node.type?.name !== 'heading') return;
      const level = headingLevel(node.attrs);
      if (level === null) return;
      push(level, normalizeHeadingText(node.textContent ?? '', false), pos);
    });
    return entries;
  }

  const visit = (node: OutlineJsonNode, nodePos: number): void => {
    if (node.type === 'heading') {
      const level = headingLevel(node.attrs);
      if (level !== null) push(level, normalizeHeadingText(jsonNodeText(node), false), nodePos);
    }
    let childPos = nodePos + 1;
    for (const child of node.content ?? []) {
      visit(child, childPos);
      childPos += jsonNodeSize(child);
    }
  };

  // doc 根不占 open token：顶层子节点从位置 0 开始（ProseMirror 语义）。
  const doc = source as OutlineJsonNode;
  let topPos = 0;
  for (const child of doc?.content ?? []) {
    visit(child, topPos);
    topPos += jsonNodeSize(child);
  }
  return entries;
}
