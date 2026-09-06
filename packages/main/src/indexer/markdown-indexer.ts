import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { extractWikilinks } from '@nexnote/shared';
import { extractInlineTags, parseFrontmatterTags, splitFrontmatter } from '../fs/page-ops';

export interface ParsedLink {
  targetRaw: string;
  targetName: string;
  alias: string | null;
  anchor: string | null;
  linkType: 'wiki' | 'normal';
  /** 原始 wikilink 字符串（`[[Target|显示]]`），用于反链上下文定位。 */
  sourceText: string;
  /** 该链接所在的 0-based 段落块序号。 */
  sourceBlockIndex: number;
}
export interface ParsedBlock { blockId: string | null; blockType: string; content: string; position: number; }
export interface ParsedPage { path: string; title: string; aliases: string[]; createdAt: string | null; updatedAt: string | null; hash: string; body: string; tags: string[]; links: ParsedLink[]; blocks: ParsedBlock[]; }

function yamlValue(frontmatter: string | null, key: string): string | null {
  if (!frontmatter) return null;
  return new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null;
}
function yamlList(frontmatter: string | null, key: string): string[] {
  if (!frontmatter) return [];
  const raw = yamlValue(frontmatter, key);
  if (!raw) return [];
  return (raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function classifyBlock(raw: string): string {
  const first = raw.trimStart();
  if (first.startsWith('#')) return 'heading';
  if (first.startsWith('```')) return 'codeBlock';
  if (first.startsWith('>')) return 'blockquote';
  if (first.startsWith('- [')) return 'taskList';
  if (first.startsWith('- ')) return 'bulletList';
  return 'paragraph';
}

function parseBlocks(body: string): { blocks: ParsedBlock[]; rawBlocks: Array<{ text: string; start: number; position: number }> } {
  // Preserve each split segment's source offset: identical paragraphs must remain distinct.
  const rawBlocks: Array<{ text: string; start: number; position: number }> = [];
  let start = 0;
  let position = 0;
  for (const separator of body.matchAll(/\n{2,}/g)) {
    rawBlocks.push({ text: body.slice(start, separator.index), start, position });
    start = (separator.index ?? 0) + separator[0].length;
    position += 1;
  }
  rawBlocks.push({ text: body.slice(start), start, position });
  const blocks: ParsedBlock[] = [];
  for (const segment of rawBlocks) {
    const { text: raw, position: blockPosition } = segment;
    if (raw.trim().length === 0) continue;
    const anchor = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(raw);
    const content = raw.replace(/\^([A-Za-z0-9_-]+)\s*$/, '').trim();
    blocks.push({ blockId: anchor?.[1] ?? null, blockType: classifyBlock(raw), content, position: blockPosition });
  }
  return { blocks, rawBlocks };
}

/** Shared markdown extraction used by the SQLite index. Keeps DEV-002 wikilink grammar. */
export function parsePageMarkdown(pagePath: string, text: string): ParsedPage {
  const { frontmatter, body } = splitFrontmatter(text);
  const title = /^#\s+(.+?)\s*$/m.exec(body)?.[1]?.trim() ?? path.posix.basename(pagePath, '.md');
  const aliases = yamlList(frontmatter, 'aliases');
  const { blocks, rawBlocks } = parseBlocks(body);
  const links: ParsedLink[] = [];
  for (const ref of extractWikilinks(body)) {
    links.push({
      targetRaw: ref.inner,
      targetName: ref.targetName,
      alias: ref.alias,
      anchor: ref.anchor,
      linkType: 'wiki',
      sourceText: ref.raw,
      sourceBlockIndex: ref.blockIndex,
    });
  }
  // 普通 Markdown 链接：定位所在块，把 raw 与块 index 一同写入，便于反链上下文。
  for (const match of body.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = (match[1] ?? '').trim();
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) continue;
    const hash = raw.indexOf('#');
    const targetPart = (hash < 0 ? raw : raw.slice(0, hash)).replace(/^\.\//, '').replace(/\.md$/i, '');
    if (!targetPart) continue;
    const sourceText = match[0];
    const offset = match.index ?? 0;
    const blockIndex = rawBlocks.find((block) => offset >= block.start && offset < block.start + block.text.length)?.position;
    links.push({
      targetRaw: raw,
      targetName: targetPart,
      alias: null,
      anchor: hash < 0 ? null : raw.slice(hash),
      linkType: 'normal',
      sourceText,
      sourceBlockIndex: blockIndex ?? 0,
    });
  }
  const tags = [...new Set([...(frontmatter ? parseFrontmatterTags(frontmatter) : []), ...extractInlineTags(body)])].sort();
  return { path: pagePath, title, aliases, createdAt: yamlValue(frontmatter, 'created'), updatedAt: yamlValue(frontmatter, 'updated'), hash: createHash('sha256').update(text).digest('hex'), body, tags, links, blocks };
}
