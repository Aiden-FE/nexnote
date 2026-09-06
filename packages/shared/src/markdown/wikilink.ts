/**
 * Obsidian wikilink 统一解析器（DEV-002 编辑器 + DEV-004 关系索引共享）。
 */
import { extractMarkdownLinks } from './links';

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

/**
 * 从整篇 Markdown 抽取 wikilinks（委托到共享 code-aware 解析器）。
 * 跳过 fenced code 与 inline code（含多反引号）；偏移为 UTF-16，blockIndex 与块切分一致。
 */
export function extractWikilinks(markdown: string): WikilinkReference[] {
  return extractMarkdownLinks(markdown)
    .filter((link): link is Extract<typeof link, { kind: 'wiki' }> => link.kind === 'wiki')
    .map((ref) => ({
      raw: ref.raw,
      inner: `${ref.target}${ref.anchor ?? ''}${ref.alias ? `|${ref.alias}` : ''}`,
      target: `${ref.targetName}${ref.anchor ?? ''}`,
      targetName: ref.targetName,
      alias: ref.alias,
      anchor: ref.anchor,
      offset: ref.offset,
      blockIndex: ref.blockIndex,
    }));
}
