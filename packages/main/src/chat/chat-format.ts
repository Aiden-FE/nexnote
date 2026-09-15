/**
 * AI 会话内部 JSONL 序列化（ADR-0007）。
 *
 * 会话文件 = `.nexnote/sessions/{sha256(sessionId)}.txt`，内容为逐行 JSON：
 *   {"type":"snapshot","session":{meta,turns},"status":"complete"}
 *
 * 本项目无存量用户，不做旧「会话即页面」格式迁移；解析失败（截断/损坏行）按无记录处理。
 * 重命名只改 meta.title，hash 文件名保持不变；续聊追加快照行（末行即最新状态）。
 */
import type { ChatSession, ChatSessionMeta, ChatSessionStatus, ChatTurn } from '@nexnote/shared';

/** 单行 JSONL 记录。 */
export interface ChatJsonlRecord {
  type: 'snapshot';
  /** 会话主体（path 由文件位置派生，不写入记录）。 */
  session: { meta: ChatSessionMeta; turns: ChatTurn[] };
  /** 末次持久化状态：流式未完成/取消/失败在文件中可见。 */
  status: ChatSessionStatus;
  /** status = failed 时的错误摘要。 */
  error?: string;
}

/** 读回的会话快照（含未完成状态标记）。 */
export interface ParsedChatSession extends ChatSession {
  status: ChatSessionStatus;
  error?: string;
}

/** 序列化整份会话为单行 JSONL 快照。 */
export function serializeChatRecord(
  session: ChatSession,
  status: ChatSessionStatus = 'complete',
  error?: string,
): string {
  const record: ChatJsonlRecord = {
    type: 'snapshot',
    session: { meta: session.meta, turns: session.turns },
    status,
    ...(error ? { error } : {}),
  };
  return `${JSON.stringify(record)}\n`;
}

/** 解析 JSONL 会话文件；损坏行忽略，取最后一条有效快照（无则 null）。 */
export function parseChatJsonl(path: string, text: string): ParsedChatSession | null {
  let latest: ChatJsonlRecord | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<ChatJsonlRecord>;
      if (parsed?.type === 'snapshot' && parsed.session?.meta?.id)
        latest = parsed as ChatJsonlRecord;
    } catch {
      // 截断/损坏行：跳过，保留此前解析到的快照
    }
  }
  if (!latest) return null;
  return {
    path,
    meta: latest.session.meta,
    turns: latest.session.turns,
    status: latest.status ?? 'complete',
    ...(latest.error ? { error: latest.error } : {}),
  };
}
