import packageMetadata from '../../../../package.json';

/** ADR-0022：文档 URL 以 package.json 的 homepage 为唯一生产域名来源。 */
export const PRODUCT_DOCS_BASE_URL: string = packageMetadata.homepage;

export function gettingStartedDocsUrl(language: string | undefined): string {
  return `${PRODUCT_DOCS_BASE_URL}${language === 'en-US' ? '/docs' : '/zh/docs'}/getting-started`;
}
