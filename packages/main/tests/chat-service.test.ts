import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultFsService } from '../src/fs/fs-service';
import { ChatService, SESSION_DIR } from '../src/chat/chat-service';
import { GitService } from '../src/git/git-service';
import { defaultVaultConfig } from '@nexnote/shared';
import { readVaultConfig } from '../src/vault/vault-manager';
import { LinkIndexService } from '../src/indexer/index-service';
import { MetadataStore } from '../src/document/metadata-store';
import type { ChatSession } from '@nexnote/shared';

let tmp: string;
let vaultRoot: string;
let fs: VaultFsService;
let chats: ChatService;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-chat-test-'));
  vaultRoot = path.join(tmp, 'vault');
  await mkdir(vaultRoot, { recursive: true });
  fs = new VaultFsService(() => vaultRoot);
  chats = new ChatService(fs, () => vaultRoot);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function saved(title: string, turns: ChatSession['turns']): Promise<ChatSession> {
  const draft = await chats.newChat(title);
  draft.turns = turns;
  await chats.saveChat(draft);
  return draft;
}

describe('ChatService 会话内部 JSONL 存储（ADR-0007）', () => {
  it('新会话路径为 .nexnote/sessions/{sha256(id)}.txt，保存前不落盘', async () => {
    const draft = await chats.newChat();
    expect(draft.turns).toEqual([]);
    expect(draft.path).toMatch(/^\.nexnote\/sessions\/[a-f0-9]{64}\.txt$/);
    expect(await fs.exists(draft.path)).toBe(false);

    draft.turns.push({ role: 'user', content: '你好' });
    draft.turns.push({ role: 'assistant', content: '你好！有什么可以帮你？' });
    await chats.saveChat(draft);
    expect(await fs.exists(draft.path)).toBe(true);

    const text = await fs.readTextFile(draft.path);
    expect(text.trim().split('\n')).toHaveLength(1);
    expect(text).not.toContain('type: chat');
    expect(JSON.parse(text).type).toBe('snapshot');
  });

  it('重启后历史可列出、可搜索、可续聊（消息与来源完整）', async () => {
    const a = await saved('块编辑器是什么', [
      { role: 'user', content: '问题' },
      {
        role: 'assistant',
        content: '回答',
        meta: {
          degraded: false,
          retrievalModel: 'e-1',
          sources: [
            {
              path: 'a.md',
              title: 'A',
              blockId: null,
              snippet: 's',
              score: 1,
              vectorSim: 0.5,
              confidenceScore: null,
              via: 'fts',
            },
          ],
        },
      },
    ]);
    const b = await saved('双链怎么用', [{ role: 'user', content: 'y' }]);

    // 模拟重启：新的服务实例只依赖磁盘上的 sessions 目录
    const restarted = new ChatService(new VaultFsService(() => vaultRoot), () => vaultRoot);
    const list = await restarted.listChats();
    expect(list.map((s) => s.title)).toEqual(['双链怎么用', '块编辑器是什么']);

    const hits = await restarted.listChats('双链');
    expect(hits.map((s) => s.title)).toEqual(['双链怎么用']);

    const reopened = await restarted.getChat(a.path);
    expect(reopened.meta.id).toBe(a.meta.id);
    expect(reopened.turns).toHaveLength(2);
    expect(reopened.turns[1]!.meta!.sources![0]!.path).toBe('a.md');

    // 续聊：追加 JSONL 快照行，末行即最新状态
    reopened.turns.push({ role: 'user', content: '再问一句' });
    await restarted.saveChat(reopened, 'streaming');
    const appended = await fs.readTextFile(a.path);
    expect(appended.trim().split('\n')).toHaveLength(2);
    const again = await new ChatService(
      new VaultFsService(() => vaultRoot),
      () => vaultRoot,
    ).getChat(a.path);
    expect(again.turns).toHaveLength(3);
    expect(again.turns[2]!.content).toBe('再问一句');
    expect(again.status).toBe('streaming');
    void b;
  });

  it('未完成/取消/失败状态可见，并可恢复续聊', async () => {
    const draft = await chats.newChat('状态会话');
    draft.turns = [
      { role: 'user', content: '问' },
      { role: 'assistant', content: '' },
    ];
    await chats.saveChat(draft, 'streaming');
    expect((await chats.listChats())[0]!.status).toBe('streaming');

    draft.turns[1] = { role: 'assistant', content: '答一半' };
    await chats.saveChat(draft, 'cancelled');
    const cancelled = await chats.getChat(draft.path);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.turns[1]!.content).toBe('答一半');

    await chats.saveChat(draft, 'failed', '连接超时');
    const failed = await chats.getChat(draft.path);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('连接超时');

    draft.turns.push({ role: 'user', content: '继续' });
    await chats.saveChat(draft, 'complete');
    expect((await chats.getChat(draft.path)).status).toBe('complete');
  });

  it('重命名只改标题，hash 文件名不变', async () => {
    const draft = await saved('旧标题', [{ role: 'user', content: 'x' }]);
    const before = draft.path;
    draft.meta.title = '新标题';
    await chats.saveChat(draft);
    expect(draft.path).toBe(before);
    const list = await chats.listChats();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('新标题');
    expect(list[0]!.path).toBe(before);
    expect((await fs.listDir(SESSION_DIR)).map((e) => e.name)).toEqual([path.basename(before)]);
  });

  it('listChats 按 updatedAt 倒序，忽略目录内的非会话文件', async () => {
    const a = await chats.newChat('旧会话');
    a.meta.updatedAt = '2026-01-01T00:00:00.000Z';
    a.turns = [{ role: 'user', content: 'x' }];
    await chats.saveChat(a);
    const b = await chats.newChat('新会话');
    b.meta.updatedAt = '2026-09-01T00:00:00.000Z';
    b.turns = [{ role: 'user', content: 'y' }];
    await chats.saveChat(b);
    await fs.writeTextFile(`${SESSION_DIR}/notes.md`, '# 普通笔记', true);
    await fs.writeTextFile(`${SESSION_DIR}/broken.txt`, 'not json', true);

    const list = await chats.listChats();
    expect(list.map((s) => s.title)).toEqual(['新会话', '旧会话']);
  });

  it('saveChat 拒绝 sessions 目录之外的路径与 id/路径不匹配', async () => {
    const evil: ChatSession = {
      path: '别处.md',
      meta: {
        id: 'x',
        title: 'x',
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
      },
      turns: [],
    };
    await expect(chats.saveChat(evil)).rejects.toMatchObject({ code: 'INVALID_SESSION_PATH' });

    const mismatched: ChatSession = {
      ...evil,
      path: `.nexnote/sessions/${'a'.repeat(64)}.txt`,
      meta: { ...evil.meta, id: 'other-id' },
    };
    await expect(chats.saveChat(mismatched)).rejects.toMatchObject({
      code: 'SESSION_PATH_MISMATCH',
    });
  });

  it('会话不进入文档树、页面索引与双链候选', async () => {
    await writeFile(path.join(vaultRoot, '笔记.md'), '# 笔记\n\n正文\n', 'utf8');
    const draft = await saved('秘密会话标题', [
      { role: 'user', content: '唯一的会话正文关键词' },
      { role: 'assistant', content: '回答' },
    ]);

    // 文档树：.nexnote/ 整体排除
    const tree = await fs.listTree(true);
    expect(tree.some((e) => e.path.startsWith('.nexnote'))).toBe(false);

    // 页面索引 / 搜索 / 双链候选
    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    try {
      expect(index.search('唯一的会话正文关键词')).toEqual([]);
      expect(index.jumpTo('秘密会话标题')).toEqual([]);
      expect(index.graph().pages.map((p) => p.path)).toEqual(['笔记.md']);
    } finally {
      index.close();
    }
    expect(draft.path).not.toMatch(/\.md$/);
  });

  it('sessions 目录保持 Git 忽略（ADR-0003 策略不 allowlist 会话）', async () => {
    const git = new GitService({ useSystemGit: true });
    await git.writeDefaultGitignore(vaultRoot);
    const ignore = await readFile(path.join(vaultRoot, '.gitignore'), 'utf8');
    expect(ignore).toContain('.nexnote/*');
    expect(ignore).not.toContain('!/.nexnote/sessions');

    let systemGit = true;
    try {
      execFileSync(process.env.NEXNOTE_TEST_GIT ?? 'git', ['--version'], { stdio: 'ignore' });
    } catch {
      systemGit = false;
    }
    if (!systemGit) return;
    execFileSync(process.env.NEXNOTE_TEST_GIT ?? 'git', ['init'], {
      cwd: vaultRoot,
      stdio: 'ignore',
    });
    await saved('忽略检查', [{ role: 'user', content: 'x' }]);
    const tracked = execFileSync(
      process.env.NEXNOTE_TEST_GIT ?? 'git',
      ['status', '--porcelain', '--untracked-files=all'],
      { cwd: vaultRoot, encoding: 'utf8' },
    );
    expect(tracked).not.toContain('.nexnote/sessions');
  });

  it('导出为页面：AI 回答转正文、用户消息转引用块；产物是普通页面与会话脱钩', async () => {
    const draft = await saved('对话主题', [
      { role: 'user', content: '什么是双链？' },
      { role: 'assistant', content: '双链是**双向链接**。' },
    ]);

    const doc = await chats.saveAsDocument(draft.path, true);
    expect(doc.path).toMatch(/^对话主题.*\.md$/);
    expect(doc.path).not.toContain('/');
    const text = await fs.readTextFile(doc.path);
    expect(text).toContain('双链是**双向链接**。');
    expect(text).toContain('> 什么是双链？');
    expect(text).toMatch(/^# /); // 纯 Markdown 正文，产品 metadata 走 sidecar
    expect(await new MetadataStore(vaultRoot).read(doc.path)).toMatchObject({
      format: 'native-block',
    });

    // 导出页可被索引（进入双链体系），会话本身不可
    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    try {
      expect(index.search('双链是双向链接').some((h) => h.path === doc.path)).toBe(true);
      expect(index.graph().pages.some((p) => p.path.startsWith('.nexnote'))).toBe(false);
    } finally {
      index.close();
    }

    // 脱钩：编辑导出页不影响会话，删除会话不影响页面
    await fs.writeTextFile(doc.path, `# 对话主题\n\n手动编辑后的正文\n`, true);
    expect((await chats.getChat(draft.path)).turns[1]!.content).toBe('双链是**双向链接**。');
    await fs.delete(draft.path);
    expect(await fs.exists(doc.path)).toBe(true);
  });

  it('导出为页面支持用户消息转注释模式', async () => {
    const draft = await saved('注释模式', [
      { role: 'user', content: '秘密提问' },
      { role: 'assistant', content: '公开回答' },
    ]);
    const doc = await chats.saveAsDocument(draft.path, false);
    const text = await fs.readTextFile(doc.path);
    expect(text).toContain('公开回答');
    expect(text).toContain('<!-- 用户提问');
    expect(text).toContain('秘密提问');
    expect(text).not.toContain('> 秘密提问');
  });

  it('无 vault 时拒绝访问', async () => {
    const orphan = new ChatService(new VaultFsService(() => null), () => null);
    await expect(orphan.listChats()).rejects.toMatchObject({ code: 'NO_VAULT' });
    await expect(orphan.saveChat(await chats.newChat())).rejects.toMatchObject({
      code: 'NO_VAULT',
    });
  });

  it('vault 配置不再含 chatFolder，旧配置残留被静默丢弃', async () => {
    await mkdir(path.join(vaultRoot, '.nexnote'), { recursive: true });
    await writeFile(
      path.join(vaultRoot, '.nexnote', 'config.json'),
      JSON.stringify({ version: 1, chatFolder: 'AI Chats', features: {} }),
      'utf8',
    );
    const config = await readVaultConfig(vaultRoot);
    expect(config).not.toHaveProperty('chatFolder');
    expect(defaultVaultConfig()).not.toHaveProperty('chatFolder');
  });
});
