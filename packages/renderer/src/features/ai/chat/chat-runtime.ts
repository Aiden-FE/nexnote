import type {
  ChatMessage,
  ChatPermissionMode,
  ChatSession,
  ChatSessionStatus,
  ChatTurn,
  ChatTurnMeta,
} from '@nexnote/shared';
import { invoke, onEvent } from '../../../lib/ipc';
import { getSelectedSkillIds } from '../../skills/chat-skill-store';
import { useChatStore } from './chat-store';
import { activePageRef } from './chat-context-bridge';
import * as client from './chat-client';

let working: ChatSession | null = null;
let draft = false;
let runId: string | null = null;
let pendingMeta: ChatTurnMeta | null = null;
/** 当前会话末次持久化状态（重启后从 JSONL 读回，用于未完成提示与续聊）。 */
let status: ChatSessionStatus = 'complete';
let lastError: string | undefined;
let subscribed = false;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sync(): void {
  if (working) {
    useChatStore.getState().setPermissionMode(working.meta.permissionMode ?? 'conversation');
    useChatStore.getState().setActive(clone(working), draft, status);
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 持久化会话（追加/重写 JSONL 快照）；状态标记随写入一并落盘。 */
async function persist(
  session: ChatSession,
  nextStatus: ChatSessionStatus = status,
  error?: string,
): Promise<void> {
  session.meta.updatedAt = new Date().toISOString();
  status = nextStatus;
  lastError = nextStatus === 'failed' ? error : undefined;
  try {
    await client.saveChat(session, nextStatus, error);
    draft = false;
    sync();
    await searchSessions();
  } catch (e) {
    useChatStore.getState().setError(`会话自动保存失败：${errorMessage(e)}`);
  }
}

function finalizeStream(nextStatus: ChatSessionStatus, error?: string): void {
  runId = null;
  useChatStore.getState().setStreaming(false);
  if (working) {
    const assistant = working.turns[working.turns.length - 1];
    if (assistant?.role === 'assistant' && pendingMeta) assistant.meta = pendingMeta;
    pendingMeta = null;
    void persist(working, nextStatus, error);
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
      finalizeStream('complete');
    } else if (event.type === 'error') {
      const message = `${event.message}${event.code ? `（${event.code}）` : ''}`;
      useChatStore.getState().setError(message);
      finalizeStream('failed', message);
    }
  });
}

async function cancelActiveStream(): Promise<void> {
  const id = runId;
  runId = null;
  if (id) await invoke('agent:cancel', { runId: id }).catch(() => undefined);
  useChatStore.getState().setStreaming(false);
}

/** 刷新历史列表；传入 query 时由主进程按标题过滤。 */
export async function searchSessions(query?: string): Promise<void> {
  try {
    useChatStore.getState().setSummaries(await client.listChats(query));
  } catch {
    // vault 未就绪等场景静默
  }
}

export async function startNewSession(): Promise<void> {
  await cancelActiveStream();
  working = await client.newChat();
  draft = true;
  status = 'complete';
  lastError = undefined;
  useChatStore.getState().setError(null);
  useChatStore.getState().setModelLabel(null);
  sync();
}

/** 打开历史会话续聊；读回其未完成/失败状态标记。 */
export async function openSession(path: string): Promise<void> {
  await cancelActiveStream();
  const session = await client.getChat(path);
  working = session;
  draft = false;
  status = session.status ?? 'complete';
  lastError = session.error;
  useChatStore
    .getState()
    .setError(status === 'failed' && session.error ? `上次回复失败：${session.error}` : null);
  useChatStore.getState().setModelLabel(working.meta.model ?? null);
  sync();
}

export function stopStream(): void {
  void cancelActiveStream().then(() => {
    if (!working) return;
    const assistant = working.turns[working.turns.length - 1];
    if (assistant?.role === 'assistant' && pendingMeta) assistant.meta = pendingMeta;
    pendingMeta = null;
    void persist(working, 'cancelled');
  });
}

/** 修改当前会话权限并立即追加 JSONL 快照；仅影响后续 Agent 操作。 */
export async function setPermissionMode(mode: ChatPermissionMode): Promise<void> {
  if (!working) return;
  working.meta.permissionMode = mode;
  useChatStore.getState().setPermissionMode(mode);
  await persist(working, status);
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

  // 自动保存：用户消息与「streaming」未完成标记落盘（重启可续聊，并可见未完成状态）。
  await persist(session, 'streaming');

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
      permissionMode: session.meta.permissionMode ?? 'conversation',
      contextPaths: activePageRef()?.path ? [activePageRef()!.path] : [],
    });
    runId = sid;
  } catch (e) {
    runId = null;
    useChatStore.getState().setStreaming(false);
    useChatStore.getState().setError(errorMessage(e));
    if (working) await persist(working, 'failed', errorMessage(e));
  }
}

/** 将会话导出为普通页面并在当前 tab 打开；返回新文档路径。 */
export async function saveActiveAsDocument(userAsQuote: boolean): Promise<string | null> {
  if (!working) return null;
  await persist(working, status === 'streaming' ? 'cancelled' : status, lastError);
  const info = await client.saveChatAsDocument(working.path, userAsQuote);
  await searchSessions();
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
