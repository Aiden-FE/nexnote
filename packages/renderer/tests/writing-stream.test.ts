// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { startWritingStream } from '../src/features/ai/writing/stream';

type Listener = (payload: unknown) => void;

function installBridge(options: { failInvoke?: boolean } = {}) {
  const listeners: Record<string, Set<Listener>> = {};
  const cancelCalls: string[] = [];
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'agent:run:writing') {
        if (options.failInvoke) return { ok: false, error: 'preload 断线', code: 'NO_BRIDGE' };
        return { ok: true, data: { runId: 'run-a' } };
      }
      if (channel === 'agent:cancel') {
        cancelCalls.push((payload as { runId: string }).runId);
        return { ok: true, data: { cancelled: true } };
      }
      return { ok: true, data: null };
    }),
    on: (channel: string, cb: Listener) => {
      const set = listeners[channel] ?? new Set<Listener>();
      set.add(cb);
      listeners[channel] = set;
      return () => set.delete(cb);
    },
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const emit = (payload: unknown) => listeners['agent:runEvent']?.forEach((cb) => cb(payload));
  return { flush, emit, cancelCalls };
}

function handlers() {
  return { onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
}

const request = { actionId: 'rewrite' as const, target: '原文', contextText: '' };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('DEV-037 startWritingStream（请求层时序）', () => {
  it('runId 返回前到达的片段按序缓冲，返回后回放（首片段即显示）', async () => {
    const bridge = installBridge();
    const h = handlers();
    startWritingStream(request, h);

    // 事件先于 invoke resolve（IPC 两条通道无顺序保证）
    bridge.emit({ runId: 'run-a', event: { type: 'start', model: 'm' } });
    bridge.emit({ runId: 'run-a', event: { type: 'delta', text: '首' } });
    bridge.emit({ runId: 'run-a', event: { type: 'delta', text: '片段' } });
    expect(h.onDelta).not.toHaveBeenCalled();

    await bridge.flush();
    expect(h.onDelta.mock.calls.map((c) => c[0])).toEqual(['首', '片段']);
    expect(h.onDone).not.toHaveBeenCalled();
  });

  it('runId 返回前到达的终态事件同样回放（不会永久停在 streaming）', async () => {
    const bridge = installBridge();
    const h = handlers();
    startWritingStream(request, h);
    bridge.emit({ runId: 'run-a', event: { type: 'delta', text: '内容' } });
    bridge.emit({ runId: 'run-a', event: { type: 'done' } });
    await bridge.flush();
    expect(h.onDelta).toHaveBeenCalledWith('内容');
    expect(h.onDone).toHaveBeenCalledOnce();
  });

  it('无关 runId 的事件被忽略（不串会话）', async () => {
    const bridge = installBridge();
    const h = handlers();
    startWritingStream(request, h);
    await bridge.flush();
    bridge.emit({ runId: 'run-chat', event: { type: 'delta', text: '别的会话' } });
    bridge.emit({ runId: 'run-chat', event: { type: 'done' } });
    expect(h.onDelta).not.toHaveBeenCalled();
    expect(h.onDone).not.toHaveBeenCalled();
  });

  it('取消会向上游发送 agent:cancel，且后续事件不再投递', async () => {
    const bridge = installBridge();
    const h = handlers();
    const handle = startWritingStream(request, h);
    await bridge.flush();
    handle.cancel();

    bridge.emit({ runId: 'run-a', event: { type: 'delta', text: '迟到片段' } });
    bridge.emit({
      runId: 'run-a',
      event: { type: 'error', message: '取消引发', code: 'CANCELLED' },
    });
    await bridge.flush();

    expect(bridge.cancelCalls).toEqual(['run-a']);
    expect(h.onDelta).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('runId 返回前取消：resolve 后补发 cancel，避免上游孤儿流', async () => {
    const bridge = installBridge();
    const h = handlers();
    const handle = startWritingStream(request, h);
    handle.cancel();
    await bridge.flush();
    expect(bridge.cancelCalls).toEqual(['run-a']);
  });

  it('起始请求失败（断线）走 onError，且不重复触发', async () => {
    const bridge = installBridge({ failInvoke: true });
    const h = handlers();
    const handle = startWritingStream(request, h);
    await bridge.flush();
    expect(h.onError).toHaveBeenCalledOnce();
    expect(h.onError.mock.calls[0]?.[0]).toContain('preload 断线');
    handle.cancel();
    await bridge.flush();
    expect(bridge.cancelCalls).toEqual([]);
  });
});
