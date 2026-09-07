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
}

function normalize(q: string): string {
  return q.trim().toLowerCase();
}

export function filterPageCandidates(pages: PageCandidate[], query: string): SuggestionItem[] {
  const q = normalize(query);
  const pool: PageCandidate[] = [];
  for (const p of pages) {
    if (!p.path.toLowerCase().endsWith('.md')) continue;
    const title = p.title.trim();
    if (!title) continue;
    // 标题首选项；同一标题去重（保留首个）
    if (!pool.some((x) => x.title === title)) pool.push({ path: p.path, title });
  }
  const matches = pool.filter(
    (p) =>
      !q || p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  );
  // 精确/前缀优先，其次包含
  const scored = matches
    .map((p) => {
      const t = p.title.toLowerCase();
      const exact = t === q;
      const prefix = t.startsWith(q);
      return { p, exact, prefix };
    })
    .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.prefix) - Number(a.prefix) || a.p.title.localeCompare(b.p.title));
  return scored.map(({ p }) => ({
    id: p.path.replace(/\.md$/i, '').replace(/\\/g, '/'),
    title: p.title,
    hint: p.path.slice(0, -3),
  }));
}

/** 把「query 未命中任何页面」也加入红链项（回车可创建）。 */
export function withUncreated(pages: PageCandidate[], query: string): SuggestionItem[] {
  const items = filterPageCandidates(pages, query);
  const q = normalize(query);
  if (q && !items.some((it) => it.title.toLowerCase() === q)) {
    items.push({ id: query.trim(), title: query.trim(), hint: '创建新页面', meta: 'uncreated' });
  }
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
