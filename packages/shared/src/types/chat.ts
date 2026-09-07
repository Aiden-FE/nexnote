/**
 * AI 对话「会话即页面」公共类型（DEV-012）。
 * 每个会话持久化为 vault 内一个 .md 文件（frontmatter type: chat + 消息块）。
 */
import type { RetrievalStageName } from './retrieval';

export type ChatTurnRole = 'user' | 'assistant';

/** 单条参考来源（DEV-011 RetrievalSource 的可持久化子集）。 */
export interface ChatSourceRef {
  path: string;
  title: string;
  blockId: string | null;
  snippet: string;
  score: number;
  vectorSim: number | null;
  confidenceScore: number | null;
  via: RetrievalStageName;
}

/** 三阶段召回的单阶段统计（持久化用，结构与 RetrievalStageStats 对齐）。 */
export interface ChatStageStat {
  stage: RetrievalStageName;
  candidates: number;
  elapsedMs: number;
  enabled: boolean;
  note?: string;
}

/** 持久化在 AI 回答上的召回来源元数据（重开会话后仍可展示「参考来源」）。 */
export interface ChatTurnMeta {
  sources?: ChatSourceRef[];
  stages?: ChatStageStat[];
  /** true = embedding 不可用，回答时已降级为两阶段召回。 */
  degraded?: boolean;
  /** 实际使用的 embedding 模型（降级为 null）。 */
  retrievalModel?: string | null;
}

/** 会话中的一条消息。meta 仅 assistant 回答携带（召回来源）。 */
export interface ChatTurn {
  role: ChatTurnRole;
  content: string;
  meta?: ChatTurnMeta;
}

/** 会话 frontmatter 元数据。 */
export interface ChatSessionMeta {
  id: string;
  title: string;
  /** 对话 Profile id；null = 走 chat 功能默认指派。 */
  profileId?: string | null;
  model?: string | null;
  /** ISO-8601 创建时间。 */
  createdAt: string;
  /** ISO-8601 最近更新时间。 */
  updatedAt: string;
}

/** 一次完整对话会话 = vault 内一个 .md 文件。 */
export interface ChatSession {
  /** vault 相对 .md 路径。 */
  path: string;
  meta: ChatSessionMeta;
  turns: ChatTurn[];
}

/** 会话列表条目（dock 顶部历史切换用，不含消息正文）。 */
export interface ChatSummary {
  path: string;
  id: string;
  title: string;
  model: string | null;
  turnCount: number;
  updatedAt: string;
}

/** 会话存储目录配置。 */
export interface ChatFolderConfig {
  /** vault 相对目录（默认 `AI Chats`）。 */
  folder: string;
}
