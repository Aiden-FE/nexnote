import { createHash, randomUUID } from 'node:crypto';
import { sanitizeEntryName, type FileInfo } from '@nexnote/shared';
import type { ChatSession, ChatSummary, ChatTurn } from '@nexnote/shared';
import { FsError, type VaultFsService } from '../fs/fs-service';
import { defaultNoteMetadata } from '../fs/page-ops';
import { MetadataStore } from '../document/metadata-store';
import { parseChatJsonl, serializeChatRecord, type ParsedChatSession } from './chat-format';

/** 会话内部存储目录（vault 相对，ADR-0007）。 */
export const SESSION_DIR = '.nexnote/sessions';
/** 会话文件名模式：sha256(sessionId).txt（hash 由 id 派生且终生不变）。 */
const SESSION_FILE_RE = /^\.nexnote\/sessions\/[a-f0-9]{64}\.txt$/;

/**
 * AI 会话内部存储服务（ADR-0007）。
 * 会话以 JSONL 存于 `.nexnote/sessions/{hash}.txt`：不进入文档树、索引、反链与双链；
 * 「导出为页面」是会话进入页面体系的唯一路径。
 */
export class ChatService {
  constructor(
    private readonly fs: VaultFsService,
    private readonly getRoot: () => string | null,
  ) {}

  private root(): string {
    const root = this.getRoot();
    if (!root) throw new FsError('尚未打开任何知识库', 'NO_VAULT');
    return root;
  }

  /** 会话 id → 不变的 hash 文件名（重命名不改名）。 */
  sessionPathFor(id: string): string {
    return `${SESSION_DIR}/${createHash('sha256').update(id).digest('hex')}.txt`;
  }

  private assertSessionPath(relPath: string): void {
    if (!SESSION_FILE_RE.test(relPath)) {
      throw new FsError(`会话必须位于 ${SESSION_DIR}/ 内: ${relPath}`, 'INVALID_SESSION_PATH');
    }
  }

  /** 枚举 sessions 目录（按更新时间倒序）；query 非空时按标题子串过滤。 */
  async listChats(query?: string): Promise<ChatSummary[]> {
    let entries;
    try {
      entries = await this.fs.listDir(SESSION_DIR);
    } catch (e) {
      if ((e as FsError).code === 'READ_DIR_FAILED') return [];
      throw e;
    }
    const needle = query?.trim().toLocaleLowerCase() ?? '';
    const summaries: ChatSummary[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.txt')) continue;
      const rel = `${SESSION_DIR}/${entry.name}`;
      if (!SESSION_FILE_RE.test(rel)) continue;
      let session: ParsedChatSession | null;
      try {
        session = parseChatJsonl(rel, await this.fs.readTextFile(rel));
      } catch {
        continue;
      }
      if (!session) continue;
      if (needle && !session.meta.title.toLocaleLowerCase().includes(needle)) continue;
      summaries.push({
        path: rel,
        id: session.meta.id,
        title: session.meta.title,
        model: session.meta.model ?? null,
        turnCount: session.turns.length,
        updatedAt: session.meta.updatedAt,
        status: session.status,
      });
    }
    const titleCollator = new Intl.Collator('zh-CN');
    return summaries.sort((a, b) => {
      const updated = b.updatedAt.localeCompare(a.updatedAt);
      return updated !== 0 ? updated : titleCollator.compare(b.title, a.title);
    });
  }

  /** 读取单个会话（含未完成状态标记）；路径越权/损坏时抛错。 */
  async getChat(relPath: string): Promise<ParsedChatSession> {
    this.assertSessionPath(relPath);
    const session = parseChatJsonl(relPath, await this.fs.readTextFile(relPath));
    if (!session) throw new FsError(`不是有效的会话文件: ${relPath}`, 'NOT_A_CHAT');
    return session;
  }

  /** 分配新会话（id + 不变 hash 路径），不落盘；首条消息后由 saveChat 写入。 */
  async newChat(titleInput?: string): Promise<ChatSession> {
    const now = new Date().toISOString();
    const title = titleInput?.trim() || '新对话';
    const id = randomUUID();
    return {
      path: this.sessionPathFor(id),
      meta: {
        id,
        title,
        profileId: null,
        model: null,
        permissionMode: 'conversation',
        createdAt: now,
        updatedAt: now,
      },
      turns: [],
    };
  }

  /** 写入会话快照（JSONL）；path 必须与 id 派生的 hash 路径一致。 */
  async saveChat(
    session: ChatSession,
    status?: ParsedChatSession['status'],
    error?: string,
  ): Promise<FileInfo> {
    if (session.meta.id.trim() === '') throw new FsError('会话缺少 id', 'INVALID_CHAT');
    this.assertSessionPath(session.path);
    if (this.sessionPathFor(session.meta.id) !== session.path) {
      throw new FsError(`会话路径与 id 不匹配: ${session.path}`, 'SESSION_PATH_MISMATCH');
    }
    return this.fs.appendTextFile(session.path, serializeChatRecord(session, status, error), true);
  }

  /**
   * 导出为页面：AI 回答 → 正文块；用户消息 → 引用块（默认）或 HTML 注释。
   * 产物是普通文档（vault 根下唯一文件名），与会话脱钩；原会话保留。
   */
  async saveAsDocument(relPath: string, userAsQuote = true): Promise<FileInfo> {
    const session = await this.getChat(relPath);
    const title = session.meta.title || '对话笔记';
    const body = this.renderDocumentBody(session.turns, userAsQuote);
    const fileName = await this.uniqueRootName(title);
    const target = `${fileName}.md`;
    const content = `# ${title}\n\n${body}\n`;
    const info = await this.fs.writeTextFile(target, content, true);
    await new MetadataStore(this.root()).write(target, defaultNoteMetadata('native-block'));
    return info;
  }

  private async uniqueRootName(title: string): Promise<string> {
    const sanitized = sanitizeEntryName(title.replace(/\.md$/i, ''));
    const base = sanitized.ok ? sanitized.value : '对话笔记';
    if (!(await this.fs.exists(`${base}.md`))) return base;
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${base} ${i}`;
      if (!(await this.fs.exists(`${candidate}.md`))) return candidate;
    }
    throw new FsError('无法生成不冲突的文档文件名', 'NAME_CONFLICT');
  }

  private renderDocumentBody(turns: ChatTurn[], userAsQuote: boolean): string {
    const blocks: string[] = [];
    for (const turn of turns) {
      const content = turn.content.trim();
      if (!content) continue;
      if (turn.role === 'assistant') {
        blocks.push(content);
      } else if (userAsQuote) {
        blocks.push(['> 提问：', ...content.split('\n').map((line) => `> ${line}`)].join('\n'));
      } else {
        blocks.push(`<!-- 用户提问\n${content}\n-->`);
      }
    }
    return blocks.join('\n\n');
  }
}
