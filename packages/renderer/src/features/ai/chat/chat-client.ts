import type { ChatSession, ChatSessionStatus, ChatSummary, FileInfo } from '@nexnote/shared';
import { invoke } from '../../../lib/ipc';

/** 会话内部 JSONL 存储 IPC 封装（ADR-0007）。 */

export function listChats(query?: string): Promise<ChatSummary[]> {
  return invoke('chat:list', query ? { query } : {});
}

export function getChat(
  path: string,
): Promise<ChatSession & { status?: ChatSessionStatus; error?: string }> {
  return invoke('chat:get', { path });
}

export function newChat(title?: string): Promise<ChatSession> {
  return invoke('chat:new', title ? { title } : {});
}

export function saveChat(
  session: ChatSession,
  status?: ChatSessionStatus,
  error?: string,
): Promise<FileInfo> {
  return invoke('chat:save', {
    session,
    ...(status ? { status } : {}),
    ...(error ? { error } : {}),
  });
}

export function saveChatAsDocument(
  path: string,
  userAsQuote: boolean,
): Promise<{ path: string; name: string }> {
  return invoke('chat:saveAsDoc', { path, userAsQuote });
}
