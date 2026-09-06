import { randomUUID } from 'node:crypto';
import { sanitizeEntryName, type FileInfo } from '@nexnote/shared';
import type { ChatSession, ChatSummary, ChatTurn } from '@nexnote/shared';
import { FsError, type VaultFsService } from '../fs/fs-service';
import { defaultNoteFrontmatter } from '../fs/page-ops';
import { parseChatFile, serializeChatFile } from './chat-format';
import { readVaultConfig, sanitizeChatFolder, writeVaultConfig } from '../vault/vault-manager';

export const DEFAULT_CHAT_FOLDER = 'AI Chats';

/**
 * 会话即页面存储服务（DEV-012）。
 * 会话持久化为 vault 内 `<chatFolder>/<name>.md`（frontmatter type: chat）。
 * 放在普通目录（默认 `AI Chats/`）而非 .nexnote/，使会话可被双链引用与语义索引。
 */
export class ChatService {
  constructor(
    private readonly fs: VaultFsService,
    private readonly getRoot: () => string | null,
  ) {}

  private root(): string {
    const root = this.getRoot();
    if (!root) throw new FsError('尚未打开任何 vault', 'NO_VAULT');
    return root;
  }

  /** 当前会话存储目录（vault 相对；配置损坏/缺失回退默认）。 */
  async folder(): Promise<string> {
    const config = await readVaultConfig(this.root());
    return sanitizeChatFolder(config.chatFolder) ?? DEFAULT_CHAT_FOLDER;
  }

  async getFolderConfig(): Promise<{ folder: string }> {
    return { folder: await this.folder() };
  }

  /** 设置会话存储目录（仅影响后续新会话；不迁移已有会话）。 */
  async setFolder(raw: string): Promise<{ folder: string }> {
    const folder = sanitizeChatFolder(raw);
    if (!folder) throw new FsError('会话目录名不合法', 'INVALID_NAME');
    const root = this.root();
    const config = await readVaultConfig(root);
    await writeVaultConfig(root, { ...config, chatFolder: folder });
    return { folder };
  }

  /** 列出会话目录下全部 type: chat 会话（按更新时间倒序）。 */
  async listChats(): Promise<ChatSummary[]> {
    const folder = await this.folder();
    let entries;
    try {
      entries = await this.fs.listDir(folder);
    } catch (e) {
      if ((e as FsError).code === 'READ_DIR_FAILED' || (e as NodeJS.ErrnoException)?.code === 'NO_VAULT') {
        return [];
      }
      throw e;
    }
    const summaries: ChatSummary[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.md')) continue;
      const rel = `${folder}/${entry.name}`;
      let text: string;
      try {
        text = await this.fs.readTextFile(rel);
      } catch {
        continue;
      }
      const session = parseChatFile(rel, text);
      if (!session) continue;
      summaries.push({
        path: session.path,
        id: session.meta.id,
        title: session.meta.title,
        model: session.meta.model ?? null,
        turnCount: session.turns.length,
        updatedAt: session.meta.updatedAt,
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** 读取单个会话；非会话文件/损坏时抛错。 */
  async getChat(relPath: string): Promise<ChatSession> {
    const text = await this.fs.readTextFile(relPath);
    const session = parseChatFile(relPath, text);
    if (!session) throw new FsError(`不是有效的会话文件: ${relPath}`, 'NOT_A_CHAT');
    return session;
  }

  /** 分配新会话（id + 唯一路径），不落盘；首条消息后由 saveChat 写入。 */
  async newChat(titleInput?: string): Promise<ChatSession> {
    const folder = await this.folder();
    const now = new Date().toISOString();
    const baseTitle = (titleInput ?? '').trim() || '新对话';
    const fileName = await this.uniqueName(folder, baseTitle);
    return {
      path: `${folder}/${fileName}.md`,
      meta: {
        id: randomUUID(),
        title: baseTitle === '新对话' ? '新对话' : titleInput!.trim(),
        profileId: null,
        model: null,
        createdAt: now,
        updatedAt: now,
      },
      turns: [],
    };
  }

  /** 生成目录内不冲突的文件名（无后缀）：名、名 2、名 3… */
  private async uniqueName(folder: string, title: string): Promise<string> {
    const sanitized = sanitizeEntryName(title.replace(/\.md$/i, ''));
    const base = sanitized.ok ? sanitized.value : '新对话';
    const exists = async (name: string): Promise<boolean> =>
      this.fs.exists(`${folder}/${name}.md`);
    if (!(await exists(base))) return base;
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${base} ${i}`;
      if (!(await exists(candidate))) return candidate;
    }
    throw new FsError('无法生成不冲突的会话文件名', 'NAME_CONFLICT');
  }

  /** 持久化会话（自动保存）。路径必须位于会话存储目录内，防止越权写任意文件。 */
  async saveChat(session: ChatSession): Promise<FileInfo> {
    const folder = await this.folder();
    this.assertInFolder(session.path, folder);
    if (session.meta.id.trim() === '') throw new FsError('会话缺少 id', 'INVALID_CHAT');
    const content = serializeChatFile(session);
    return this.fs.writeTextFile(session.path, content, true);
  }

  private assertInFolder(relPath: string, folder: string): void {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const dir = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    const base = normalized.slice(normalized.lastIndexOf('/') + 1);
    if (dir !== folder || !base.toLowerCase().endsWith('.md')) {
      throw new FsError(`会话文件必须位于 ${folder}/ 目录: ${relPath}`, 'OUTSIDE_CHAT_FOLDER');
    }
  }

  /**
   * 会话转普通文档：AI 回答 → 正文块；用户消息 → 引用块（默认）或 HTML 注释。
   * 写入 vault 根下唯一文件名；原会话保留。
   */
  async saveAsDocument(relPath: string, userAsQuote = true): Promise<FileInfo> {
    const session = await this.getChat(relPath);
    const title = session.meta.title || '对话笔记';
    const body = this.renderDocumentBody(session.turns, userAsQuote);
    const frontmatter = defaultNoteFrontmatter();
    const fileName = await this.uniqueRootName(title);
    const target = `${fileName}.md`;
    const content = `${frontmatter}\n# ${title}\n\n${body}\n`;
    return this.fs.writeTextFile(target, content, true);
  }

  private async uniqueRootName(title: string): Promise<string> {
    const sanitized = sanitizeEntryName(title.replace(/\.md$/i, ''));
    const base = sanitized.ok ? sanitized.value : '对话笔记';
    const exists = async (name: string): Promise<boolean> => this.fs.exists(`${name}.md`);
    if (!(await exists(base))) return base;
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${base} ${i}`;
      if (!(await exists(candidate))) return candidate;
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
        blocks.push(
          ['> 提问：', ...content.split('\n').map((line) => `> ${line}`)].join('\n'),
        );
      } else {
        blocks.push(`<!-- 用户提问\n${content}\n-->`);
      }
    }
    return blocks.join('\n\n');
  }
}
