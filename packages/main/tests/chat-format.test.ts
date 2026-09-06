import { describe, expect, it } from 'vitest';
import type { ChatSession, ChatTurn } from '@nexnote/shared';
import {
  parseChatFile,
  parseChatFrontmatter,
  serializeChatFile,
  serializeChatFrontmatter,
} from '../src/chat/chat-format';

function session(overrides?: Partial<ChatSession>): ChatSession {
  return {
    path: 'AI Chats/测试.md',
    meta: {
      id: 'c-1',
      title: '测试会话',
      profileId: null,
      model: 'gpt-x',
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T01:00:00.000Z',
    },
    turns: [],
    ...overrides,
  };
}

describe('chat-format 会话序列化', () => {
  it('frontmatter 标量往返（含引号/冒号/中文标题）', () => {
    const fm = serializeChatFrontmatter({
      id: 'id-1',
      title: '标题: 带 "引号" 与 : 冒号',
      profileId: 'p-9',
      model: 'm-1',
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:01:00.000Z',
    });
    const parsed = parseChatFrontmatter(`${fm}\n正文`);
    expect(parsed.type).toBe('chat');
    expect(parsed.id).toBe('id-1');
    expect(parsed.title).toBe('标题: 带 "引号" 与 : 冒号');
    expect(parsed.profileId).toBe('p-9');
    expect(parsed.model).toBe('m-1');
  });

  it('完整会话往返：消息顺序、正文、assistant 召回来源', () => {
    const turns: ChatTurn[] = [
      { role: 'user', content: '什么是块编辑器？' },
      {
        role: 'assistant',
        content: '块编辑器以**块**为最小单位。\n\n第二段。',
        meta: {
          degraded: false,
          retrievalModel: 'embed-1',
          sources: [
            {
              path: '笔记.md',
              title: '笔记',
              blockId: 'abc',
              snippet: '片段',
              score: 0.9,
              vectorSim: 0.8,
              confidenceScore: 80,
              via: 'vector',
            },
          ],
          stages: [
            { stage: 'fts', candidates: 3, elapsedMs: 12, enabled: true },
            { stage: 'vector', candidates: 1, elapsedMs: 5, enabled: true },
          ],
        },
      },
    ];
    const text = serializeChatFile(session({ turns }));
    const reparsed = parseChatFile('AI Chats/测试.md', text);
    expect(reparsed).not.toBeNull();
    expect(reparsed!.turns).toHaveLength(2);
    expect(reparsed!.turns[0]).toEqual({ role: 'user', content: '什么是块编辑器？' });
    expect(reparsed!.turns[1]!.role).toBe('assistant');
    expect(reparsed!.turns[1]!.content).toBe('块编辑器以**块**为最小单位。\n\n第二段。');
    const meta = reparsed!.turns[1]!.meta!;
    expect(meta.sources).toHaveLength(1);
    expect(meta.sources![0]!.path).toBe('笔记.md');
    expect(meta.sources![0]!.vectorSim).toBe(0.8);
    expect(meta.stages).toHaveLength(2);
    expect(meta.retrievalModel).toBe('embed-1');
    expect(meta.degraded).toBe(false);
  });

  it('用户消息不带 meta；meta 仅附着在紧邻的 assistant 消息上', () => {
    const text = serializeChatFile(
      session({
        turns: [
          { role: 'user', content: '问题一' },
          { role: 'assistant', content: '回答一', meta: { degraded: true } },
          { role: 'user', content: '问题二' },
          { role: 'assistant', content: '回答二' },
        ],
      }),
    );
    const reparsed = parseChatFile('AI Chats/x.md', text)!;
    expect(reparsed.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(reparsed.turns[0]!.meta).toBeUndefined();
    expect(reparsed.turns[1]!.meta?.degraded).toBe(true);
    expect(reparsed.turns[3]!.meta).toBeUndefined();
  });

  it('非 chat 文件解析为 null', () => {
    expect(parseChatFile('a.md', '---\nid: x\n---\n# 普通笔记')).toBeNull();
    expect(parseChatFile('a.md', '# 无 frontmatter')).toBeNull();
  });

  it('损坏的 meta 标记不抛错，仅丢失来源', () => {
    const text = [
      '---',
      'type: chat',
      'id: c-2',
      'title: "t"',
      'createdAt: 2026-09-07T00:00:00.000Z',
      'updatedAt: 2026-09-07T00:00:00.000Z',
      '---',
      '<!-- nexnote-chat-role=assistant -->',
      '回答正文',
      '<!-- nexnote-chat-meta=!!!notbase64!!! -->',
      '',
    ].join('\n');
    const reparsed = parseChatFile('AI Chats/t.md', text)!;
    expect(reparsed.turns).toHaveLength(1);
    expect(reparsed.turns[0]!.content).toBe('回答正文');
    expect(reparsed.turns[0]!.meta).toBeUndefined();
  });

  it('容忍 CRLF 换行', () => {
    const text = serializeChatFile(
      session({ turns: [{ role: 'user', content: '你好' }] }),
    ).replace(/\n/g, '\r\n');
    const reparsed = parseChatFile('AI Chats/crlf.md', text)!;
    expect(reparsed.turns).toHaveLength(1);
    expect(reparsed.turns[0]!.content).toBe('你好');
  });
});
