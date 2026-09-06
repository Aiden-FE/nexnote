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
  };
}

/**
 * 从整篇 Markdown 抽取 wikilinks；跳过 fenced code 与 inline code。
 */
export function extractWikilinks(markdown: string): WikilinkReference[] {
  const out: WikilinkReference[] = [];
  let inFence = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = rawLine.replace(/`[^`]*`/g, ' ');
    const re = /!?\[\[/g;
    for (let match = re.exec(line); match; match = re.exec(line)) {
      const parsed = parseWikilinkAtStart(line.slice(match.index));
      if (!parsed) continue;
      out.push(parsed);
      re.lastIndex = match.index + parsed.raw.length;
    }
  }
  return out;
}
