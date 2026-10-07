import rawEnGettingStarted from '../../../../docs/user-guide/en/getting-started.md?raw';
import rawZhGettingStarted from '../../../../docs/user-guide/zh/getting-started.md?raw';

export type Lang = 'en' | 'zh';

export interface Chapter {
  slug: string;
  order: number;
  title: string;
  summary: string;
  body: string;
}

interface Frontmatter {
  title: string;
  summary: string;
  slug: string;
  order: number;
}

/**
 * 极简 frontmatter 解析：只支持 `key: value` 扁平字段，
 * 以仓库根 CONTEXT.md / ADR 中的文档约定为准，不引入 YAML 依赖。
 */
function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match || !match[1]) throw new Error('docs: 章节文件缺少 frontmatter');
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const order = Number.parseInt(meta.order ?? '0', 10);
  if (!meta.slug || !meta.title) throw new Error('docs: 章节 frontmatter 缺少 slug 或 title');
  return {
    meta: { title: meta.title, summary: meta.summary ?? '', slug: meta.slug, order },
    body: raw.slice(match[0].length),
  };
}

function chapter(lang: Lang, raw: string): Chapter {
  const { meta, body } = parseFrontmatter(raw);
  return { slug: meta.slug, order: meta.order, title: meta.title, summary: meta.summary, body };
}

const byLang: Record<Lang, Record<string, Chapter>> = {
  zh: { 'getting-started': chapter('zh', rawZhGettingStarted) },
  en: { 'getting-started': chapter('en', rawEnGettingStarted) },
};

/** 按 order 升序返回该语言的章节。 */
export function chapters(lang: Lang): Chapter[] {
  return Object.values(byLang[lang]).sort((a, b) => a.order - b.order);
}

export function chapterBySlug(lang: Lang, slug: string): Chapter | undefined {
  return byLang[lang][slug];
}
