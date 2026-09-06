/**
 * Obsidian wikilink 统一解析器（DEV-002 编辑器 + DEV-004 关系索引共享）。
 */
export interface WikilinkReference {
  /** 完整源码，如 [[title#heading|alias]] */
  raw: string;
  /** 括号内原文 */
  inner: string;
  /** 目标（含 anchor，不含 alias） */
  target: string;
  /** 解析目标名（不含 anchor / .md） */
  targetName: string;
  alias: string | null;
  /** #heading / #^block-id */
  anchor: string | null;
  /** wikilink 在原始 markdown 字符串中的 UTF-16 code-unit 偏移（与 String.slice/indexOf 一致）。 */
  offset: number;
  /** 同一位置的 UTF-8 byte offset，供文件/数据库字节定位使用。 */
  byteOffset: number;
  /** wikilink 所在的 0-based 段落块序号（按空行切分）。 */
  blockIndex: number;
}

/** 仅在 src 起始位置解析一个 wikilink（TipTap tokenizer 使用）。 */
export function parseWikilinkAtStart(src: string): WikilinkReference | null {
  const match = /^!?\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/.exec(src);
  if (!match) return null;
  const target = (match[1] ?? '').trim();
  if (!target) return null;
  const hash = target.indexOf('#');
  const targetName = (hash < 0 ? target : target.slice(0, hash)).trim().replace(/\.md$/i, '');
  return {
    raw: match[0],
    inner: `${target}${match[2] ? `|${match[2]}` : ''}`,
    target,
    targetName,
    alias: match[2]?.trim() || null,
    anchor: hash < 0 ? null : target.slice(hash).trim() || null,
    offset: 0,
    byteOffset: 0,
    blockIndex: 0,
  };
}

/** 内部辅助：在单行 line 上抓取所有 wikilink，返回每条的 raw 长度以便 lastIndex 推进。 */
function scanLine(line: string): { raw: string; inner: string; target: string; targetName: string; alias: string | null; anchor: string | null; colStart: number }[] {
  const out: { raw: string; inner: string; target: string; targetName: string; alias: string | null; anchor: string | null; colStart: number }[] = [];
  const cleaned = line.replace(/`[^`]*`/g, ' ');
  const re = /!?\[\[/g;
  for (let m = re.exec(cleaned); m; m = re.exec(cleaned)) {
    const parsed = parseWikilinkAtStart(line.slice(m.index));
    if (!parsed) continue;
    out.push({ ...parsed, colStart: m.index });
    re.lastIndex = m.index + parsed.raw.length;
  }
  return out;
}

/**
 * 从整篇 Markdown 抽取 wikilinks；跳过 fenced code 与 inline code。
 * 每个引用包含原始字符串的 UTF-16 偏移与所在段落块序号（CRLF/LF 空行均为块边界）。
 */
export function extractWikilinks(markdown: string): WikilinkReference[] {
  const out: WikilinkReference[] = [];
  let inFence = false;
  let blockIndex = 0;
  let cursor = 0;
  let prevEmpty = false;
  // Keep separators so cursor advances by the exact original UTF-16 length (LF or CRLF).
  const lines = markdown.match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter((part, index, all) => part.length > 0 || index < all.length - 1) ?? [];
  for (const lineWithSeparator of lines) {
    const separator = lineWithSeparator.endsWith('\r\n') ? '\r\n' : lineWithSeparator.endsWith('\n') ? '\n' : '';
    const rawLine = separator ? lineWithSeparator.slice(0, -separator.length) : lineWithSeparator;
    const advance = rawLine.length + separator.length;
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      prevEmpty = false;
      cursor += advance;
      continue;
    }
    if (inFence) {
      prevEmpty = false;
      cursor += advance;
      continue;
    }
    if (rawLine.trim().length === 0) {
      // 连续空行只算一次块边界，从内容行跨到空行时递增
      if (!prevEmpty) blockIndex += 1;
      prevEmpty = true;
      cursor += advance;
      continue;
    }
    prevEmpty = false;
    const colStart = cursor;
    for (const item of scanLine(rawLine)) {
      const offset = colStart + item.colStart;
      const byteOffset = new TextEncoder().encode(markdown.slice(0, offset)).byteLength;
      out.push({ ...item, offset, byteOffset, blockIndex });
    }
    cursor += advance;
  }
  return out;
}
