/**
 * 关系索引层共享类型（DEV-004 Link Index + FTS5 + Tags）。
 * 主进程 index 服务与渲染层 store/UI 共用。
 */

/** 索引整体状态。 */
export interface IndexStatus {
  phase: 'idle' | 'initializing' | 'scanning' | 'ready' | 'error';
  pagesTotal: number;
  pagesIndexed: number;
  error?: string;
  currentFile?: string;
  mode: 'full' | 'incremental';
}

/** 反向链接条目。 */
export interface Backlink {
  fromPath: string;
  fromTitle: string;
  snippet: string;
  linkType: 'wiki' | 'normal';
  anchor: string;
  targetExists: boolean;
}

/** FTS5 全文搜索命中。 */
export interface SearchHit {
  path: string;
  title: string;
  tier: 'title' | 'tag' | 'alias' | 'content';
  snippet: string;
  tag?: string;
  blockId?: string;
  rank: number;
}

/** 标签索引条目。 */
export interface TagIndexEntry {
  tag: string;
  pageCount: number;
  path: string[];
  isIntermediate?: boolean;
}

/** 页面索引摘要。 */
export interface PageIndexSummary {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  updatedAt: string;
  wordCount: number;
  blockCount: number;
}

/** ⌘K 页面跳转结果（标题/别名模糊匹配）。 */
export interface PageJumpResult {
  path: string;
  title: string;
  subtitle: string;
  match: 'title' | 'alias' | 'path';
}
