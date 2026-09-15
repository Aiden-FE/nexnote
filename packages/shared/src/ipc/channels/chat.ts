import type { Result } from '../result';
import type { FileInfo } from './fs';
import type { ChatSession, ChatSessionStatus, ChatSummary } from '../../types/chat';

/**
 * chat:* 命名空间（ADR-0007 会话内部 JSONL 存储）。
 * 会话存于 `.nexnote/sessions/{hash}.txt`（JSONL），不在文档树/索引/双链内；渲染层不直接触碰 fs。
 */
export const CHAT_CHANNELS = [
  'chat:list',
  'chat:get',
  'chat:new',
  'chat:save',
  'chat:saveAsDoc',
] as const;

export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export interface ChatChannelMap {
  /** 枚举内部会话（按更新时间倒序）；query 非空时按标题过滤。 */
  'chat:list': {
    request: { query?: string };
    response: Result<ChatSummary[]>;
  };
  /** 读取单个会话全文（含消息、召回来源与未完成状态标记）。 */
  'chat:get': {
    request: { path: string };
    response: Result<ChatSession & { status?: ChatSessionStatus; error?: string }>;
  };
  /**
   * 分配一个新会话（id + 不变 hash 路径），不落盘；
   * 首条消息后由 chat:save 写入（避免空文件）。
   */
  'chat:new': {
    request: { title?: string };
    response: Result<ChatSession>;
  };
  /**
   * 写入会话快照（自动保存：每条消息后调用）。
   * path 必须是 id 派生的 hash 路径；status 标记流式未完成/取消/失败。
   */
  'chat:save': {
    request: { session: ChatSession; status?: ChatSessionStatus; error?: string };
    response: Result<FileInfo>;
  };
  /** 将会话导出为普通页面（AI 回答转正文，用户消息转引用/注释）；返回新文档信息。原会话保留。 */
  'chat:saveAsDoc': {
    request: { path: string; userAsQuote?: boolean };
    response: Result<FileInfo>;
  };
}
