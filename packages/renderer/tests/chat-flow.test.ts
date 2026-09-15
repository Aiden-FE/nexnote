// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ChatSession, ChatSummary, RetrievalResponse } from '@nexnote/shared';

interface StreamListener {
  (payload: unknown): void;
}

const SESSION_PATH = `.nexnote/sessions/${'a'.repeat(64)}.txt`;

function newSession(): ChatSession {
  return {
    path: SESSION_PATH,
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
  const saveCalls: Array<{ session: ChatSession; status?: string; error?: string }> = [];
  const listQueries: Array<string | undefined> = [];
  const startCalls: Array<{
    messages: Array<{ role: string; content: string }>;
    skillIds?: string[];
    contextText?: string;
  }> = [];
  const historySummary: ChatSummary = {
    path: SESSION_PATH,
    id: 'c-9',
    title: '历史会话',
    model: null,
    turnCount: 2,
    updatedAt: '2026-09-01T00:00:00.000Z',
    status: 'cancelled',
  };
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'chat:new') return { ok: true, data: newSession() };
      if (channel === 'chat:save') {
        const call = payload as { session: ChatSession; status?: string; error?: string };
        saveCalls.push(call);
        return {
          ok: true,
          data: {
            path: call.session.path,
            name: 'session.txt',
            kind: 'file',
            size: 1,
            modifiedAt: '',
          },
        };
      }
      if (channel === 'chat:list') {
        const query = (payload as { query?: string } | undefined)?.query;
        listQueries.push(query);
        if (query && !historySummary.title.includes(query)) return { ok: true, data: [] };
        return { ok: true, data: [historySummary] };
      }
      if (channel === 'chat:get')
        return {
          ok: true,
          data: {
            ...newSession(),
            path: (payload as { path: string }).path,
            meta: { ...newSession().meta, id: 'c-9', title: '历史会话' },
            turns: [
              { role: 'user', content: '旧问' },
              { role: 'assistant', content: '' },
            ],
            status: 'streaming',
          },
        };
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
  const emit = (channel: string, payload: unknown) =>
    listeners[channel]?.forEach((cb) => cb(payload));
  return {
    saveCalls,
    startCalls,
    listQueries,
    emit,
    flush: () => new Promise((r) => setTimeout(r, 0)),
    streamDone: () => {
      setTimeout(() => {
        emit('agent:runEvent', {
          runId: 'stream-1',
          scenario: 'chat',
          event: { type: 'context', sources: retrieval.sources, degraded: retrieval.degraded },
        });
        emit('agent:runEvent', {
          runId: 'stream-1',
          scenario: 'chat',
          event: { type: 'start', model: 'chat-model' },
        });
        emit('agent:runEvent', {
          runId: 'stream-1',
          scenario: 'chat',
          event: { type: 'delta', text: '双链是' },
        });
        emit('agent:runEvent', {
          runId: 'stream-1',
          scenario: 'chat',
          event: { type: 'delta', text: '双向链接。' },
        });
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

describe('对话 dock 运行时（JSONL 会话：流式 → 来源 → 自动保存 → 续聊）', () => {
  it('发送消息：流式回答追加、召回来源附着、会话自动保存到 sessions 路径', async () => {
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
    expect(meta.degraded).toBe(false);
    const lastStart = bridge.startCalls.at(-1)!;
    const userMsg = lastStart.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).not.toContain('知识库召回');
    expect(userMsg.content).toContain('什么是双链？');
    expect(lastStart.skillIds).toBeUndefined();
    expect(lastStart.contextText).toBe('');
    expect(bridge.saveCalls.length).toBeGreaterThan(0);
    const saved = bridge.saveCalls.at(-1)!;
    expect(saved.session.path).toContain('.nexnote/sessions/');
    expect(
      saved.session.turns.some((t) => t.role === 'assistant' && (t.meta?.sources?.length ?? 0) > 0),
    ).toBe(true);
    expect(store.useChatStore.getState().streaming).toBe(false);
    // 先落 streaming 未完成标记，收尾落 complete
    expect(bridge.saveCalls.map((c) => c.status)).toContain('streaming');
    expect(bridge.saveCalls.at(-1)!.status).toBe('complete');
    expect(store.useChatStore.getState().sessionStatus).toBe('complete');
  });

  it('历史列表刷新与搜索：搜索词透传主进程', async () => {
    const bridge = installBridge();
    const { runtime, store } = await loadModules();
    runtime.initChatRuntime();
    await runtime.searchSessions();
    await runtime.searchSessions('历史');
    expect(bridge.listQueries).toEqual([undefined, '历史']);
    expect(store.useChatStore.getState().summaries).toHaveLength(1);
    expect(store.useChatStore.getState().summaries[0]!.status).toBe('cancelled');
  });

  it('打开历史会话续聊：读回未完成状态标记', async () => {
    const bridge = installBridge();
    const { runtime, store } = await loadModules();
    runtime.initChatRuntime();
    await runtime.openSession(SESSION_PATH);
    await bridge.flush();
    const state = store.useChatStore.getState();
    expect(state.active!.meta.title).toBe('历史会话');
    expect(state.active!.turns).toHaveLength(2);
    expect(state.sessionStatus).toBe('streaming');
    expect(state.isDraft).toBe(false);
  });

  it('停止流式：落盘 cancelled 未完成标记', async () => {
    const bridge = installBridge();
    const { runtime, store } = await loadModules();
    runtime.initChatRuntime();
    await runtime.startNewSession();
    await runtime.sendMessage('问题');
    runtime.stopStream();
    await bridge.flush();
    await bridge.flush();
    expect(bridge.saveCalls.at(-1)!.status).toBe('cancelled');
    expect(store.useChatStore.getState().sessionStatus).toBe('cancelled');
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
