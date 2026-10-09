import rawEnGettingStarted from '../../../../docs/user-guide/en/getting-started.md?raw';
import rawZhGettingStarted from '../../../../docs/user-guide/zh/getting-started.md?raw';
import rawEnWikilinks from '../../../../docs/user-guide/en/wikilinks.md?raw';
import rawZhWikilinks from '../../../../docs/user-guide/zh/wikilinks.md?raw';
import rawEnGitAndSync from '../../../../docs/user-guide/en/git-and-sync.md?raw';
import rawZhGitAndSync from '../../../../docs/user-guide/zh/git-and-sync.md?raw';
import rawEnAiAssistant from '../../../../docs/user-guide/en/ai-assistant.md?raw';
import rawZhAiAssistant from '../../../../docs/user-guide/zh/ai-assistant.md?raw';
import rawEnSpreadsheets from '../../../../docs/user-guide/en/spreadsheets-and-mindmaps.md?raw';
import rawZhSpreadsheets from '../../../../docs/user-guide/zh/spreadsheets-and-mindmaps.md?raw';
import rawEnEditor from '../../../../docs/user-guide/en/editor.md?raw';
import rawZhEditor from '../../../../docs/user-guide/zh/editor.md?raw';
import rawEnSearch from '../../../../docs/user-guide/en/search-and-recall.md?raw';
import rawZhSearch from '../../../../docs/user-guide/zh/search-and-recall.md?raw';
import rawEnConfidence from '../../../../docs/user-guide/en/confidence.md?raw';
import rawZhConfidence from '../../../../docs/user-guide/zh/confidence.md?raw';
import rawEnPlugins from '../../../../docs/user-guide/en/plugins.md?raw';
import rawZhPlugins from '../../../../docs/user-guide/zh/plugins.md?raw';
import rawEnSettings from '../../../../docs/user-guide/en/settings.md?raw';
import rawZhSettings from '../../../../docs/user-guide/zh/settings.md?raw';
import rawEnTroubleshooting from '../../../../docs/user-guide/en/troubleshooting.md?raw';
import rawZhTroubleshooting from '../../../../docs/user-guide/zh/troubleshooting.md?raw';

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
  zh: {
    'getting-started': chapter('zh', rawZhGettingStarted),
    editor: chapter('zh', rawZhEditor),
    wikilinks: chapter('zh', rawZhWikilinks),
    'search-and-recall': chapter('zh', rawZhSearch),
    confidence: chapter('zh', rawZhConfidence),
    'git-and-sync': chapter('zh', rawZhGitAndSync),
    'ai-assistant': chapter('zh', rawZhAiAssistant),
    plugins: chapter('zh', rawZhPlugins),
    'spreadsheets-and-mindmaps': chapter('zh', rawZhSpreadsheets),
    settings: chapter('zh', rawZhSettings),
    troubleshooting: chapter('zh', rawZhTroubleshooting),
  },
  en: {
    'getting-started': chapter('en', rawEnGettingStarted),
    editor: chapter('en', rawEnEditor),
    wikilinks: chapter('en', rawEnWikilinks),
    'search-and-recall': chapter('en', rawEnSearch),
    confidence: chapter('en', rawEnConfidence),
    'git-and-sync': chapter('en', rawEnGitAndSync),
    'ai-assistant': chapter('en', rawEnAiAssistant),
    plugins: chapter('en', rawEnPlugins),
    'spreadsheets-and-mindmaps': chapter('en', rawEnSpreadsheets),
    settings: chapter('en', rawEnSettings),
    troubleshooting: chapter('en', rawEnTroubleshooting),
  },
};

/** 按 order 升序返回该语言的章节。 */
export function chapters(lang: Lang): Chapter[] {
  return Object.values(byLang[lang]).sort((a, b) => a.order - b.order);
}

export function chapterBySlug(lang: Lang, slug: string): Chapter | undefined {
  return byLang[lang][slug];
}
