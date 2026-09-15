// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createEditor, computeEditorActionContext } from '@nexnote/kernel';
import type { EditorKernelInstance } from '@nexnote/kernel';
import {
  createWritingController,
  useWritingStore,
  writingAiMenuActions,
  writingContextMenu,
  writingSlashItems,
  writingStopControl,
  WRITING_ACTION_MAP,
} from '../src/features/ai/writing';

/**
 * DEV-037 / ADR-0005：请求层断言「仅显式操作发请求」。
 * 在渲染层 IPC 缝隙上放 request-spy：编辑、选区变化、undo/redo、打开预览层、
 * 构建菜单项等常规操作一律不得产生 agent:run:writing；只有显式 AI 动作才发一次。
 */

type Listener = (payload: unknown) => void;

function installSpy() {
  const listeners: Record<string, Set<Listener>> = {};
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload });
      if (channel === 'agent:run:writing') return { ok: true, data: { runId: 'run-1' } };
      if (channel === 'agent:cancel') return { ok: true, data: { cancelled: true } };
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
  const aiRequests = () => calls.filter((c) => c.channel === 'agent:run:writing');
  return { calls, flush, aiRequests };
}

function mountKernel(markdown: string): EditorKernelInstance {
  const container = document.createElement('div');
  document.body.append(container);
  return createEditor(container, { initialMarkdown: markdown, slashMenu: true, dragHandle: false });
}

beforeEach(() => {
  useWritingStore.getState().closeSession();
});

describe('DEV-037 写作请求层零隐式请求', () => {
  it('普通编辑与 UI 变化不触发 provider 请求，仅显式 AI 动作触发一次', async () => {
    const spy = installSpy();
    const kernel = mountKernel('第一句原文。第二句。');
    const controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
    });
    const view = kernel.editor.view;

    // 1) 输入 / 删除 / 粘贴
    view.dispatch(view.state.tr.insertText('新增文字', 1));
    view.dispatch(view.state.tr.delete(1, 3));
    view.dispatch(view.state.tr.insertText('粘贴内容', view.state.selection.to));
    // 2) undo / redo
    kernel.undo();
    kernel.redo();
    // 3) 光标与选区变化
    kernel.editor.chain().setTextSelection({ from: 1, to: 3 }).run();
    kernel.editor.chain().selectAll().run();
    // 4) 斜杠菜单输入（含 AI 分组构建）
    view.dispatch(view.state.tr.insertText('/', view.state.selection.to));
    expect(writingSlashItems(controller)).toHaveLength(6);
    // 5) 工具栏 / 菜单项构建 + 停止控件挂载（纯 UI，不发请求）
    expect(writingAiMenuActions()).toHaveLength(7);
    expect(writingContextMenu({ target: 'selection' })).toHaveLength(1);
    const stop = writingStopControl();
    document.body.append(stop.dom);
    useWritingStore.getState().openSession({
      id: 'ui-only',
      actionId: 'rewrite',
      label: '改写',
      kind: 'replace',
      status: 'streaming',
      original: '',
      generated: '预览内容',
      truncated: false,
      note: null,
      error: null,
      coords: null,
      accept: vi.fn(),
      reject: vi.fn(),
      stop: vi.fn(),
    });
    useWritingStore.getState().closeSession();
    stop.destroy();

    await spy.flush();
    expect(spy.aiRequests()).toHaveLength(0);
    expect(spy.calls.filter((c) => c.channel === 'agent:cancel')).toHaveLength(0);

    // 非 AI 动作 id 经控制器传入也不得发请求（白名单过滤）
    const ctx = computeEditorActionContext(view, 'selection');
    controller.trigger('format:bold', ctx);
    controller.trigger('ai:unknown-action', ctx);
    await spy.flush();
    expect(spy.aiRequests()).toHaveLength(0);

    // 6) 显式 AI 动作：恰好一次，且只带白名单动作 + 选区/上下文
    controller.trigger('ai:rewrite', ctx);
    await spy.flush();
    const requests = spy.aiRequests();
    expect(requests).toHaveLength(1);
    const payload = requests[0]!.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['actionId', 'contextText', 'target']);
    expect(payload.actionId).toBe('rewrite');
    expect(Object.keys(WRITING_ACTION_MAP)).toContain(payload.actionId);
    expect(payload.messages).toBeUndefined();
    for (const forbidden of ['profileId', 'model', 'apiKey', 'params', 'baseUrl']) {
      expect(payload[forbidden]).toBeUndefined();
    }

    useWritingStore.getState().session?.reject();
    kernel.destroy();
  });
});
