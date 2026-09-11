import type { ChatMessage, ChatSession, ChatTurn, ChatTurnMeta } from '@nexnote/shared';
import { invoke, onEvent } from '../../../lib/ipc';
import { getSelectedSkillIds } from '../../skills/chat-skill-store';
import { useChatStore } from './chat-store';
import * as client from './chat-client';

let working: ChatSession | null = null;
let draft = false;
let runId: string | null = null;
let pendingMeta: ChatTurnMeta | null = null;
let subscribed = false;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sync(): void {
  if (working) useChatStore.getState().setActive(clone(working), draft);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function persist(session: ChatSession): Promise<void> {
  session.meta.updatedAt = new Date().toISOString();
  try {
    await client.saveChat(session);
    draft = false;
    sync();
    await refreshSummaries();
  } catch (e) {
    useChatStore.getState().setError(`会话自动保存失败：${errorMessage(e)}`);
  }
}

function finalizeStream(_attachMeta: boolean): void {
  runId = null;
  useChatStore.getState().setStreaming(false);
  if (working) {
    const assistant = working.turns[working.turns.length - 1];
    if (assistant?.role === 'assistant' && pendingMeta) assistant.meta = pendingMeta;
    pendingMeta = null;
    void persist(working);
  }
}

/** 订阅统一流事件（幂等，模块加载一次）。 */
export function initChatRuntime(): void {
  if (subscribed) return;
  subscribed = true;
  onEvent('agent:runEvent', ({ runId: sid, event }) => {
    if (sid !== runId || !working) return;
    const assistant = working.turns[working.turns.length - 1];
    if (!assistant || assistant.role !== 'assistant') return;
    if (event.type === 'context') {
      pendingMeta = {
        sources: event.sources as ChatTurnMeta['sources'],
        degraded: event.degraded,
        retrievalModel: event.retrievalModel ?? null,
      };
    } else if (event.type === 'start') {
      useChatStore.getState().setModelLabel(event.model);
      working.meta.model = event.model;
    } else if (event.type === 'delta') {
      assistant.content += event.text;
      sync();
    } else if (event.type === 'done') {
      finalizeStream(true);
    } else if (event.type === 'error') {
      useChatStore.getState().setError(`${event.message}${event.code ? `（${event.code}）` : ''}`);
      finalizeStream(true);
    }
  });
}

async function cancelActiveStream(): Promise<void> {
  const id = runId;
  runId = null;
  if (id) await invoke('agent:cancel', { runId: id }).catch(() => undefined);
  useChatStore.getState().setStreaming(false);
}

export async function refreshSummaries(): Promise<void> {
  try {
    useChatStore.getState().setSummaries(await client.listChats());
  } catch {
    // vault 未就绪等场景静默
  }
}

export async function refreshFolder(): Promise<void> {
  try {
    useChatStore.getState().setFolder((await client.getChatFolder()).folder);
  } catch {
    // 忽略
  }
}

export async function startNewSession(): Promise<void> {
  await cancelActiveStream();
  working = await client.newChat();
  draft = true;
  useChatStore.getState().setError(null);
  useChatStore.getState().setModelLabel(null);
  sync();
}

export async function openSession(path: string): Promise<void> {
  await cancelActiveStream();
  working = await client.getChat(path);
  draft = false;
  useChatStore.getState().setError(null);
  useChatStore.getState().setModelLabel(working.meta.model ?? null);
  sync();
}

/** 按标题匹配历史会话（双链 [[会话标题]] 打开 dock 用）。命中返回 true。 */
export function openChatByTitle(title: string): boolean {
  const target = title.trim();
  if (!target) return false;
  const match = useChatStore
    .getState()
    .summaries.find((s) => s.title === target || s.title.replace(/\.md$/i, '') === target);
  if (!match) return false;
  void openSession(match.path);
  return true;
}

/** 双链 [[会话标题]]：确保会话列表最新后按标题匹配；命中打开会话并返回 true。 */
export async function openChatWikilinkOrNull(pageName: string): Promise<boolean> {
  const name = pageName.trim();
  if (!name) return false;
  await refreshSummaries();
  return openChatByTitle(name);
}

export function stopStream(): void {
  void cancelActiveStream().then(() => {
    if (working) {
      const assistant = working.turns[working.turns.length - 1];
      if (assistant?.role === 'assistant' && pendingMeta) assistant.meta = pendingMeta;
      pendingMeta = null;
      void persist(working);
    }
  });
}

/** 发送一条用户消息并流式获取回答（含上下文注入与召回来源）。 */
export async function sendMessage(rawText: string): Promise<void> {
  const store = useChatStore.getState();
  const content = rawText.trim();
  if (!content || store.streaming) return;

  store.setError(null);
  if (!working) {
    working = await client.newChat();
    draft = true;
  }
  const session = working;
  if (session.turns.length === 0) {
    session.meta.title = content.slice(0, 24) || '新对话';
  }
  session.meta.updatedAt = new Date().toISOString();
  session.turns.push({ role: 'user', content });
  session.turns.push({ role: 'assistant', content: '' });
  sync();
  store.setStreaming(true);

  // 自动保存：用户消息落盘（重启可续聊）。
  await persist(session);

  // 上下文正文与 skill 选择透传给主进程；主进程负责 Skill 验证、召回和 prompt 组装。
  const contextText = useChatStore
    .getState()
    .chips.map((chip) => chip.text)
    .filter(Boolean)
    .join('\n\n');
  const prior = session.turns.slice(0, session.turns.length - 2);
  const messages: ChatMessage[] = [];
  for (const turn of prior) messages.push({ role: turn.role, content: turn.content });
  messages.push({ role: 'user', content });

  try {
    const { runId: sid } = await invoke('agent:run:chat', {
      messages,
      skillIds: getSelectedSkillIds(),
      contextText,
    });
    runId = sid;
  } catch (e) {
    runId = null;
    useChatStore.getState().setStreaming(false);
    useChatStore.getState().setError(errorMessage(e));
    if (working) await persist(working);
  }
}

/** 会话转普通文档并在当前 tab 打开；返回新文档路径。 */
export async function saveActiveAsDocument(userAsQuote: boolean): Promise<string | null> {
  if (!working) return null;
  await persist(working);
  const info = await client.saveChatAsDocument(working.path, userAsQuote);
  await refreshSummaries();
  return info.path;
}

/** 取最后一条 assistant 回答正文（插入编辑器用）。 */
export function lastAssistantContent(): string | null {
  if (!working) return null;
  for (let i = working.turns.length - 1; i >= 0; i -= 1) {
    const turn: ChatTurn = working.turns[i]!;
    if (turn.role === 'assistant' && turn.content.trim()) return turn.content;
  }
  return null;
}
