import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultFsService } from '../src/fs/fs-service';
import { ChatService } from '../src/chat/chat-service';
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

describe('ChatService 会话即页面', () => {
  it('默认目录为 AI Chats；newChat 不落盘，saveChat 后才出现文件', async () => {
    expect(await chats.folder()).toBe('AI Chats');
    const draft = await chats.newChat();
    expect(draft.turns).toEqual([]);
    expect(draft.path).toMatch(/^AI Chats\/.*\.md$/);
    expect(await fs.exists(draft.path)).toBe(false);

    draft.turns.push({ role: 'user', content: '你好' });
    draft.turns.push({ role: 'assistant', content: '你好！有什么可以帮你？' });
    await chats.saveChat(draft);
    expect(await fs.exists(draft.path)).toBe(true);

    const list = await chats.listChats();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe(draft.meta.title);
    expect(list[0]!.turnCount).toBe(2);
  });

  it('保存后可重新读取（续聊）：消息与来源完整', async () => {
    const draft = await chats.newChat('主题');
    draft.meta.title = '块编辑器是什么';
    draft.turns = [
      { role: 'user', content: '问题' },
      {
        role: 'assistant',
        content: '回答',
        meta: { degraded: false, retrievalModel: 'e-1', sources: [{ path: 'a.md', title: 'A', blockId: null, snippet: 's', score: 1, vectorSim: 0.5, confidenceScore: null, via: 'fts' }] },
      },
    ];
    await chats.saveChat(draft);
    const reloaded = await chats.getChat(draft.path);
    expect(reloaded.meta.id).toBe(draft.meta.id);
    expect(reloaded.meta.title).toBe('块编辑器是什么');
    expect(reloaded.turns).toHaveLength(2);
    expect(reloaded.turns[1]!.meta!.sources![0]!.path).toBe('a.md');
  });

  it('listChats 按 updatedAt 倒序且忽略非会话 .md', async () => {
    const a = await chats.newChat('旧会话');
    a.meta.updatedAt = '2026-01-01T00:00:00.000Z';
    a.turns = [{ role: 'user', content: 'x' }];
    await chats.saveChat(a);
    const b = await chats.newChat('新会话');
    b.meta.updatedAt = '2026-09-01T00:00:00.000Z';
    b.turns = [{ role: 'user', content: 'y' }];
    await chats.saveChat(b);
    // 目录内放一个非 chat 的 md（type 缺失）应被忽略
    await fs.writeTextFile('AI Chats/普通笔记.md', '---\nid: z\n---\n# 普通', true);

    const list = await chats.listChats();
    expect(list.map((s) => s.title)).toEqual(['新会话', '旧会话']);
  });

  it('saveChat 拒绝会话目录之外的路径（越权写防护）', async () => {
    const evil: ChatSession = {
      path: '别处.md',
      meta: { id: 'x', title: 'x', createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z' },
      turns: [],
    };
    await expect(chats.saveChat(evil)).rejects.toMatchObject({ code: 'OUTSIDE_CHAT_FOLDER' });
  });

  it('saveAsDocument：AI 回答转正文、用户消息转引用块；原会话保留；新文档在 vault 根', async () => {
    const draft = await chats.newChat('对话主题');
    draft.turns = [
      { role: 'user', content: '什么是双链？' },
      { role: 'assistant', content: '双链是**双向链接**。' },
    ];
    await chats.saveChat(draft);

    const doc = await chats.saveAsDocument(draft.path, true);
    expect(doc.path).toMatch(/^对话主题.*\.md$/);
    expect(doc.path).not.toContain('/');
    const text = await fs.readTextFile(doc.path);
    expect(text).toContain('双链是**双向链接**。');
    expect(text).toContain('> 什么是双链？');
    expect(text).toMatch(/^# /); // 纯 Markdown 正文，产品 metadata 走 sidecar
    expect(await new MetadataStore(vaultRoot).read(doc.path)).toMatchObject({ format: 'native-block' });
    // 原会话仍在
    expect(await fs.exists(draft.path)).toBe(true);
  });

  it('saveAsDocument 用户消息转注释模式', async () => {
    const draft = await chats.newChat('注释模式');
    draft.turns = [
      { role: 'user', content: '秘密提问' },
      { role: 'assistant', content: '公开回答' },
    ];
    await chats.saveChat(draft);
    const doc = await chats.saveAsDocument(draft.path, false);
    const text = await fs.readTextFile(doc.path);
    expect(text).toContain('公开回答');
    expect(text).toContain('<!-- 用户提问');
    expect(text).toContain('秘密提问');
    expect(text).not.toContain('> 秘密提问');
  });

  it('setFolder 切换目录；新会话写入新目录（不迁移旧会话）', async () => {
    const old = await chats.newChat('旧目录会话');
    old.turns = [{ role: 'user', content: 'x' }];
    await chats.saveChat(old);

    const { folder } = await chats.setFolder('对话存档');
    expect(folder).toBe('对话存档');
    expect(await chats.folder()).toBe('对话存档');

    const fresh = await chats.newChat('新目录会话');
    fresh.turns = [{ role: 'user', content: 'y' }];
    await chats.saveChat(fresh);
    expect(fresh.path.startsWith('对话存档/')).toBe(true);

    const list = await chats.listChats();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('新目录会话');
  });

  it('setFolder 拒绝非法目录名', async () => {
    await expect(chats.setFolder('../逃逸')).rejects.toMatchObject({ code: 'INVALID_NAME' });
    await expect(chats.setFolder('.hidden')).rejects.toMatchObject({ code: 'INVALID_NAME' });
  });
});
