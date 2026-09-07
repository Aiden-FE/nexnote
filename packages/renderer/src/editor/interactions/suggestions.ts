import type { SuggestionItem } from '@nexnote/kernel';

/**
 * DEV-017 补全候选（纯逻辑，浏览器与单测共用）。
 *
 * - wikilink：按 title/path 模糊过滤 vault 页面；meta:'uncreated' 标灰（红链）
 * - hashtag：按标签前缀/包含过滤，保留嵌套层级（`work/project`）
 */

/** vault 页面候选来源（page-tree store entries 或 index graph pages）。 */
export interface PageCandidate {
  path: string;
  title: string;
  /** frontmatter aliases（可空）；用于 wikilink 补全的别名匹配与显示 */
  aliases?: string[];
}

/** `[[` 查询词解析：支持 `[[标题|别名]]` 与 `[[标题#锚点]]` 语法（`|` 优先）。 */
export interface WikilinkQuery {
  /** 页面标题部分（候选过滤、红链创建目标） */
  title: string;
  /** 已输入别名（选择候选后随插入载荷保留） */
  alias: string | null;
  /** 已输入锚点（选择候选后随插入载荷保留） */
  heading: string | null;
}

export function parseWikilinkQuery(query: string): WikilinkQuery {
  const pipe = query.indexOf('|');
  if (pipe >= 0) {
    return { title: query.slice(0, pipe), alias: query.slice(pipe + 1) || null, heading: null };
  }
  const hash = query.indexOf('#');
  if (hash >= 0) {
    return { title: query.slice(0, hash), alias: null, heading: query.slice(hash + 1) || null };
  }
  return { title: query, alias: null, heading: null };
}

function normalize(q: string): string {
  return q.trim().toLowerCase();
}

/** 组合插入载荷：目标 = 页面路径（去扩展名）；用户已输入别名/锚点时随选择保留。 */
function insertPayload(path: string, parsed: WikilinkQuery): SuggestionItem['insert'] {
  const base = path.replace(/\.md$/i, '').replace(/\\/g, '/');
  if (parsed.alias != null) return { target: base, alias: parsed.alias };
  if (parsed.heading != null) return { target: `${base}#${parsed.heading}` };
  return undefined;
}

export function filterPageCandidates(pages: PageCandidate[], query: string): SuggestionItem[] {
  const parsed = parseWikilinkQuery(query);
  const q = normalize(parsed.title);
  const pool: PageCandidate[] = [];
  const seenPaths = new Set<string>();
  for (const p of pages) {
    if (!p.path.toLowerCase().endsWith('.md')) continue;
    const title = p.title.trim();
    if (!title) continue;
    // 按路径去重：同名不同路径的页面都保留（不要按 title 去重丢失同名页面）
    if (seenPaths.has(p.path)) continue;
    seenPaths.add(p.path);
    pool.push(p);
  }
  const matches = pool.filter((p) => {
    if (!q) return true;
    const titleOk = p.title.toLowerCase().includes(q);
    const pathOk = p.path.toLowerCase().includes(q);
    const aliasOk = (p.aliases ?? []).some((a) => a.toLowerCase().includes(q));
    return titleOk || pathOk || aliasOk;
  });
  // 精确/前缀优先，其次包含
  const scored = matches
    .map((p) => {
      const t = p.title.toLowerCase();
      const exact = t === q;
      const prefix = t.startsWith(q);
      const aliasExact = (p.aliases ?? []).some((a) => a.toLowerCase() === q);
      const aliasPrefix = (p.aliases ?? []).some((a) => a.toLowerCase().startsWith(q));
      return { p, exact, prefix, aliasExact, aliasPrefix };
    })
    .sort((a, b) =>
      Number(b.exact) - Number(a.exact)
      || Number(b.aliasExact) - Number(a.aliasExact)
      || Number(b.prefix) - Number(a.prefix)
      || Number(b.aliasPrefix) - Number(a.aliasPrefix)
      || a.p.title.localeCompare(b.p.title),
    );
  return scored.map(({ p }) => {
    const aliases = p.aliases ?? [];
    return {
      id: p.path.replace(/\.md$/i, '').replace(/\\/g, '/'),
      title: p.title,
      hint: aliases.length > 0 ? `${aliases[0]} · ${p.path.slice(0, -3)}` : p.path.slice(0, -3),
      insert: insertPayload(p.path, parsed),
    };
  });
}

/** 把「query 未命中任何页面」也加入红链项（回车创建页面并插入链接）。 */
export function withUncreated(pages: PageCandidate[], query: string): SuggestionItem[] {
  const items = filterPageCandidates(pages, query);
  const parsed = parseWikilinkQuery(query);
  const titlePart = parsed.title.trim();
  if (titlePart && !items.some((it) => it.title.toLowerCase() === titlePart.toLowerCase())) {
    items.push({
      id: titlePart,
      title: titlePart,
      hint: '创建新页面',
      meta: 'uncreated',
      insert: insertPayload(`${titlePart}.md`, parsed) ?? { target: titlePart },
    });
  }
  // 最终按 id 去重（id 是路径去重后的标识；红链以标题为 id）
  const seen = new Set<string>();
  return items.filter((it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
}

export function filterTagCandidates(tags: string[], query: string): SuggestionItem[] {
  const q = normalize(query);
  const set = new Set(Array.isArray(tags) ? tags : []);
  const list = [...set].filter((t) => !q || t.toLowerCase().includes(q));
  // 前缀（同层续写）优先
  return list
    .sort((a, b) => {
      const ap = a.toLowerCase().startsWith(q) ? 1 : 0;
      const bp = b.toLowerCase().startsWith(q) ? 1 : 0;
      return bp - ap || a.localeCompare(b);
    })
    .slice(0, 12)
    .map((t) => ({
      id: t,
      title: t,
      hint: t.includes('/') ? '嵌套' : undefined,
    }));
}
