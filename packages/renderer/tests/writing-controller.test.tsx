// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createEditor, computeEditorActionContext } from '@nexnote/kernel';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorKernelInstance } from '@nexnote/kernel';
import {
  createWritingController,
  useWritingStore,
  writingSlashItems,
} from '../src/features/ai/writing';

type Listener = (payload: unknown) => void;

function installBridge() {
  const listeners: Record<string, Set<Listener>> = {};
  const startCalls: Array<{ actionId: string; target: string }> = [];
  const cancelCalls: string[] = [];
  let failStart = false;
  let seq = 0;
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'agent:run:writing') {
        if (failStart) return { ok: false, error: 'IPC 断线', code: 'DISCONNECTED' };
        startCalls.push(payload as { actionId: string; target: string });
        seq += 1;
        return { ok: true, data: { runId: `stream-${seq}` } };
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
  const emit = (channel: string, payload: unknown) => {
    listeners[channel]?.forEach((cb) => cb(payload));
  };
  return {
    flush,
    emit,
    startCalls,
    cancelCalls,
    setFailStart: (value: boolean) => {
      failStart = value;
    },
  };
}

type Bridge = ReturnType<typeof installBridge>;

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

async function typeInTipTap(kernel: EditorKernelInstance, text: string): Promise<void> {
  const dom = kernel.editor.view.dom;
  dom.focus();
  for (const character of text) {
    dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: character, bubbles: true, cancelable: true }),
    );
    const at = kernel.editor.view.domAtPos(kernel.editor.state.selection.from);
    const node =
      at.node.nodeType === Node.TEXT_NODE ? (at.node as Text) : document.createTextNode('');
    if (at.node.nodeType === Node.TEXT_NODE) node.insertData(at.offset, character);
    else {
      at.node.insertBefore(node, at.node.childNodes[at.offset] ?? null);
      node.appendData(character);
    }
    const range = document.createRange();
    range.setStart(
      node,
      at.node.nodeType === Node.TEXT_NODE ? at.offset + character.length : character.length,
    );
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    dom.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function setup(markdown = '第一句原文。第二句。', bridge: Bridge = installBridge()) {
  const kernel = mountKernel(markdown);
  const controller = createWritingController({
    getKernel: () => kernel,
    getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
  });
  selectPrefix(kernel);
  const ctx = computeEditorActionContext(kernel.editor.view, 'selection');
  return { bridge, kernel, controller, ctx };
}

const delta = (bridge: Bridge, runId: string, text: string) =>
  bridge.emit('agent:runEvent', { runId, event: { type: 'delta', text } });
const done = (bridge: Bridge, runId: string) =>
  bridge.emit('agent:runEvent', { runId, scenario: 'writing', event: { type: 'done' } });
const fail = (bridge: Bridge, runId: string, message = '上游断线', code = 'STREAM_CLOSED') =>
  bridge.emit('agent:runEvent', { runId, event: { type: 'error', message, code } });

beforeEach(() => {
  useWritingStore.getState().closeSession();
});

describe('DEV-052 slash AI 坐标与启动边界', () => {
  it('真实 /ai 确认后 Accept 在消费后的光标插入，Accept undo 不回退到旧坐标', async () => {
    const bridge = installBridge();
    const host = document.createElement('div');
    document.body.append(host);
    let controller: ReturnType<typeof createWritingController> | null = null;
    const kernel = createEditor(host, {
      initialMarkdown: '正文 ',
      dragHandle: false,
      extraSlashItems: () => (controller ? writingSlashItems(controller) : []),
    });
    controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
    });
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, kernel.editor.state.doc.content.size - 1),
      ),
    );
    const prompt = vi.fn().mockReturnValue('补充');
    window.prompt = prompt;
    await typeInTipTap(kernel, '/ai');
    kernel.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await bridge.flush();
    expect(bridge.startCalls).toHaveLength(1);
    expect(stripAnchors(kernel.getMarkdown())).toBe('正文');
    delta(bridge, 'stream-1', '生成');
    done(bridge, 'stream-1');
    await bridge.flush();
    expect(() => useWritingStore.getState().session?.accept()).not.toThrow();
    expect(stripAnchors(kernel.getMarkdown())).toBe('正文 生成');
    expect(kernel.undo()).toBe(true);
    expect(stripAnchors(kernel.getMarkdown())).toBe('正文');
    delete (window as unknown as { prompt?: unknown }).prompt;
    kernel.destroy();
  });

  it('流式失败保留已生成部分但 trigger 已消费；Reject 不写回', async () => {
    const bridge = installBridge();
    const host = document.createElement('div');
    document.body.append(host);
    let controller: ReturnType<typeof createWritingController> | null = null;
    const kernel = createEditor(host, {
      initialMarkdown: '正文 ',
      dragHandle: false,
      extraSlashItems: () => (controller ? writingSlashItems(controller) : []),
    });
    controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
    });
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, kernel.editor.state.doc.content.size - 1),
      ),
    );
    window.prompt = vi.fn().mockReturnValue('补充');
    await typeInTipTap(kernel, '/ai');
    kernel.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await bridge.flush();
    delta(bridge, 'stream-1', '半句');
    fail(bridge, 'stream-1');
    await bridge.flush();
    expect(useWritingStore.getState().session?.status).toBe('error');
    expect(useWritingStore.getState().session?.generated).toBe('半句');
    expect(stripAnchors(kernel.getMarkdown())).toBe('正文');
    useWritingStore.getState().session?.reject();
    expect(stripAnchors(kernel.getMarkdown())).toBe('正文');
    delete (window as unknown as { prompt?: unknown }).prompt;
    kernel.destroy();
  });

  it('AI Accept 遇到后续文档变更或切换当前页面时不写错位置', async () => {
    const bridge = installBridge();
    const host = document.createElement('div');
    document.body.append(host);
    let active: EditorKernelInstance | null = null;
    let controller: ReturnType<typeof createWritingController> | null = null;
    const kernel = createEditor(host, {
      initialMarkdown: '正文 ',
      dragHandle: false,
      extraSlashItems: () => (controller ? writingSlashItems(controller) : []),
    });
    active = kernel;
    controller = createWritingController({
      getKernel: () => active,
      getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
    });
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, kernel.editor.state.doc.content.size - 1),
      ),
    );
    window.prompt = vi.fn().mockReturnValue('补充');
    await typeInTipTap(kernel, '/ai');
    kernel.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await bridge.flush();
    delta(bridge, 'stream-1', '生成');
    done(bridge, 'stream-1');
    await bridge.flush();
    kernel.editor.view.dispatch(kernel.editor.state.tr.insertText('外部', 1));
    const changed = kernel.getMarkdown();
    expect(() => useWritingStore.getState().session?.accept()).not.toThrow();
    expect(kernel.getMarkdown()).toBe(changed);
    // A second session must not dispatch into the previous page after a tab switch.
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, kernel.editor.state.doc.content.size - 1),
      ),
    );
    await typeInTipTap(kernel, '/ai');
    kernel.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await bridge.flush();
    delta(bridge, 'stream-2', '另页');
    done(bridge, 'stream-2');
    await bridge.flush();
    active = null;
    const beforeSwitch = kernel.getMarkdown();
    expect(() => useWritingStore.getState().session?.accept()).not.toThrow();
    expect(kernel.getMarkdown()).toBe(beforeSwitch);
    delete (window as unknown as { prompt?: unknown }).prompt;
    kernel.destroy();
  });

  it('同一编辑器发生多次文档变化后即使 undo 回旧文本仍不接受旧 AI 锚点', async () => {
    const bridge = installBridge();
    const host = document.createElement('div');
    document.body.append(host);
    let controller: ReturnType<typeof createWritingController> | null = null;
    const kernel = createEditor(host, {
      initialMarkdown: '正文 ',
      dragHandle: false,
      extraSlashItems: () => (controller ? writingSlashItems(controller) : []),
    });
    controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
    });
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, kernel.editor.state.doc.content.size - 1),
      ),
    );
    window.prompt = vi.fn().mockReturnValue('补充');
    await typeInTipTap(kernel, '/ai');
    kernel.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await bridge.flush();
    delta(bridge, 'stream-1', '生成');
    done(bridge, 'stream-1');
    await bridge.flush();
    kernel.editor.view.dispatch(kernel.editor.state.tr.insertText('临时', 1));
    expect(kernel.undo()).toBe(true);
    const before = kernel.getMarkdown();
    useWritingStore.getState().session?.accept();
    expect(kernel.getMarkdown()).toBe(before);
    delete (window as unknown as { prompt?: unknown }).prompt;
    kernel.destroy();
  });

  it('AI 会话跨两个页面后不把生成结果写进另一页', async () => {
    const bridge = installBridge();
    const firstHost = document.createElement('div');
    const secondHost = document.createElement('div');
    document.body.append(firstHost, secondHost);
    let active: EditorKernelInstance | null = null;
    let controller: ReturnType<typeof createWritingController> | null = null;
    const first = createEditor(firstHost, {
      initialMarkdown: '正文 ',
      dragHandle: false,
      extraSlashItems: () => (controller ? writingSlashItems(controller) : []),
    });
    const second = createEditor(secondHost, { initialMarkdown: '另页', dragHandle: false });
    active = first;
    controller = createWritingController({
      getKernel: () => active,
      getContext: () => ({ markdown: active?.getMarkdown() ?? '', backlinks: [] }),
    });
    first.editor.view.dispatch(
      first.editor.state.tr.setSelection(
        TextSelection.create(first.editor.state.doc, first.editor.state.doc.content.size - 1),
      ),
    );
    window.prompt = vi.fn().mockReturnValue('补充');
    await typeInTipTap(first, '/ai');
    first.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await bridge.flush();
    delta(bridge, 'stream-1', '生成');
    done(bridge, 'stream-1');
    await bridge.flush();
    const firstText = first.getMarkdown();
    const secondText = second.getMarkdown();
    active = second;
    useWritingStore.getState().session?.accept();
    expect(first.getMarkdown()).toBe(firstText);
    expect(second.getMarkdown()).toBe(secondText);
    delete (window as unknown as { prompt?: unknown }).prompt;
    first.destroy();
    second.destroy();
  });

  it('真实 /ai prompt 取消保留原文且不启动写作流', async () => {
    const bridge = installBridge();
    const host = document.createElement('div');
    document.body.append(host);
    let controller: ReturnType<typeof createWritingController> | null = null;
    const kernel = createEditor(host, {
      initialMarkdown: '正文 ',
      dragHandle: false,
      extraSlashItems: () => (controller ? writingSlashItems(controller) : []),
    });
    controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
    });
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, kernel.editor.state.doc.content.size - 1),
      ),
    );
    window.prompt = vi.fn().mockReturnValue(null);
    await typeInTipTap(kernel, '/ai');
    kernel.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await bridge.flush();
    expect(stripAnchors(kernel.getMarkdown())).toBe('正文 /ai');
    expect(bridge.startCalls).toHaveLength(0);
    expect(useWritingStore.getState().session).toBeNull();
    delete (window as unknown as { prompt?: unknown }).prompt;
    kernel.destroy();
  });

  it('真实 /ai 的提示取消或写作启动失败保留 trigger', async () => {
    const bridge = installBridge();
    bridge.setFailStart(true);
    const host = document.createElement('div');
    document.body.append(host);
    let controller: ReturnType<typeof createWritingController> | null = null;
    const kernel = createEditor(host, {
      initialMarkdown: '正文 ',
      dragHandle: false,
      extraSlashItems: () => (controller ? writingSlashItems(controller) : []),
    });
    controller = createWritingController({
      getKernel: () => kernel,
      getContext: () => ({ markdown: kernel.getMarkdown(), backlinks: [] }),
    });
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, kernel.editor.state.doc.content.size - 1),
      ),
    );
    const prompt = vi.fn().mockReturnValue('补充');
    window.prompt = prompt;
    await typeInTipTap(kernel, '/ai');
    kernel.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await bridge.flush();
    expect(stripAnchors(kernel.getMarkdown())).toBe('正文 /ai');
    delete (window as unknown as { prompt?: unknown }).prompt;
    kernel.destroy();
  });
});

describe('DEV-037 写作辅助流式状态机（块编辑）', () => {
  it('首片段即显示：runId 返回前到达的 delta 不丢，逐片段增量刷新', async () => {
    const { bridge, kernel, controller, ctx } = setup('第一句原文。第二句。');

    controller.trigger('ai:rewrite', ctx);
    // runId 尚未返回（invoke 未 resolve）就推送首片段：必须缓冲回放，不能等完整响应。
    delta(bridge, 'stream-1', '第一句');
    expect(useWritingStore.getState().session?.generated).toBe('');

    await bridge.flush();
    expect(useWritingStore.getState().session?.status).toBe('streaming');
    expect(useWritingStore.getState().session?.generated).toBe('第一句');

    delta(bridge, 'stream-1', '改写后。');
    await bridge.flush();
    expect(useWritingStore.getState().session?.generated).toBe('第一句改写后。');
    // 增量呈现期间文档未被触碰
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');
  });

  it('Accept 以单事务写回且只有一步 undo；Reject 恢复原文', async () => {
    const { bridge, kernel, controller, ctx } = setup();
    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();
    expect(bridge.startCalls[0]).toMatchObject({ actionId: 'rewrite', target: '第一句原文。' });

    delta(bridge, 'stream-1', '第一句改写后。');
    done(bridge, 'stream-1');
    await bridge.flush();

    const session = useWritingStore.getState().session;
    expect(session?.status).toBe('done');
    // 流式期间文档与撤销栈均未被污染
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');
    expect(kernel.undo()).toBe(false);

    session?.accept();
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句改写后。第二句。');
    expect(kernel.undo()).toBe(true);
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');
    expect(useWritingStore.getState().session).toBeNull();

    kernel.destroy();
  });

  it('追加类 Accept 在块后插入新块且可 undo', async () => {
    const { bridge, kernel, controller, ctx } = setup('已有段落');
    controller.trigger('ai:evidence', ctx);
    await bridge.flush();
    delta(bridge, 'stream-1', '- 论据一\n- 论据二');
    done(bridge, 'stream-1');
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

  it('停止生成：保留已显示内容、标记未完成、可继续 Accept（单 undo）或 Reject', async () => {
    const { bridge, kernel, controller, ctx } = setup();
    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();
    delta(bridge, 'stream-1', '第一句改写后。');
    await bridge.flush();

    useWritingStore.getState().session?.stop();
    await bridge.flush();

    const session = useWritingStore.getState().session;
    // 会话不关闭：内容保留 + 未完成标记，等待用户裁决
    expect(session).not.toBeNull();
    expect(session?.status).toBe('cancelled');
    expect(session?.generated).toBe('第一句改写后。');
    expect(bridge.cancelCalls).toContain('stream-1');
    // 文档保持原文，撤销栈未被流式过程污染
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');
    expect(kernel.undo()).toBe(false);

    // 已生成部分仍可接受：单事务、单 undo
    session?.accept();
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句改写后。第二句。');
    expect(kernel.undo()).toBe(true);
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');

    kernel.destroy();
  });

  it('停止后 Reject 丢弃会话，原文不变', async () => {
    const { bridge, kernel, controller, ctx } = setup();
    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();
    delta(bridge, 'stream-1', '半句话');
    await bridge.flush();

    useWritingStore.getState().session?.stop();
    await bridge.flush();
    useWritingStore.getState().session?.reject();

    expect(useWritingStore.getState().session).toBeNull();
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');
    expect(kernel.undo()).toBe(false);
    kernel.destroy();
  });

  it('失败（provider 报错）保留已显示内容并标记未完成，Reject 恢复原文', async () => {
    const { bridge, kernel, controller, ctx } = setup();
    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();
    delta(bridge, 'stream-1', '第一句改');
    await bridge.flush();
    fail(bridge, 'stream-1', '网络中断', 'ECONNRESET');
    await bridge.flush();

    const session = useWritingStore.getState().session;
    expect(session).not.toBeNull();
    expect(session?.status).toBe('error');
    expect(session?.generated).toBe('第一句改');
    expect(session?.error).toBe('网络中断（ECONNRESET）');
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');

    session?.reject();
    expect(useWritingStore.getState().session).toBeNull();
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');
    kernel.destroy();
  });

  it('失败（起始请求断线）也会打开会话并标记未完成，可 Reject 退出', async () => {
    const bridge = installBridge();
    const { kernel, controller, ctx } = setup('第一句原文。第二句。', bridge);
    bridge.setFailStart(true);

    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();

    const session = useWritingStore.getState().session;
    expect(session?.status).toBe('error');
    expect(session?.error).toContain('IPC 断线');
    expect(stripAnchors(kernel.getMarkdown())).toBe('第一句原文。第二句。');

    session?.reject();
    expect(useWritingStore.getState().session).toBeNull();
    kernel.destroy();
  });

  it('停止后迟到的终态事件不覆盖 cancelled 状态', async () => {
    const { bridge, kernel, controller, ctx } = setup();
    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();
    delta(bridge, 'stream-1', '内容');
    await bridge.flush();
    useWritingStore.getState().session?.stop();
    // 上游 abort 引发的 error 事件可能后到：不得把用户主动停止改写成失败
    fail(bridge, 'stream-1', '已取消', 'CANCELLED');
    await bridge.flush();

    expect(useWritingStore.getState().session?.status).toBe('cancelled');
    expect(useWritingStore.getState().session?.generated).toBe('内容');
    kernel.destroy();
  });

  it('终态事件早于 runId 返回时也不丢（避免永久 streaming）', async () => {
    const { bridge, kernel, controller, ctx } = setup();
    controller.trigger('ai:rewrite', ctx);
    done(bridge, 'stream-1');
    await bridge.flush();
    expect(useWritingStore.getState().session?.status).toBe('done');
    kernel.destroy();
  });

  it('生成中再次触发会取消上一路流（同一时刻只有一个写作流）', async () => {
    const { bridge, kernel, controller, ctx } = setup();
    controller.trigger('ai:rewrite', ctx);
    await bridge.flush();
    delta(bridge, 'stream-1', '第一路');
    await bridge.flush();

    controller.trigger('ai:polish', ctx);
    await bridge.flush();

    expect(bridge.startCalls).toHaveLength(2);
    expect(bridge.cancelCalls).toContain('stream-1');
    expect(useWritingStore.getState().session?.actionId).toBe('polish');
    // 被顶掉那一路的后续片段不再污染新会话
    delta(bridge, 'stream-1', '（旧流残留）');
    await bridge.flush();
    expect(useWritingStore.getState().session?.generated).toBe('');
    kernel.destroy();
  });

  it('无目标文本的整块/选区触发不发出请求（显式意图前置校验）', async () => {
    const { bridge, kernel, controller } = setup('原句。');
    const emptyCtx = {
      ...computeEditorActionContext(kernel.editor.view, 'selection'),
      text: '   ',
    };
    controller.trigger('ai:rewrite', emptyCtx);
    await bridge.flush();
    expect(bridge.startCalls).toHaveLength(0);
    expect(useWritingStore.getState().session).toBeNull();
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
});
