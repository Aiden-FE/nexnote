/**
 * 共享 Markdown 链接解析器（DEV-004）：
 * - code-aware：跳过 fenced code（``` / ~~~）与 inline code（含多反引号 `` ``）
 * - 同时抽取 wikilink `[[Target|alias#anchor]]` 与普通链接 `[label](<dest> "title")`
 * - 普通链接支持 optional title、`<angle>` destination、balanced parentheses
 * - 所有偏移为 UTF-16 code-unit，与 String.slice/indexOf 一致；blockIndex 与块切分一致
 *
 * 纯字符串实现，不依赖 node API，可在 renderer / kernel / main 共用。
 */

export interface WikiLink {
  kind: 'wiki';
  raw: string;
  offset: number;
  length: number;
  blockIndex: number;
  isEmbed: boolean;
  target: string;
  targetName: string;
  alias: string | null;
  anchor: string | null;
}

export interface NormalLink {
  kind: 'normal';
  raw: string;
  offset: number;
  length: number;
  blockIndex: number;
  isImage: boolean;
  label: string;
  /** 括号内 destination（含可选 ./ 与 .md 与 #anchor；不含 title 与尖括号）。 */
  destination: string;
  /** 链接 title（引号已剥离）。 */
  title: string | null;
  /** 原始 destination 是否被 `<>` 包裹。 */
  angle: boolean;
}

export type MarkdownLink = WikiLink | NormalLink;

interface LineInfo {
  start: number;
  end: number;
  sepLen: number;
  blockIndex: number;
  blank: boolean;
}

/** 切行 + 逐行 fence 状态/块序号，并返回一张等长 mask：代码字符替换为空格（保留换行）。 */
function analyze(markdown: string): { lines: LineInfo[]; mask: string[] } {
  const chars = markdown.split('');
  const lines: LineInfo[] = [];
  const parts =
    markdown.match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter((part, index, all) => part.length > 0 || index < all.length - 1) ?? [];
  let cursor = 0;
  let inFence = false;
  let blockIndex = 0;
  let prevBlank = false;
  for (const part of parts) {
    const sepLen = part.endsWith('\r\n') ? 2 : part.endsWith('\n') ? 1 : 0;
    const text = sepLen ? part.slice(0, -sepLen) : part;
    const start = cursor;
    const end = cursor + text.length;
    const isDelim = /^\s*(```|~~~)/.test(text);
    const wasFence = inFence;
    if (isDelim) inFence = !inFence;
    const codeLine = isDelim || wasFence;
    const isBlank = !codeLine && text.trim().length === 0;
    if (isBlank) {
      if (!prevBlank) blockIndex += 1;
      prevBlank = true;
    } else {
      prevBlank = false;
    }
    lines.push({ start, end, sepLen, blockIndex, blank: isBlank });
    // 掩码：fence 定界行、fence 正文行整行置空；非代码行做 inline code 多反引号掩码。
    if (codeLine) {
      for (let i = start; i < end; i += 1) chars[i] = ' ';
    } else {
      maskInlineCode(chars, start, text);
    }
    cursor += text.length + sepLen;
  }
  return { lines, mask: chars };
}

/** 逐行 inline code 掩码：支持单/多反引号（反引号串长度相同才闭合，CommonMark 近似）。 */
function maskInlineCode(chars: string[], lineStart: number, text: string): void {
  const runs: Array<{ s: number; e: number; len: number }> = [];
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) runs.push({ s: m.index, e: m.index + m[0].length, len: m[0].length });
  let i = 0;
  while (i < runs.length) {
    const open = runs[i]!;
    let close = -1;
    for (let j = i + 1; j < runs.length; j += 1) {
      if (runs[j]!.len === open.len) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      i += 1;
      continue; // 未闭合反引号视为普通字符
    }
    const to = runs[close]!.e;
    for (let k = lineStart + open.s; k < lineStart + to; k += 1) {
      if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
    }
    i = close + 1;
  }
}

function blockIndexAt(lines: LineInfo[], offset: number): number {
  let current = 0;
  for (const line of lines) {
    if (offset < line.end + line.sepLen) return line.blockIndex;
    current = line.blockIndex;
  }
  return current;
}

/** 在 `(` 之后解析普通链接 destination/title，返回括号闭合处与解析结果。 */
function parseNormalAt(md: string, openParen: number): { close: number; destination: string; title: string | null; angle: boolean } | null {
  const n = md.length;
  let i = openParen + 1;
  while (i < n && (md[i] === ' ' || md[i] === '\t')) i += 1;
  const innerStart = i;
  let depth = 1;
  let inAngle = false;
  let quote: string | null = null;
  let close = -1;
  while (i < n) {
    const ch = md[i]!;
    if (ch === '\n') return null;
    if (quote) {
      if (ch === quote && md[i - 1] !== '\\') quote = null;
    } else if (inAngle) {
      if (ch === '>') inAngle = false;
    } else if (ch === '<') inAngle = true;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
    i += 1;
  }
  if (close === -1) return null;
  const inner = md.slice(innerStart, close).trim();
  if (!inner) return null;
  let destination = inner;
  let title: string | null = null;
  let angle = false;
  if (inner.startsWith('<')) {
    const gt = inner.indexOf('>');
    if (gt > -1) {
      destination = inner.slice(1, gt).trim();
      const rest = inner.slice(gt + 1).trim();
      title = stripTitle(rest);
      angle = true;
    }
  } else {
    // destination 在 depth=0 的首个空白处结束（允许 balanced parentheses）。
    let d = 0;
    let split = -1;
    for (let k = 0; k < inner.length; k += 1) {
      const ch = inner[k]!;
      if (ch === '(') d += 1;
      else if (ch === ')') d -= 1;
      else if (d === 0 && (ch === ' ' || ch === '\t' || ch === '\n')) {
        split = k;
        break;
      }
    }
    if (split > -1) {
      destination = inner.slice(0, split).trim();
      title = stripTitle(inner.slice(split).trim());
    }
  }
  if (!destination) return null;
  return { close, destination, title, angle };
}

function stripTitle(raw: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t || null;
}

/** 抽取整篇 Markdown 中的全部链接（wiki + normal），跳过代码。 */
export function extractMarkdownLinks(markdown: string): MarkdownLink[] {
  const { lines, mask } = analyze(markdown);
  const masked = mask.join('');
  const out: MarkdownLink[] = [];

  const wikiRe = /!?\[\[/g;
  let wm: RegExpExecArray | null;
  while ((wm = wikiRe.exec(masked)) !== null) {
    const offset = wm.index;
    const parsed = parseWikiAt(markdown, offset);
    if (!parsed) continue;
    out.push({ ...parsed, kind: 'wiki', offset, length: parsed.raw.length, blockIndex: blockIndexAt(lines, offset) });
  }

  const linkRe = /(!?)\[([^\]\n]*)\]\(/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(masked)) !== null) {
    const bang = lm[1] ?? '';
    const label = lm[2] ?? '';
    const linkStart = lm.index;
    const openParen = lm.index + lm[0].length - 1;
    const parsed = parseNormalAt(markdown, openParen);
    if (!parsed) continue;
    out.push({
      kind: 'normal',
      raw: markdown.slice(linkStart, parsed.close + 1),
      offset: linkStart,
      length: parsed.close + 1 - linkStart,
      blockIndex: blockIndexAt(lines, linkStart),
      isImage: bang === '!',
      label,
      destination: parsed.destination,
      title: parsed.title,
      angle: parsed.angle,
    });
  }
  out.sort((a, b) => a.offset - b.offset);
  return out;
}

function parseWikiAt(md: string, offset: number): { raw: string; target: string; targetName: string; alias: string | null; anchor: string | null; isEmbed: boolean } | null {
  const slice = md.slice(offset);
  const m = /^(!)?\[\[([^[\]]+?)\]\]/.exec(slice);
  if (!m) return null;
  const raw = m[0];
  const isEmbed = m[1] === '!';
  let inner = m[2] ?? '';
  let alias: string | null = null;
  const bar = inner.indexOf('|');
  if (bar !== -1) {
    alias = inner.slice(bar + 1).trim() || null;
    inner = inner.slice(0, bar);
  }
  let target = inner.trim();
  if (target.startsWith('./')) target = target.slice(2);
  let anchor: string | null = null;
  const hash = target.indexOf('#');
  if (hash !== -1) {
    anchor = target.slice(hash).trim() || null;
    target = target.slice(0, hash).trim();
  }
  if (!target && !anchor) return null;
  const targetName = target.replace(/\.md$/i, '');
  return { raw, target, targetName, alias, anchor, isEmbed };
}

// ── 普通链接 destination 分类（note / asset / external / anchor） ──

const NOTE_EXT = /\.(md|markdown)$/i;
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|pdf|zip|7z|tar|gz|rar|mov|mp4|webm|mkv|mp3|wav|ogg|flac|json|csv|xlsx|docx|pptx|exe|dmg|app)$/i;

export type NormalDestKind = 'note' | 'asset' | 'external' | 'anchor';

export function classifyNormalDestination(rawDestination: string): NormalDestKind {
  const dest = rawDestination.trim().replace(/^<|>$/g, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(dest)) return 'external';
  const noAnchor = dest.split('#')[0] ?? '';
  if (!noAnchor || dest.startsWith('#')) return 'anchor';
  const pathPart = noAnchor.replace(/^\.\//, '').replace(/^\/+/, '');
  if (!pathPart) return 'anchor';
  const hasExt = /\.[^/]+$/.test(pathPart);
  if (!hasExt) return 'note';
  if (NOTE_EXT.test(pathPart)) return 'note';
  if (ASSET_EXT.test(pathPart)) return 'asset';
  return 'asset';
}

// ── 纯 posix 路径工具（renderer 安全，无 node:path） ──

function posixDirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}
function posixNormalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0 || parts[parts.length - 1] === '..') return '..'; // 逃逸
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * 普通链接 destination → 相对 vault 的目标 stem（无 .md）。
 * sourcePath 为链接所在页面的 vault 相对路径；返回 null 表示外链/锚点/资源/逃逸。
 */
export function resolveNoteLinkTarget(sourcePath: string, rawDestination: string): string | null {
  if (classifyNormalDestination(rawDestination) !== 'note') return null;
  let dest = rawDestination.trim().replace(/^<|>$/g, '').split('#')[0] ?? '';
  const fromRoot = dest.startsWith('/');
  dest = dest.replace(/^\/+/, '').replace(/^\.\//, '');
  const combined = fromRoot ? dest : `${posixDirname(sourcePath)}/${dest}`;
  const normalized = posixNormalize(combined);
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized.replace(NOTE_EXT, '');
}

/** 计算把链接目标改写后的 destination 字符串（保留 ./ 前缀、.md 后缀、anchor、title、尖括号）。 */
export interface NormalRewriteInput {
  destination: string;
  angle: boolean;
  title: string | null;
}

export function rebaseNormalDestination(
  sourcePath: string,
  dest: NormalRewriteInput,
  newStem: string,
): string {
  const original = dest.destination.trim();
  const hashIdx = original.indexOf('#');
  const anchor = hashIdx < 0 ? '' : original.slice(hashIdx);
  const pathPart = hashIdx < 0 ? original : original.slice(0, hashIdx);
  const hadDotSlash = pathPart.replace(/^<|>$/g, '').startsWith('./') || pathPart.startsWith('./');
  const hadMd = NOTE_EXT.test(pathPart);
  const fromDir = posixDirname(sourcePath);
  const rel = relativePosix(fromDir, newStem);
  let outPath = rel === '' ? newStem.split('/').pop() ?? newStem : rel;
  if (hadMd) outPath = `${outPath}.md`;
  if (hadDotSlash && !outPath.startsWith('.') && !outPath.startsWith('/')) outPath = `./${outPath}`;
  let rebuilt = `${outPath}${anchor}`;
  if (dest.title) rebuilt = `${rebuilt} "${dest.title}"`;
  if (dest.angle) rebuilt = `<${rebuilt}>`;
  return rebuilt;
}

function relativePosix(fromDir: string, toStem: string): string {
  const from = fromDir ? fromDir.split('/').filter(Boolean) : [];
  const to = toStem.split('/').filter(Boolean);
  let common = 0;
  const maxCommon = Math.min(from.length, to.length - 1 < 0 ? 0 : to.length - 1);
  while (common < maxCommon && from[common] === to[common]) common += 1;
  const ups = from.slice(common).map(() => '..');
  const downs = to.slice(common);
  const parts = [...ups, ...downs];
  return parts.join('/');
}

// ── 块切分（与链接 blockIndex 严格对齐） ──

export interface RawBlock {
  text: string;
  start: number;
  position: number;
}

/** 按空行（fence 内空行不算）切分为块，偏移/序号与 extractMarkdownLinks.blockIndex 一致。 */
export function splitMarkdownBlocks(body: string): RawBlock[] {
  const { lines } = analyze(body);
  const blocks: RawBlock[] = [];
  let start = 0;
  let position = 0;
  let prevBlank = false;
  for (const line of lines) {
    const lineEnd = line.end + line.sepLen;
    if (line.blank) {
      if (!prevBlank) {
        blocks.push({ text: body.slice(start, line.start), start, position });
        position += 1;
      }
      start = lineEnd;
      prevBlank = true;
    } else {
      prevBlank = false;
    }
  }
  blocks.push({ text: body.slice(start), start, position });
  return blocks;
}

// ── 重命名用 code-aware 重写（只改链接，不动代码） ──

function isDescendantOrSelf(linkPath: string, stem: string): boolean {
  return linkPath === stem || linkPath.startsWith(`${stem}/`);
}

function posixBasename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

/** code-aware 重写 wikilink：与索引器共用链接解析，跳过代码段；保留 alias/anchor/embed。 */
export function rewriteWikiTargets(
  markdown: string,
  fromStem: string,
  toStem: string,
): { content: string; changed: boolean } {
  if (fromStem === toStem) return { content: markdown, changed: false };
  const fromBase = posixBasename(fromStem);
  const toBase = posixBasename(toStem);
  const links = extractMarkdownLinks(markdown);
  let content = markdown;
  let changed = false;
  for (let i = links.length - 1; i >= 0; i -= 1) {
    const link = links[i]!;
    if (link.kind !== 'wiki') continue;
    const linkPath = link.targetName;
    let newPath: string | null = null;
    if (linkPath === fromBase) newPath = toBase;
    else if (isDescendantOrSelf(linkPath, fromStem)) newPath = toStem + linkPath.slice(fromStem.length);
    if (newPath === null) continue;
    const aliasPart = link.alias ? `|${link.alias}` : '';
    const rebuilt = `${link.isEmbed ? '!' : ''}[[${newPath}${link.anchor ?? ''}${aliasPart}]]`;
    if (rebuilt === link.raw) continue;
    content = content.slice(0, link.offset) + rebuilt + content.slice(link.offset + link.length);
    changed = true;
  }
  return { content, changed };
}

/**
 * code-aware 重写普通 Markdown 链接：按链接所在文件（sourcePath）目录解析真实目标，
 * 仅当解析目标命中被重命名/移动的路径时才改写，避免 basename 误伤其他目录或代码示例。
 */
export function rewriteNormalLinkTargets(
  markdown: string,
  fromStem: string,
  toStem: string,
  sourcePath: string,
): { content: string; changed: boolean } {
  if (fromStem === toStem) return { content: markdown, changed: false };
  const links = extractMarkdownLinks(markdown);
  let content = markdown;
  let changed = false;
  for (let i = links.length - 1; i >= 0; i -= 1) {
    const link = links[i]!;
    if (link.kind !== 'normal' || link.isImage) continue;
    if (classifyNormalDestination(link.destination) !== 'note') continue;
    const resolved = resolveNoteLinkTarget(sourcePath, link.destination);
    if (resolved === null) continue;
    let newStem: string | null = null;
    if (resolved === fromStem) newStem = toStem;
    else if (isDescendantOrSelf(resolved, fromStem)) newStem = toStem + resolved.slice(fromStem.length);
    if (newStem === null) continue;
    const newDest = rebaseNormalDestination(sourcePath, { destination: link.destination, angle: link.angle, title: link.title }, newStem);
    const rebuilt = `[${link.label}](${newDest})`;
    if (rebuilt === link.raw) continue;
    content = content.slice(0, link.offset) + rebuilt + content.slice(link.offset + link.length);
    changed = true;
  }
  return { content, changed };
}
