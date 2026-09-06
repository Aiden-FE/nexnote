/**
 * 三阶段渐进式召回（DEV-011）公共类型。
 * 主进程 SQLite 检索，渲染层只消费结果；来源标注用于召回透明 UI。
 */

export type RetrievalStageName = 'fts' | 'links' | 'vector';

export interface RetrievalStageStats {
  stage: RetrievalStageName;
  /** 该阶段产出/保留的候选块数。 */
  candidates: number;
  /** 该阶段耗时（毫秒）。 */
  elapsedMs: number;
  /** false = 被降级跳过（如 embedding 不可用时阶段三）。 */
  enabled: boolean;
  note?: string;
}

export interface RetrievalSource {
  /** vault 相对路径。 */
  path: string;
  title: string;
  /** Obsidian ^id 块锚（可跳转；无块锚为 null）。 */
  blockId: string | null;
  blockType: string;
  /** 块级摘要片段。 */
  snippet: string;
  /** 最终综合得分（越高越相关）。 */
  score: number;
  /** 向量相似度（-1..1，降级时为 null）。 */
  vectorSim: number | null;
  /** DEV-008 置信度（0..100；缺失为 null）。 */
  confidenceScore: number | null;
  /** 该来源主要由哪个阶段命中。 */
  via: RetrievalStageName;
}

export interface RetrievalOptions {
  query: string;
  /** 最终返回来源数（默认 8）。 */
  topK?: number;
  /** 阶段一 FTS 粗筛页面数（默认 20）。 */
  ftsLimit?: number;
  /** token/字符预算：打包 contextText 用（默认 4000 字符）。 */
  budgetChars?: number;
  /** 置信度乘性权重（默认 0.3）；置 0 关闭置信度影响。 */
  confidenceWeight?: number;
  /** 显式关闭向量重排（测试/调试）。 */
  disableVector?: boolean;
}

export interface RetrievalResponse {
  query: string;
  /** true = embedding 不可用，已降级为两阶段（FTS + 双链）。 */
  degraded: boolean;
  /** 实际使用的 embedding 模型（降级为 null）。 */
  model: string | null;
  /** 打包后的上下文正文（注入对话）。 */
  contextText: string;
  sources: RetrievalSource[];
  stages: RetrievalStageStats[];
}

/** 向量索引后台进度（状态栏/事件推送）。 */
export interface RetrievalIndexStatusPayload {
  phase: 'idle' | 'building' | 'ready' | 'error';
  mode: 'full' | 'incremental';
  blocksTotal: number;
  blocksDone: number;
  model: string | null;
  error?: string;
}
