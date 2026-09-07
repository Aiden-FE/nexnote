import type { Result } from '../result';
import type {
  Backlink,
  IndexStatus,
  PageIndexSummary,
  PageSummaryLite,
  PageJumpResult,
  SearchHit,
  TagIndexEntry,
  GraphSnapshot,
  ConfidenceResult,
} from '../../types/index';

/** 关系索引能力（DEV-004 Link Index + FTS5 + Tags）。 */
export const INDEX_CHANNELS = [
  'index:status',
  'index:rebuild',
  'index:backlinks',
  'index:search',
  'index:jumpTo',
  'index:tags',
  'index:tagPages',
  'index:pageSummary',
  'index:pageSummaries',
  'index:graph',
  'index:confidence',
  'index:confidenceSettings',
  'index:setConfidenceFrontmatter',
] as const;

export type IndexChannel = (typeof INDEX_CHANNELS)[number];

export interface IndexChannelMap {
  'index:status': { request: void; response: Result<IndexStatus> };
  'index:rebuild': { request: void; response: Result<IndexStatus> };
  'index:backlinks': { request: { pagePath: string }; response: Result<Backlink[]> };
  'index:search': { request: { query: string; limit?: number }; response: Result<SearchHit[]> };
  'index:jumpTo': { request: { query: string; limit?: number }; response: Result<PageJumpResult[]> };
  'index:tags': { request: { flat?: boolean }; response: Result<TagIndexEntry[]> };
  'index:tagPages': { request: { tag: string }; response: Result<string[]> };
  'index:pageSummary': { request: { path: string }; response: Result<PageIndexSummary | null> };
  /** 全量轻量页面摘要（路径/标题/别名），供 wikilink 补全同步缓存（DEV-017）。 */
  'index:pageSummaries': { request: void; response: Result<PageSummaryLite[]> };
  'index:graph': { request: void; response: Result<GraphSnapshot> };
  'index:confidence': { request: { pageId: number }; response: Result<ConfidenceResult | null> };
  'index:confidenceSettings': { request: void; response: Result<{ writeFrontmatter: boolean }> };
  'index:setConfidenceFrontmatter': {
    request: { enabled: boolean };
    response: Result<{ writeFrontmatter: boolean }>;
  };
}
