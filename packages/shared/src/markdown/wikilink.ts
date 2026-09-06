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
  /** wikilink 在 markdown 字符串中的字节偏移（按行累加）。 */
  offset: number;
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
 * 每个引用包含在 body 中的字节偏移与所在段落块序号（块边界与 `/\n{2,}/` 切分一致）。
 */
export function extractWikilinks(markdown: string): WikilinkReference[] {
  const out: WikilinkReference[] = [];
  let inFence = false;
  let blockIndex = 0;
  let cursor = 0;
  let prevEmpty = false;
  const lines = markdown.split(/\r?\n/);
  for (const rawLine of lines) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      prevEmpty = false;
      cursor += rawLine.length + 1;
      continue;
    }
    if (inFence) {
      prevEmpty = false;
      cursor += rawLine.length + 1;
      continue;
    }
    if (rawLine.trim().length === 0) {
      // 连续空行只算一次块边界，从内容行跨到空行时递增
      if (!prevEmpty) blockIndex += 1;
      prevEmpty = true;
      cursor += rawLine.length + 1;
      continue;
    }
    prevEmpty = false;
    const colStart = cursor;
    for (const item of scanLine(rawLine)) {
      out.push({ ...item, offset: colStart + item.colStart, blockIndex });
    }
    cursor += rawLine.length + 1;
  }
  return out;
}
