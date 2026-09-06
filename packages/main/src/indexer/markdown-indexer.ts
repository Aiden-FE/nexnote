import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { extractWikilinks } from '@nexnote/shared';
import { extractInlineTags, parseFrontmatterTags, splitFrontmatter } from '../fs/page-ops';

export interface ParsedLink { targetRaw: string; targetName: string; alias: string | null; anchor: string | null; linkType: 'wiki' | 'normal'; }
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

/** Shared markdown extraction used by the SQLite index. Keeps DEV-002 wikilink grammar. */
export function parsePageMarkdown(pagePath: string, text: string): ParsedPage {
  const { frontmatter, body } = splitFrontmatter(text);
  const title = /^#\s+(.+?)\s*$/m.exec(body)?.[1]?.trim() ?? path.posix.basename(pagePath, '.md');
  const aliases = yamlList(frontmatter, 'aliases');
  const links: ParsedLink[] = extractWikilinks(body).map((ref) => ({
    targetRaw: ref.inner,
    targetName: ref.targetName,
    alias: ref.alias,
    anchor: ref.anchor,
    linkType: 'wiki',
  }));
  // 普通 Markdown 链接，仅索引指向 vault 内 .md 的相对链接；http(s)/mailto 等外链跳过。
  for (const match of body.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = (match[1] ?? '').trim();
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) continue;
    const hash = raw.indexOf('#');
    const targetPart = (hash < 0 ? raw : raw.slice(0, hash)).replace(/^\.\//, '').replace(/\.md$/i, '');
    if (!targetPart) continue;
    links.push({ targetRaw: raw, targetName: targetPart, alias: null, anchor: hash < 0 ? null : raw.slice(hash), linkType: 'normal' });
  }
  const blocks = body.split(/\n{2,}/).map((raw, position) => {
    const anchor = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(raw);
    const first = raw.trimStart();
    const blockType = first.startsWith('#') ? 'heading' : first.startsWith('```') ? 'codeBlock' : first.startsWith('>') ? 'blockquote' : first.startsWith('- [') ? 'taskList' : first.startsWith('- ') ? 'bulletList' : 'paragraph';
    return { blockId: anchor?.[1] ?? null, blockType, content: raw.replace(/\^([A-Za-z0-9_-]+)\s*$/, '').trim(), position };
  }).filter((b) => b.content.length > 0);
  const tags = [...new Set([...(frontmatter ? parseFrontmatterTags(frontmatter) : []), ...extractInlineTags(body)])].sort();
  return { path: pagePath, title, aliases, createdAt: yamlValue(frontmatter, 'created'), updatedAt: yamlValue(frontmatter, 'updated'), hash: createHash('sha256').update(text).digest('hex'), body, tags, links, blocks };
}
