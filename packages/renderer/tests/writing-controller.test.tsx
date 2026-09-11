// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createEditor, computeEditorActionContext } from '@nexnote/kernel';
import type { EditorKernelInstance } from '@nexnote/kernel';
import { createWritingController, useWritingStore } from '../src/features/ai/writing';

interface StreamListener {
  (payload: unknown): void;
}

function installBridge() {
  const listeners: Record<string, Set<StreamListener>> = {};
  const startCalls: unknown[] = [];
  const cancelCalls: string[] = [];
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'agent:run:writing') {
        startCalls.push(payload);
        return { ok: true, data: { runId: 'stream-1' } };
      }
      if (channel === 'agent:cancel') {
        cancelCalls.push((payload as { runId: string }).runId);
        return { ok: true, data: { cancelled: true } };
      }
      return { ok: true, data: null };
    }),
    on: (channel: string, cb: StreamListener) => {
      const set = listeners[channel] ?? new Set<StreamListener>();
      set.add(cb);
      listeners[channel] = set;
      return () => set.delete(cb);
    },
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const emit = (channel: string, payload: unknown) => {
    listeners[channel]?.forEach((cb) => cb(payload));
  };
  return { flush, emit, startCalls, cancelCalls };
}

function mountKernel(markdown: string): EditorKernelInstance {
  const container = document.createElement('div');
  document.body.append(container);
  return createEditor(container, {
    initialMarkdown: markdown,
    slashMenu: false,
    dragHandle: false,
  });
}

function selectPrefix(kernel: EditorKernelInstance, chars = 6) {
  const first = kernel.editor.view.state.doc.child(0);
  const to = Math.min(1 + chars, first.nodeSize - 1);
  kernel.editor.chain().setTextSelection({ from: 1, to }).run();
}

const stripAnchors = (md: string) => md.replace(/[ \t]*\^[A-Za-z0-9]+/g, '').trim();

beforeEach(() => {
  useWritingStore.getState().closeSession();
});

describe('写作辅助控制器（流式 → diff → 回写）', () => {
  it('流式生成后 Accept 正确替换选区且可 undo，Reject 原文不变', async () => {
    const bridge = installBridge();
    const kernel = mountKernel('第一句原文。第二句。');
    const controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
    });

    selectPrefix(kernel);
    const ctx = computeEditorActionContext(kernel.editor.view, 'selection');
    expect(ctx.target).toBe('selection');

    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();
    expect(bridge.startCalls).toHaveLength(1);
    const startPayload = bridge.startCalls[0] as { messages: unknown[] };
    expect(startPayload.messages).toHaveLength(2);

    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      event: { type: 'delta', text: '第一句改写后。' },
    });
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'writing',
      event: { type: 'done' },
    });
    await bridge.flush();

    let session = useWritingStore.getState().session;
    expect(session).toBeTruthy();
    expect(session?.status).toBe('done');
    expect(session?.generated).toBe('第一句改写后。');

    // Accept：替换选区（单事务），原文被替换
    session?.accept();
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句改写后。第二句。');
    // 可撤销
    expect(kernel.undo()).toBe(true);
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');

    // Reject 路径：新会话拒绝，原文不变
    useWritingStore.getState().closeSession();
    selectPrefix(kernel);
    const ctx2 = computeEditorActionContext(kernel.editor.view, 'selection');
    controller.trigger('ai:polish', ctx2);
    await bridge.flush();
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      event: { type: 'delta', text: '不应写入的内容' },
    });
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'writing',
      event: { type: 'done' },
    });
    await bridge.flush();
    session = useWritingStore.getState().session;
    session?.reject();
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');
    expect(useWritingStore.getState().session).toBeNull();

    kernel.destroy();
  });

  it('追加类动作 Accept 在块后插入新块且可 undo', async () => {
    const bridge = installBridge();
    const kernel = mountKernel('已有段落');
    const controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
    });

    selectPrefix(kernel);
    const ctx = computeEditorActionContext(kernel.editor.view, 'selection');
    controller.trigger('ai:evidence', ctx);
    await bridge.flush();
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      event: { type: 'delta', text: '- 论据一\n- 论据二' },
    });
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'writing',
      event: { type: 'done' },
    });
    await bridge.flush();

    const session = useWritingStore.getState().session;
    expect(session?.kind).toBe('append');
    session?.accept();
    const md = stripAnchors(kernel.getMarkdown());
    expect(md).toContain('已有段落');
    expect(md).toContain('论据一');
    expect(md).toContain('论据二');
    kernel.undo();
    expect(stripAnchors(kernel.getMarkdown())).toBe('已有段落');

    kernel.destroy();
  });

  it('长上下文截断时会话携带截断提示', async () => {
    const bridge = installBridge();
    const kernel = mountKernel('原文');
    const controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: '很'.repeat(8000), backlinks: [] }),
      budgetChars: 300,
    });
    selectPrefix(kernel);
    const ctx = computeEditorActionContext(kernel.editor.view, 'selection');
    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();
    const session = useWritingStore.getState().session;
    expect(session?.truncated).toBe(true);
    expect(session?.note).toBe('上下文过长，已截断');
    kernel.destroy();
  });

  it('取消流式会向上游发送 cancel', async () => {
    const bridge = installBridge();
    const kernel = mountKernel('原文内容');
    const controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: '', backlinks: [] }),
    });
    selectPrefix(kernel);
    const ctx = computeEditorActionContext(kernel.editor.view, 'selection');
    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();
    useWritingStore.getState().session?.cancel();
    await bridge.flush();
    expect(bridge.cancelCalls).toContain('stream-1');
    expect(useWritingStore.getState().session).toBeNull();
    kernel.destroy();
  });
});
