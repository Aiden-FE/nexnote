import type { ChatSession, ChatSummary, FileInfo } from '@nexnote/shared';
import { invoke } from '../../../lib/ipc';

/** 会话即页面 IPC 封装（DEV-012）。 */

export function listChats(): Promise<ChatSummary[]> {
  return invoke('chat:list');
}

export function getChat(path: string): Promise<ChatSession> {
  return invoke('chat:get', { path });
}

export function newChat(title?: string): Promise<ChatSession> {
  return invoke('chat:new', title ? { title } : {});
}

export function saveChat(session: ChatSession): Promise<FileInfo> {
  return invoke('chat:save', { session });
}

export function saveChatAsDocument(
  path: string,
  userAsQuote: boolean,
): Promise<{ path: string; name: string }> {
  return invoke('chat:saveAsDoc', { path, userAsQuote });
}

export function getChatFolder(): Promise<{ folder: string }> {
  return invoke('chat:folder:get');
}
