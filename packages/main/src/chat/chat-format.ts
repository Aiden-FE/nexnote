/**
 * 会话即页面序列化格式（DEV-012）。
 *
 * 会话 = vault 内一个 .md：
 *   frontmatter（type: chat + 元数据）+ 逐条消息块。
 * 消息边界用单行 HTML 注释标记（块属性概念的文本载体），便于 diff/人工编辑；
 * 会话默认只由对话 dock 读写（不在块编辑器中打开），因此该格式不经过
 * ProseMirror Markdown 双向管道，主进程可直接读写原文。
 *
 *   ---
 *   type: chat
 *   id: <uuid>
 *   title: "..."
 *   createdAt: <iso>
 *   updatedAt: <iso>
 *   ---
 *   <!-- nexnote-chat-role=user -->
 *   你好
 *
 *   <!-- nexnote-chat-role=assistant -->
 *   你好！……
 *   <!-- nexnote-chat-meta=<base64url JSON> -->
 *
 * meta 行为 base64url(JSON)（UTF-8），规避定界/转义问题；解码失败按无来源处理。
 */
import type {
  ChatSession,
  ChatSessionMeta,
  ChatTurn,
  ChatTurnMeta,
} from '@nexnote/shared';

const ROLE_MARKER = /^<!--\s*nexnote-chat-role=(user|assistant)\s*-->\s*$/;
const META_MARKER = /^<!--\s*nexnote-chat-meta=(\S+)\s*-->\s*$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function unquoteYamlScalar(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function quoteYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function encodeMeta(meta: ChatTurnMeta): string {
  return Buffer.from(JSON.stringify(meta), 'utf8').toString('base64url');
}

function decodeMeta(raw: string): ChatTurnMeta | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as ChatTurnMeta;
    return null;
  } catch {
    return null;
  }
}

export interface ParsedChatMeta {
  type: string | null;
  id: string | null;
  title: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  profileId: string | null;
  model: string | null;
}

function parseScalar(frontmatter: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.*)$`, 'm');
  const match = re.exec(frontmatter);
  if (!match) return null;
  const value = match[1]!.trim();
  return value.length > 0 ? value : null;
}

/** 解析会话 frontmatter 标量字段（宽松解析：缺失/损坏按 null 处理）。 */
export function parseChatFrontmatter(text: string): ParsedChatMeta {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    return { type: null, id: null, title: null, createdAt: null, updatedAt: null, profileId: null, model: null };
  }
  const fm = match[1]!;
  const titleRaw = parseScalar(fm, 'title');
  return {
    type: parseScalar(fm, 'type'),
    id: parseScalar(fm, 'id'),
    title: titleRaw ? unquoteYamlScalar(titleRaw) : null,
    createdAt: parseScalar(fm, 'createdAt'),
    updatedAt: parseScalar(fm, 'updatedAt'),
    profileId: parseScalar(fm, 'profileId'),
    model: parseScalar(fm, 'model'),
  };
}

/** 序列化会话 frontmatter 段。 */
export function serializeChatFrontmatter(meta: ChatSessionMeta): string {
  const lines = [
    '---',
    'type: chat',
    `id: ${meta.id}`,
    `title: ${quoteYamlScalar(meta.title)}`,
    `createdAt: ${meta.createdAt}`,
    `updatedAt: ${meta.updatedAt}`,
  ];
  if (meta.profileId) lines.push(`profileId: ${meta.profileId}`);
  if (meta.model) lines.push(`model: ${meta.model}`);
  lines.push('---', '');
  return `${lines.join('\n')}\n`;
}

/** 解析整份会话文件 → ChatSession；非会话/损坏（无 type: chat 或无 id）返回 null。 */
export function parseChatFile(path: string, text: string): ChatSession | null {
  const parsed = parseChatFrontmatter(text);
  if (parsed.type !== 'chat' || !parsed.id) return null;

  const fmMatch = FRONTMATTER_RE.exec(text);
  const body = fmMatch ? text.slice(fmMatch[0].length) : text;

  const turns: ChatTurn[] = [];
  let buffer: string[] | null = null;
  let currentRole: ChatTurn['role'] | null = null;
  let pendingMeta: ChatTurnMeta | null = null;

  const flush = (): void => {
    if (currentRole === null || buffer === null) return;
    const content = buffer.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    const turn: ChatTurn = { role: currentRole, content };
    if (pendingMeta) turn.meta = pendingMeta;
    turns.push(turn);
    buffer = null;
    currentRole = null;
    pendingMeta = null;
  };

  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const roleMatch = ROLE_MARKER.exec(line);
    if (roleMatch) {
      flush();
      currentRole = roleMatch[1] as ChatTurn['role'];
      buffer = [];
      continue;
    }
    const metaMatch = META_MARKER.exec(line);
    if (metaMatch) {
      // meta 标记紧随其所属 assistant 消息正文；该消息此刻仍在 buffer 中。
      if (buffer !== null) pendingMeta = decodeMeta(metaMatch[1]!);
      continue;
    }
    if (buffer === null) continue; // 消息标记之外的散文：宽松忽略
    buffer.push(line);
  }
  flush();

  // 去掉末尾空消息（容错）。
  while (turns.length > 0) {
    const last = turns[turns.length - 1]!;
    if (last.content.trim() === '' && !last.meta) turns.pop();
    else break;
  }

  return {
    path,
    meta: {
      id: parsed.id,
      title: parsed.title ?? '未命名会话',
      profileId: parsed.profileId,
      model: parsed.model,
      createdAt: parsed.createdAt ?? new Date(0).toISOString(),
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    },
    turns,
  };
}

/** 序列化整份会话文件（完整文件内容，供原子写入）。 */
export function serializeChatFile(session: ChatSession): string {
  const blocks: string[] = [serializeChatFrontmatter(session.meta).replace(/\n+$/, '')];
  for (const turn of session.turns) {
    blocks.push(`<!-- nexnote-chat-role=${turn.role} -->`);
    blocks.push(turn.content);
    if (turn.role === 'assistant' && turn.meta) {
      blocks.push(`<!-- nexnote-chat-meta=${encodeMeta(turn.meta)} -->`);
    }
  }
  return `${blocks.join('\n\n')}\n`;
}
