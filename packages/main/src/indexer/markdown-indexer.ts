import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { extractMarkdownLinks, resolveNoteLinkTarget, splitMarkdownBlocks } from '@nexnote/shared';
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
export interface ParsedPage { path: string; title: string; aliases: string[]; createdAt: string | null; updatedAt: string | null; hash: string; body: string; tags: string[]; links: ParsedLink[]; blocks: ParsedBlock[]; confidenceBoost: number | null; }

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

function yamlNumber(frontmatter: string | null, key: string): number | null {
  const raw = yamlValue(frontmatter, key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
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
  // 共享块切分：与 extractMarkdownLinks.blockIndex 严格对齐（CRLF/LF、fence 内空行均已处理）。
  const rawBlocks = splitMarkdownBlocks(body);
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
  const { blocks } = parseBlocks(body);
  const links: ParsedLink[] = [];
  for (const ref of extractMarkdownLinks(body)) {
    if (ref.kind === 'wiki') {
      links.push({
        targetRaw: `${ref.targetName}${ref.anchor ?? ''}`,
        targetName: ref.targetName,
        alias: ref.alias,
        anchor: ref.anchor,
        linkType: 'wiki',
        sourceText: ref.raw,
        sourceBlockIndex: ref.blockIndex,
      });
      continue;
    }
    if (ref.isImage) continue; // ![...](...) 为资源嵌入，不计入笔记关系
    // 普通链接：相对源文件目录归一化到 vault 相对 stem；外链/锚点/资源/路径逃逸一律跳过。
    const resolved = resolveNoteLinkTarget(pagePath, ref.destination);
    if (resolved === null) continue;
    const hash = ref.destination.indexOf('#');
    links.push({
      targetRaw: ref.destination,
      targetName: resolved,
      alias: null,
      anchor: hash < 0 ? null : ref.destination.slice(hash),
      linkType: 'normal',
      sourceText: ref.raw,
      sourceBlockIndex: ref.blockIndex,
    });
  }
  const tags = [...new Set([...(frontmatter ? parseFrontmatterTags(frontmatter) : []), ...extractInlineTags(body)])].sort();
  return { path: pagePath, title, aliases, createdAt: yamlValue(frontmatter, 'created'), updatedAt: yamlValue(frontmatter, 'updated'), hash: createHash('sha256').update(text).digest('hex'), body, tags, links, blocks, confidenceBoost: yamlNumber(frontmatter, 'confidence_boost') };
}
