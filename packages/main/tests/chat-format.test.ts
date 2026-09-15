import { describe, expect, it } from 'vitest';
import type { ChatSession, ChatTurn } from '@nexnote/shared';
import { parseChatJsonl, serializeChatRecord } from '../src/chat/chat-format';

function session(overrides?: Partial<ChatSession>): ChatSession {
  return {
    path: '.nexnote/sessions/abc.txt',
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

describe('chat-format JSONL 序列化', () => {
  it('单行 JSONL：元数据/标题（含引号冒号中文）往返', () => {
    const text = serializeChatRecord(
      session({
        meta: {
          id: 'id-1',
          title: '标题: 带 "引号" 与 : 冒号',
          profileId: 'p-9',
          model: 'm-1',
          createdAt: '2026-09-07T00:00:00.000Z',
          updatedAt: '2026-09-07T00:01:00.000Z',
        },
      }),
    );
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trim().split('\n')).toHaveLength(1);
    const parsed = parseChatJsonl('.nexnote/sessions/abc.txt', text)!;
    expect(parsed.meta.id).toBe('id-1');
    expect(parsed.meta.title).toBe('标题: 带 "引号" 与 : 冒号');
    expect(parsed.meta.profileId).toBe('p-9');
    expect(parsed.meta.model).toBe('m-1');
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
    const text = serializeChatRecord(session({ turns }));
    const reparsed = parseChatJsonl('.nexnote/sessions/abc.txt', text)!;
    expect(reparsed.turns).toHaveLength(2);
    expect(reparsed.turns[0]).toEqual({ role: 'user', content: '什么是块编辑器？' });
    expect(reparsed.turns[1]!.role).toBe('assistant');
    expect(reparsed.turns[1]!.content).toBe('块编辑器以**块**为最小单位。\n\n第二段。');
    const meta = reparsed.turns[1]!.meta!;
    expect(meta.sources).toHaveLength(1);
    expect(meta.sources![0]!.path).toBe('笔记.md');
    expect(meta.sources![0]!.vectorSim).toBe(0.8);
    expect(meta.stages).toHaveLength(2);
    expect(meta.retrievalModel).toBe('embed-1');
    expect(meta.degraded).toBe(false);
  });

  it('用户消息不带 meta；meta 仅附着在紧邻的 assistant 消息上', () => {
    const text = serializeChatRecord(
      session({
        turns: [
          { role: 'user', content: '问题一' },
          { role: 'assistant', content: '回答一', meta: { degraded: true } },
          { role: 'user', content: '问题二' },
          { role: 'assistant', content: '回答二' },
        ],
      }),
    );
    const reparsed = parseChatJsonl('.nexnote/sessions/x.txt', text)!;
    expect(reparsed.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(reparsed.turns[0]!.meta).toBeUndefined();
    expect(reparsed.turns[1]!.meta?.degraded).toBe(true);
    expect(reparsed.turns[3]!.meta).toBeUndefined();
  });

  it('多行快照取最后一条有效记录（续聊追加语义）', () => {
    const first = serializeChatRecord(
      session({ turns: [{ role: 'user', content: '第一问' }] }),
      'streaming',
    );
    const second = serializeChatRecord(
      session({
        turns: [
          { role: 'user', content: '第一问' },
          { role: 'assistant', content: '第一答' },
        ],
      }),
      'complete',
    );
    const parsed = parseChatJsonl('.nexnote/sessions/x.txt', `${first}${second}`)!;
    expect(parsed.status).toBe('complete');
    expect(parsed.turns).toHaveLength(2);
  });

  it('非 JSONL / 无有效快照的文件解析为 null', () => {
    expect(parseChatJsonl('a.txt', '---\nid: x\n---\n# 普通笔记')).toBeNull();
    expect(parseChatJsonl('a.txt', '# 无 frontmatter')).toBeNull();
    expect(parseChatJsonl('a.txt', '{"type":"snapshot"}')).toBeNull();
  });

  it('截断/损坏行不抛错，保留此前有效快照并沿用其状态', () => {
    const good = serializeChatRecord(
      session({ turns: [{ role: 'assistant', content: '部分回答' }] }),
      'streaming',
    );
    const parsed = parseChatJsonl('.nexnote/sessions/t.txt', `${good}{"type":"snap`)!;
    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0]!.content).toBe('部分回答');
    expect(parsed.status).toBe('streaming');
  });

  it('失败状态与错误摘要随记录持久化', () => {
    const text = serializeChatRecord(
      session({ turns: [{ role: 'assistant', content: '' }] }),
      'failed',
      '连接超时',
    );
    const parsed = parseChatJsonl('.nexnote/sessions/f.txt', text)!;
    expect(parsed.status).toBe('failed');
    expect(parsed.error).toBe('连接超时');
  });

  it('容忍 CRLF 换行', () => {
    const text = serializeChatRecord(
      session({ turns: [{ role: 'user', content: '你好' }] }),
    ).replace(/\n/g, '\r\n');
    const reparsed = parseChatJsonl('.nexnote/sessions/crlf.txt', text)!;
    expect(reparsed.turns).toHaveLength(1);
    expect(reparsed.turns[0]!.content).toBe('你好');
  });
});
