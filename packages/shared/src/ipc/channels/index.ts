import type { Result } from '../result';
import type {
  Backlink,
  IndexStatus,
  PageIndexSummary,
  PageJumpResult,
  SearchHit,
  TagIndexEntry,
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
}
