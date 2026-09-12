// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { undo } from '@codemirror/commands';
import { createSourceEditor, type SourceEditorHandle } from '../src/editor/source/codemirror-host';
import { sourceSelectionBubble } from '../src/editor/source/source-bubble';
import {
  handleSourceBubbleAction,
  SOURCE_CHAT_ASK_ACTION,
} from '../src/editor/source/source-ai-assist';
import { useWritingStore } from '../src/features/ai/writing';
import { useChatStore } from '../src/features/ai/chat/chat-store';
import { useUiStore } from '../src/stores/ui-store';

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

function makeRect(init: {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    top: init.top,
    left: init.left,
    right: init.right,
    bottom: init.bottom,
    width: init.width,
    height: init.height,
    x: init.left,
    y: init.top,
    toJSON: () => ({}),
  } as DOMRect;
}

function mount(initialText: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  // 模拟定位锚点（source-editor-pane）在视口原点、宽 800
  parent.getBoundingClientRect = () =>
    makeRect({ top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 });
  const editor: SourceEditorHandle = createSourceEditor(parent, {
    initialText,
    onChange: () => undefined,
    extraExtensions: [
      sourceSelectionBubble({
        actions: [
          { id: 'ai:rewrite', title: '改写' },
          { id: SOURCE_CHAT_ASK_ACTION, title: '询问 AI' },
        ],
        onAction: (id, ctx) =>
          handleSourceBubbleAction(editor.view, id, ctx, { getDocPath: () => 'Notes/测试.md' }),
      }),
    ],
  });
  return { parent, editor };
}

/** 选中 [from,to) 并注入坐标桩（happy-dom 无布局）。 */
function selectWithCoords(
  editor: SourceEditorHandle,
  parent: HTMLElement,
  from: number,
  to: number,
  coords: { top: number; left: number; right: number; bottom: number },
) {
  Object.defineProperty(
    parent.querySelector<HTMLElement>('[data-source-selection-bubble]'),
    'offsetWidth',
    { configurable: true, value: 120 },
  );
  Object.defineProperty(
    parent.querySelector<HTMLElement>('[data-source-selection-bubble]'),
    'offsetHeight',
    { configurable: true, value: 32 },
  );
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue(coords);
  editor.view.dispatch({ selection: { anchor: from, head: to } });
}

function bubbleOf(parent: HTMLElement): HTMLElement {
  const bubble = parent.querySelector<HTMLElement>('[data-source-selection-bubble]');
  expect(bubble).toBeTruthy();
  return bubble as HTMLElement;
}

const flushMicro = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  useWritingStore.getState().closeSession();
  useChatStore.getState().reset();
});

afterEach(() => {
  useWritingStore.getState().closeSession();
  document.body.innerHTML = '';
});

describe('源码模式划词工具栏（CodeMirror selection bubble）', () => {
  it('非空选区时在选区上方 8px 出现，水平收在容器内', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 3000, left: 700, right: 720, bottom: 3024 });
    const bubble = bubbleOf(parent);
    expect(bubble.style.display).not.toBe('none');
    // 底边距选区起点 top 8px（3000-8），水平中心钳制在容器半宽内（700+60 ≤ 800）
    expect(bubble.style.top).toBe(`${3000 - 8}px`);
    const center = Number.parseFloat(bubble.style.left);
    expect(center).toBe(700);
    editor.destroy();
  });

  it('选区折叠/为空隐藏；Esc 关闭；focusout 隐藏', () => {
    const { parent, editor } = mount('第一句原文。  \n第二句。');
    const bubble = bubbleOf(parent);
    expect(bubble.style.display).toBe('none');

    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    expect(bubble.style.display).not.toBe('none');

    // 折叠光标
    editor.view.dispatch({ selection: { anchor: 0, head: 0 } });
    expect(bubble.style.display).toBe('none');

    // 纯空白选区（两个空格）
    selectWithCoords(editor, parent, 6, 8, { top: 300, left: 100, right: 120, bottom: 320 });
    expect(bubble.style.display).toBe('none');

    // Esc 关闭
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    expect(bubble.style.display).not.toBe('none');
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(bubble.style.display).toBe('none');

    // 失焦隐藏
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    expect(bubble.style.display).not.toBe('none');
    editor.view.dom.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }));
    expect(bubble.style.display).toBe('none');
    editor.destroy();
  });

  it('滚动后按新视口坐标重算，仍以包含块为参照', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 400, left: 100, right: 120, bottom: 424 });
    const bubble = bubbleOf(parent);
    expect(bubble.style.top).toBe(`${400 - 8}px`);

    // 滚动 160px：视口坐标上移，scroll（document 捕获）触发重算
    (editor.view.coordsAtPos as ReturnType<typeof vi.fn>).mockReturnValue({
      top: 240,
      left: 100,
      right: 120,
      bottom: 264,
    });
    parent.dispatchEvent(new Event('scroll'));
    expect(bubble.style.top).toBe(`${240 - 8}px`);
    editor.destroy();
  });

  it('点击「询问 AI」走 chat queueAsk 带选区并展开 dock', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf(parent);
    const btn = bubble.querySelector<HTMLButtonElement>(
      `[data-bubble-action="${SOURCE_CHAT_ASK_ACTION}"]`,
    );
    expect(btn).toBeTruthy();
    btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(useChatStore.getState().pendingAsk).toEqual({
      selectionText: '第一句原文。',
      docTitle: '测试',
      docPath: 'Notes/测试.md',
    });
    expect(useUiStore.getState().activeDockPanelId).toBe('ai-chat');
    // 触发动作后工具栏隐藏
    expect(bubble.style.display).toBe('none');
    editor.destroy();
  });

  it('写作动作流式预览：Accept 单事务替换选区且可 undo', async () => {
    const bridge = installBridge();
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf(parent);
    const btn = bubble.querySelector<HTMLButtonElement>('[data-bubble-action="ai:rewrite"]');
    btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await bridge.flush();

    expect(bridge.startCalls).toHaveLength(1);
    expect(bridge.startCalls[0]).toMatchObject({ actionId: 'rewrite', target: '第一句原文。' });
    const session = useWritingStore.getState().session;
    expect(session?.status).toBe('streaming');

    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      event: { type: 'delta', text: '第一句润色完成。' },
    });
    bridge.emit('agent:runEvent', { runId: 'stream-1', event: { type: 'done' } });
    await flushMicro();
    expect(useWritingStore.getState().session?.generated).toBe('第一句润色完成。');

    // Accept：单事务替换选区
    useWritingStore.getState().session?.accept();
    expect(editor.getText()).toBe('第一句润色完成。第二句。');
    expect(useWritingStore.getState().session).toBeNull();
    // 可 undo（单个 CodeMirror 事务）
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('第一句原文。第二句。');
    editor.destroy();
  });

  it('Reject 取消流且源码不变', async () => {
    const bridge = installBridge();
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf(parent);
    const btn = bubble.querySelector<HTMLButtonElement>('[data-bubble-action="ai:rewrite"]');
    btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await bridge.flush();

    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      event: { type: 'delta', text: '不应写入的内容' },
    });
    await flushMicro();
    useWritingStore.getState().session?.reject();
    await flushMicro();

    expect(editor.getText()).toBe('第一句原文。第二句。');
    expect(useWritingStore.getState().session).toBeNull();
    expect(bridge.cancelCalls).toContain('stream-1');
    editor.destroy();
  });
});
