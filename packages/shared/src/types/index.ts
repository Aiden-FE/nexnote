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
  /** 围绕原始 wikilink 的上下文片段（按 source block + source_text 定位）。 */
  snippet: string;
  /** 链接所在的源块 id（Obsidian ^id），可用于编辑器跳转。 */
  blockId: string | null;
  /** 链接所在的源块在源页中的序号（0-based）。 */
  blockPosition: number;
  /** 源页中触发反链的原始 wikilink 字符串，如 `[[Target|显示]]`。 */
  sourceText: string;
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
  /** 该精确 tag 的页面数（叶节点）。 */
  pageCount: number;
  /** 包含此 tag 或其后代 tag 的页面数（中间节点 = 子树页面数；叶节点 = pageCount）。 */
  descendantPageCount: number;
  path: string[];
  isIntermediate?: boolean;
}

/** 页面索引摘要。 */
export interface PageIndexSummary {
  pageId: number;
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  updatedAt: string;
  wordCount: number;
  blockCount: number;
  /** 入链：指向本页的其他页面数（去重源页）。 */
  inboundLinks: number;
  /** 出链：本页指向已解析笔记的目标数（去重目标页；红链不计）。 */
  outboundLinks: number;
}

/** ⌘K 页面跳转结果（标题/别名模糊匹配）。 */
export interface PageJumpResult {
  path: string;
  title: string;
  subtitle: string;
  match: 'title' | 'alias' | 'path';
}

/** 知识图谱页面节点（DEV-006）。 */
export interface GraphPage {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  inboundLinks: number;
  outboundLinks: number;
}

/** 去重后的有向页面边；全局图谱渲染时按无向弹簧处理。 */
export interface GraphLink {
  source: string;
  target: string;
}

/** Link Index 导出的图谱快照。 */
export interface GraphSnapshot {
  pages: GraphPage[];
  links: GraphLink[];
}

/** DEV-008 置信度因子键。 */
export type ConfidenceFactorKey =
  | 'stability'
  | 'review_count'
  | 'author_count'
  | 'age'
  | 'link_authority'
  | 'manual_boost';

/** 单个置信度因子的归一化分数与最终贡献。 */
export interface ConfidenceFactor {
  key: ConfidenceFactorKey;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
}

/** Link Index 缓存的置信度结果。 */
export interface ConfidenceResult {
  pageId: number;
  path: string;
  score: number;
  factors: ConfidenceFactor[];
  computedAt: string;
}
