import type { Lang } from './content';

/** 官网各语言的文档路径前缀；主页与文档站路由共用同一映射。 */
export function docsPath(lang: Lang, slug?: string): string {
  return `${lang === 'zh' ? '/zh/docs' : '/docs'}${slug ? `/${slug}` : ''}`;
}

/** 第一章「快速上手」：欢迎页「快速上手」按钮与主页 CTA 的统一落点。 */
export const QUICK_START_SLUG = 'getting-started';

export function quickStartPath(lang: Lang): string {
  return docsPath(lang, QUICK_START_SLUG);
}
