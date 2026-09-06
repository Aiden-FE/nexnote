import type { Result } from '../result';
import type { FileInfo } from './fs';
import type { ChatFolderConfig, ChatSession, ChatSummary } from '../../types/chat';

/**
 * chat:* 命名空间（DEV-012 会话即页面）。
 * 会话持久化为 vault 内 .md（frontmatter type: chat）；渲染层不直接触碰 fs。
 */
export const CHAT_CHANNELS = [
  'chat:list',
  'chat:get',
  'chat:new',
  'chat:save',
  'chat:saveAsDoc',
  'chat:folder:get',
  'chat:folder:set',
] as const;

export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export interface ChatChannelMap {
  /** 列出会话存储目录下全部 type: chat 会话（按更新时间倒序）。 */
  'chat:list': {
    request: void;
    response: Result<ChatSummary[]>;
  };
  /** 读取单个会话全文（含消息与召回来源）。 */
  'chat:get': {
    request: { path: string };
    response: Result<ChatSession>;
  };
  /**
   * 分配一个新会话（id + 唯一路径），不落盘；
   * 首条消息后由 chat:save 写入（避免空文件）。
   */
  'chat:new': {
    request: { title?: string };
    response: Result<ChatSession>;
  };
  /**  upsert 会话（自动保存：每条消息后调用）。路径必须位于会话存储目录内。 */
  'chat:save': {
    request: { session: ChatSession };
    response: Result<FileInfo>;
  };
  /** 会话转普通文档：AI 回答转正文，用户消息转引用/注释；返回新文档信息。原会话保留。 */
  'chat:saveAsDoc': {
    request: { path: string; userAsQuote?: boolean };
    response: Result<FileInfo>;
  };
  /** 读取会话存储目录配置。 */
  'chat:folder:get': {
    request: void;
    response: Result<ChatFolderConfig>;
  };
  /** 设置会话存储目录（仅影响后续新会话；不迁移已有会话）。 */
  'chat:folder:set': {
    request: { folder: string };
    response: Result<ChatFolderConfig>;
  };
}
