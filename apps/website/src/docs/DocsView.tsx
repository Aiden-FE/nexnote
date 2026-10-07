import { useMemo } from 'react';
import { chapterBySlug, chapters, type Lang } from './content';
import { headingId, renderMarkdown } from './markdown';

export const docsCopy = {
  zh: {
    home: '产品文档',
    intro: '按顺序读完这几章，你就能把 NexNote 用顺手。文档与仓库同源，内容随产品持续校正。',
    version: '适用版本 v0.0.29+',
    read: '开始阅读',
    onThisPage: '本页内容',
    notFound: '找不到这一章。',
    backHome: '回到文档首页',
    prev: '上一章',
    next: '下一章',
  },
  en: {
    home: 'Documentation',
    intro:
      'Read these chapters in order and NexNote will feel natural. The docs are sourced from the repository and corrected as the product changes.',
    version: 'Applies to v0.0.29+',
    read: 'Start reading',
    onThisPage: 'On this page',
    notFound: 'This chapter does not exist.',
    backHome: 'Back to documentation home',
    prev: 'Previous',
    next: 'Next',
  },
} as const;

export type DocsText = (typeof docsCopy)[Lang];

function docsPath(lang: Lang, slug?: string): string {
  const prefix = lang === 'zh' ? '/zh/docs' : '/docs';
  return slug ? `${prefix}/${slug}` : prefix;
}

function Anchor({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="docs-link" href={href}>
      {children}
    </a>
  );
}

export function DocsIndex({ lang, text }: { lang: Lang; text: DocsText }) {
  const list = chapters(lang);
  return (
    <main className="docs-shell">
      <header className="docs-hero">
        <p className="eyebrow">{text.home}</p>
        <h1>{lang === 'zh' ? '把知识用顺手。' : 'Make the knowledge work for you.'}</h1>
        <p className="docs-lead">{text.intro}</p>
        <p className="docs-version">{text.version}</p>
      </header>
      <ol className="docs-cards">
        {list.map((chapter) => (
          <li key={chapter.slug}>
            <Anchor href={docsPath(lang, chapter.slug)}>
              <span className="docs-card-order">{String(chapter.order).padStart(2, '0')}</span>
              <span className="docs-card-title">{chapter.title}</span>
              <span className="docs-card-summary">{chapter.summary}</span>
              <span className="docs-card-go">{text.read} →</span>
            </Anchor>
          </li>
        ))}
      </ol>
    </main>
  );
}

export function DocsChapter({ lang, text, slug }: { lang: Lang; text: DocsText; slug: string }) {
  const list = chapters(lang);
  const position = list.findIndex((item) => item.slug === slug);
  const chapter = chapterBySlug(lang, slug);

  const headings = useMemo(() => {
    if (!chapter) return [] as { level: number; text: string; id: string }[];
    return [...chapter.body.matchAll(/^(#{2,3})\s+(.*)$/gm)].map((match) => ({
      level: (match[1] ?? '##').length,
      text: (match[2] ?? '').trim(),
      id: headingId((match[2] ?? '').trim()),
    }));
  }, [chapter]);

  if (!chapter) {
    return (
      <main className="docs-shell">
        <h1 className="docs-missing">{text.notFound}</h1>
        <p>
          <Anchor href={docsPath(lang)}>← {text.backHome}</Anchor>
        </p>
      </main>
    );
  }

  const previous = position > 0 ? list[position - 1] : undefined;
  const next = position >= 0 ? list[position + 1] : undefined;
  const html = renderMarkdown(chapter.body);

  return (
    <main className="docs-shell docs-layout">
      <aside className="docs-sidebar">
        <p className="docs-sidebar-title">{text.home}</p>
        <ul>
          {list.map((item) => (
            <li key={item.slug}>
              <Anchor href={docsPath(lang, item.slug)}>{item.title}</Anchor>
            </li>
          ))}
        </ul>
        <p className="docs-version">{text.version}</p>
      </aside>
      <article className="docs-article">
        <h1>{chapter.title}</h1>
        <div className="docs-body" dangerouslySetInnerHTML={{ __html: html }} />
        <nav className="docs-pager">
          {previous ? (
            <Anchor href={docsPath(lang, previous.slug)}>
              ← {text.prev}：{previous.title}
            </Anchor>
          ) : (
            <span />
          )}
          {next ? (
            <Anchor href={docsPath(lang, next.slug)}>
              {text.next}：{next.title} →
            </Anchor>
          ) : (
            <span />
          )}
        </nav>
      </article>
      <aside className="docs-toc">
        <p className="docs-sidebar-title">{text.onThisPage}</p>
        <ul>
          {headings.map((heading) => (
            <li key={heading.id} data-level={heading.level}>
              <a href={`#${heading.id}`}>{heading.text}</a>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
