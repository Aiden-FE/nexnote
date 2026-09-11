// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ChatSession, RetrievalResponse } from '@nexnote/shared';

interface StreamListener {
  (payload: unknown): void;
}

function newSession(): ChatSession {
  return {
    path: 'AI Chats/新对话.md',
    meta: {
      id: 'c-1',
      title: '新对话',
      profileId: null,
      model: null,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    },
    turns: [],
  };
}

const retrieval: RetrievalResponse = {
  query: '什么是双链',
  degraded: false,
  model: 'embed-1',
  contextText: '召回：双链是双向链接。',
  sources: [
    {
      path: '笔记.md',
      title: '笔记',
      blockId: 'b1',
      blockType: 'paragraph',
      snippet: '双链片段',
      score: 0.9,
      vectorSim: 0.77,
      confidenceScore: 88,
      via: 'vector',
    },
  ],
  stages: [
    { stage: 'fts', candidates: 2, elapsedMs: 10, enabled: true },
    { stage: 'vector', candidates: 1, elapsedMs: 4, enabled: true },
  ],
};

function installBridge() {
  const listeners: Record<string, Set<StreamListener>> = {};
  const saveCalls: ChatSession[] = [];
  const startCalls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'chat:new') return { ok: true, data: newSession() };
      if (channel === 'chat:save') {
        saveCalls.push((payload as { session: ChatSession }).session);
        return { ok: true, data: { path: 'AI Chats/新对话.md', name: '新对话.md', kind: 'file', size: 1, modifiedAt: '' } };
      }
      if (channel === 'chat:list')
        return {
          ok: true,
          data: [
            { path: 'AI Chats/历史会话.md', id: 'c-9', title: '历史会话', model: null, turnCount: 2, updatedAt: '2026-09-01T00:00:00.000Z' },
          ],
        };
      if (channel === 'chat:get')
        return {
          ok: true,
          data: {
            ...newSession(),
            path: (payload as { path: string }).path,
            meta: { ...newSession().meta, id: 'c-9', title: '历史会话' },
            turns: [
              { role: 'user', content: '旧问' },
              { role: 'assistant', content: '旧答' },
            ],
          },
        };
      if (channel === 'chat:folder:get') return { ok: true, data: { folder: 'AI Chats' } };
      if (channel === 'ai:retrieve') return { ok: true, data: retrieval };
      if (channel === 'agent:run:chat') {
        startCalls.push(payload as never);
        return { ok: true, data: { runId: 'stream-1' } };
      }
      if (channel === 'agent:cancel') return { ok: true, data: { cancelled: true } };
      if (channel === 'fs:readTextFile') return { ok: true, data: '# 页面正文' };
      return { ok: true, data: null };
    }),
    on: (channel: string, cb: StreamListener) => {
      const set = listeners[channel] ?? new Set<StreamListener>();
      set.add(cb);
      listeners[channel] = set;
      return () => set.delete(cb);
    },
  };
  const emit = (channel: string, payload: unknown) => listeners[channel]?.forEach((cb) => cb(payload));
  return {
    saveCalls,
    startCalls,
    emit,
    flush: () => new Promise((r) => setTimeout(r, 0)),
    streamDone: () => {
      setTimeout(() => {
        emit('agent:runEvent', { runId: 'stream-1', scenario: 'chat', event: { type: 'start', model: 'chat-model' } });
        emit('agent:runEvent', { runId: 'stream-1', scenario: 'chat', event: { type: 'delta', text: '双链是' } });
        emit('agent:runEvent', { runId: 'stream-1', scenario: 'chat', event: { type: 'delta', text: '双向链接。' } });
        emit('agent:runEvent', { runId: 'stream-1', scenario: 'chat', event: { type: 'done' } });
      }, 0);
    },
  };
}

async function loadModules() {
  vi.resetModules();
  const runtime = await import('../src/features/ai/chat/chat-runtime');
  const store = await import('../src/features/ai/chat/chat-store');
  return { runtime, store };
}

describe('对话 dock 运行时（流式 → 来源 → 自动保存）', () => {
  it('发送消息：流式回答追加、召回来源附着、会话自动保存', async () => {
    const bridge = installBridge();
    const { runtime, store } = await loadModules();
    runtime.initChatRuntime();
    await runtime.startNewSession();
    bridge.streamDone();
    await runtime.sendMessage('什么是双链？');
    await bridge.flush();
    await bridge.flush();

    const active = store.useChatStore.getState().active!;
    expect(active).toBeTruthy();
    expect(active.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(active.turns[0]!.content).toBe('什么是双链？');
    expect(active.turns[1]!.content).toBe('双链是双向链接。');
    expect(active.meta.title).toBe('什么是双链？');
    const meta = active.turns[1]!.meta!;
    expect(meta.sources).toHaveLength(1);
    expect(meta.sources![0]!.path).toBe('笔记.md');
    expect(meta.retrievalModel).toBe('embed-1');
    const lastStart = bridge.startCalls.at(-1)!;
    const userMsg = lastStart.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toContain('知识库召回');
    expect(userMsg.content).toContain('什么是双链？');
    expect(bridge.saveCalls.length).toBeGreaterThan(0);
    const saved = bridge.saveCalls.at(-1)!;
    expect(saved.path).toContain('AI Chats/');
    expect(saved.turns.some((t) => t.role === 'assistant' && (t.meta?.sources?.length ?? 0) > 0)).toBe(true);
    expect(store.useChatStore.getState().streaming).toBe(false);
  });

  it('双链按标题打开历史会话；无匹配返回 false', async () => {
    const bridge = installBridge();
    const { runtime, store } = await loadModules();
    runtime.initChatRuntime();
    await runtime.refreshSummaries();
    const hit = await runtime.openChatWikilinkOrNull('历史会话');
    expect(hit).toBe(true);
    await bridge.flush();
    const active = store.useChatStore.getState().active!;
    expect(active.meta.title).toBe('历史会话');
    expect(active.turns).toHaveLength(2);
    const miss = await runtime.openChatWikilinkOrNull('不存在的页面');
    expect(miss).toBe(false);
  });

  it('「询问 AI」载荷入队，携带选区文本与文档', async () => {
    installBridge();
    const { store } = await loadModules();
    const ask = await import('../src/features/ai/chat/ask-ai');
    ask.requestAskAi('选中的这段文字', '当前笔记', '当前笔记.md');
    const payload = store.useChatStore.getState().consumeAsk();
    expect(payload?.selectionText).toBe('选中的这段文字');
    expect(payload?.docTitle).toBe('当前笔记');
    expect(payload?.docPath).toBe('当前笔记.md');
  });
});
