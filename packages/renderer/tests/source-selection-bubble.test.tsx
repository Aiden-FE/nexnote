// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { undo } from '@codemirror/commands';
import { createSourceEditor, type SourceEditorHandle } from '../src/editor/source/codemirror-host';
import { sourceSelectionBubble } from '../src/editor/source/source-bubble';
import {
  applySourceFormat,
  sourceFormatBubbleActions,
} from '../src/editor/source/source-formatting';
import {
  handleSourceBubbleAction,
  SOURCE_CHAT_ASK_ACTION,
} from '../src/editor/source/source-ai-assist';
import {
  useWritingStore,
  writingAiMenuActions,
  writingStopControl,
} from '../src/features/ai/writing';
import { TRANSLATE_SELECTION_ACTION_ID } from '../src/features/ai/translation';
import { createEditor } from '@nexnote/kernel';
import { TextSelection } from '@tiptap/pm/state';
import { formatBubbleActions } from '../src/editor/interactions/formatting';
import { useChatStore } from '../src/features/ai/chat/chat-store';
import { useUiStore } from '../src/stores/ui-store';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import { getActiveSourceEditor } from '../src/editor/source/active-source-editor';
import type { TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function mount(
  initialText: string,
  overrides: {
    actions?: ReturnType<typeof sourceFormatBubbleActions>;
    onAction?: Parameters<typeof sourceSelectionBubble>[0]['onAction'];
  } = {},
) {
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
        // 与 SourceModeView 相同：格式化/双链平铺，写作与询问 AI 收口下拉。
        actions: overrides.actions ?? sourceFormatBubbleActions(),
        aiMenu: { label: 'AI', actions: writingAiMenuActions() },
        extraControl: writingStopControl(),
        onAction:
          overrides.onAction ??
          ((id, ctx) => {
            if (applySourceFormat(editor.view, id)) return;
            handleSourceBubbleAction(editor.view, id, ctx, { getDocPath: () => 'Notes/测试.md' });
          }),
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
    document.querySelector<HTMLElement>('[data-source-selection-bubble]'),
    'offsetWidth',
    { configurable: true, value: 120 },
  );
  Object.defineProperty(
    document.querySelector<HTMLElement>('[data-source-selection-bubble]'),
    'offsetHeight',
    { configurable: true, value: 32 },
  );
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue(coords);
  editor.view.dispatch({ selection: { anchor: from, head: to } });
}

function bubbleOf(): HTMLElement {
  const bubble = document.querySelector<HTMLElement>('[data-source-selection-bubble]');
  expect(bubble).toBeTruthy();
  return bubble as HTMLElement;
}

const flushMicro = () => new Promise((r) => setTimeout(r, 0));
/** 等待一帧：工具栏定位发生在 rAF 帧循环（update 事务内禁止布局读取）。 */
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

beforeEach(() => {
  useWritingStore.getState().closeSession();
  useChatStore.getState().reset();
});

afterEach(() => {
  useWritingStore.getState().closeSession();
  document.body.innerHTML = '';
});

describe('源码模式划词工具栏（CodeMirror selection bubble）', () => {
  it('非空选区时在选区上方 8px 出现，水平收在容器内', async () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 3000, left: 700, right: 720, bottom: 3024 });
    const bubble = bubbleOf();
    expect(bubble.style.display).not.toBe('none');
    await nextFrame();
    // 底边距选区起点 top 8px（3000-8），水平中心钳制在容器半宽内（700+60 ≤ 800）
    expect(bubble.style.top).toBe(`${3000 - 8}px`);
    const center = Number.parseFloat(bubble.style.left);
    expect(center).toBe(700);
    editor.destroy();
  });

  it('选区折叠/为空隐藏；Esc 关闭；focusout 隐藏', () => {
    const { parent, editor } = mount('第一句原文。  \n第二句。');
    const bubble = bubbleOf();
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

  it('滚动后按新视口坐标重算，仍以包含块为参照', async () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 400, left: 100, right: 120, bottom: 424 });
    const bubble = bubbleOf();
    await nextFrame();
    expect(bubble.style.top).toBe(`${400 - 8}px`);

    // 滚动 160px：视口坐标上移，scroll（document 捕获）触发重算
    (editor.view.coordsAtPos as ReturnType<typeof vi.fn>).mockReturnValue({
      top: 240,
      left: 100,
      right: 120,
      bottom: 264,
    });
    parent.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(bubble.style.top).toBe(`${240 - 8}px`);
    editor.destroy();
  });

  it('update() 内不做布局读取：dispatch 期间 coordsAtPos 抛守卫错误也不销毁插件', async () => {
    const { editor } = mount('第一句原文。第二句。');
    const bubble = bubbleOf();
    Object.defineProperty(bubble, 'offsetWidth', { configurable: true, value: 120 });
    Object.defineProperty(bubble, 'offsetHeight', { configurable: true, value: 32 });
    // 忠实模拟 CodeMirror 守卫：事务提交（插件 update）期间读取布局即抛错。
    // 历史缺陷：update→sync→coordsAtPos 违规 → CodeMirror 销毁插件 → 工具栏永久消失。
    let inDispatch = false;
    const coords = { top: 300, left: 100, right: 120, bottom: 320 };
    vi.spyOn(editor.view, 'coordsAtPos').mockImplementation(() => {
      if (inDispatch) {
        throw new Error("Reading the editor layout isn't allowed during an update");
      }
      return coords;
    });
    inDispatch = true;
    expect(() => editor.view.dispatch({ selection: { anchor: 0, head: 6 } })).not.toThrow();
    inDispatch = false;
    // 插件存活：元素仍在 body 且显示
    expect(document.querySelector('[data-source-selection-bubble]')).not.toBeNull();
    expect(bubble.style.display).not.toBe('none');
    await nextFrame();
    expect(bubble.style.top).toBe(`${300 - 8}px`);
    // 插件仍响应后续事务（销毁后不会再响应）
    editor.view.dispatch({ selection: { anchor: 0, head: 0 } });
    expect(bubble.style.display).toBe('none');
    editor.destroy();
  });

  it('点击「询问 AI」走 chat queueAsk 带选区并展开 dock', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf();
    const btn = bubble.querySelector<HTMLButtonElement>(
      `[data-ai-menu-action="${SOURCE_CHAT_ASK_ACTION}"]`,
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
    const bubble = bubbleOf();
    const btn = bubble.querySelector<HTMLButtonElement>('[data-ai-menu-action="ai:rewrite"]');
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
    const bubble = bubbleOf();
    const btn = bubble.querySelector<HTMLButtonElement>('[data-ai-menu-action="ai:rewrite"]');
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

  it('AI 六项 + 询问 AI + 划词翻译收口为单一入口，两模式共用的按钮集完整且顺序稳定', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf();
    const flatIds = Array.from(bubble.querySelectorAll('[data-bubble-action]')).map(
      (b) => (b as HTMLElement).dataset.bubbleAction,
    );
    expect(flatIds.slice(0, 6)).toEqual([
      'format:bold',
      'format:italic',
      'format:strike',
      'format:code',
      'format:link',
      'format:wikilink',
    ]);
    expect(flatIds).toContain('ai:menu');
    expect(flatIds).not.toContain('ai:rewrite');
    expect(flatIds).not.toContain(SOURCE_CHAT_ASK_ACTION);

    const menuIds = Array.from(bubble.querySelectorAll('[data-ai-menu-action]')).map(
      (b) => (b as HTMLElement).dataset.aiMenuAction,
    );
    expect(menuIds).toEqual([
      'ai:rewrite',
      'ai:polish',
      'ai:condense',
      'ai:expand',
      'ai:fillgaps',
      'ai:evidence',
      SOURCE_CHAT_ASK_ACTION,
      TRANSLATE_SELECTION_ACTION_ID,
    ]);
    expect(bubble.querySelector('[data-ai-dropdown]')).not.toBeNull();
    editor.destroy();
  });
});

describe('DEV-023 源码模式划词格式化（Markdown 包裹写回）', () => {
  it('点击加粗：Markdown 包裹选区，写回后仍选中原文本，单次 undo 整体撤销', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const btn = bubbleOf().querySelector<HTMLButtonElement>('[data-bubble-action="format:bold"]');
    btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(editor.getText()).toBe('**第一句原文。**第二句。');
    const sel = editor.view.state.selection.main;
    expect(sel.from).toBe(2);
    expect(sel.to).toBe(8);
    // 单事务写回：一次 undo 回到原文
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('第一句原文。第二句。');
    editor.destroy();
  });

  it('斜体/删除线/行内代码同样映射 Markdown 语法', () => {
    const cases: Array<[string, string]> = [
      ['format:italic', '*第一句原文。*第二句。'],
      ['format:strike', '~~第一句原文。~~第二句。'],
      ['format:code', '`第一句原文。`第二句。'],
    ];
    for (const [id, expected] of cases) {
      const { parent, editor } = mount('第一句原文。第二句。');
      selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
      const btn = bubbleOf().querySelector<HTMLButtonElement>(`[data-bubble-action="${id}"]`);
      btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(editor.getText(), id).toBe(expected);
      expect(undo(editor.view), id).toBe(true);
      expect(editor.getText(), id).toBe('第一句原文。第二句。');
      editor.destroy();
    }
  });

  it('链接：沿用块编辑 window.prompt 入 URL；取消则源码不变', () => {
    // happy-dom 无 window.prompt：按既有交互直接桩
    const promptMock = vi.fn((): string | null => 'https://example.com');
    window.prompt = promptMock as typeof window.prompt;
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const btn = bubbleOf().querySelector<HTMLButtonElement>('[data-bubble-action="format:link"]');
    btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe('[第一句原文。](https://example.com)第二句。');
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('第一句原文。第二句。');

    // 取消输入：无写回
    promptMock.mockReturnValueOnce(null);
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(editor.getText()).toBe('第一句原文。第二句。');
    editor.destroy();
  });

  it('双链：选区文本包 [[…]]，不弹 URL 输入', () => {
    const promptMock = vi.fn((): string | null => null);
    window.prompt = promptMock as typeof window.prompt;
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const btn = bubbleOf().querySelector<HTMLButtonElement>(
      '[data-bubble-action="format:wikilink"]',
    );
    btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(promptMock).not.toHaveBeenCalled();
    expect(editor.getText()).toBe('[[第一句原文。]]第二句。');
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('第一句原文。第二句。');
    editor.destroy();
  });

  it('双链与外链使用不同纯图标、准确 aria-label 和非原生 tooltip', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf();
    const link = bubble.querySelector<HTMLElement>('[data-bubble-action="format:link"]');
    const wiki = bubble.querySelector<HTMLElement>('[data-bubble-action="format:wikilink"]');
    expect(link?.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('link');
    expect(wiki?.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('wikilink');
    expect(link?.getAttribute('aria-label')).toBe('外链');
    expect(wiki?.getAttribute('aria-label')).toBe('双链');
    expect(link?.hasAttribute('title')).toBe(false);
    expect(wiki?.hasAttribute('title')).toBe(false);
    expect(link?.querySelector('[role="tooltip"]')?.textContent).toContain('⌘K');
    expect(wiki?.querySelector('[role="tooltip"]')?.textContent).toContain('双链');
    editor.destroy();
  });

  it('CRLF 文件：写回只包裹选区，不动缓冲区内其它换行字节（CM 行模型）', () => {
    // CodeMirror 装载时把 \r\n 归一为 \n（既有行模型）：格式化写回不得再改动
    // 缓冲区内任何其它字节（换行仍为单个 \n，无重复/丢失），undo 后还原装载态。
    const { parent, editor } = mount('第一行\r\n第二行');
    const loaded = editor.getText();
    selectWithCoords(editor, parent, 0, 3, { top: 300, left: 100, right: 120, bottom: 320 });
    const btn = bubbleOf().querySelector<HTMLButtonElement>('[data-bubble-action="format:bold"]');
    btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(editor.getText()).toBe(`**第一行**${loaded.slice(3)}`);
    expect(editor.getText().split('\n')).toHaveLength(2);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe(loaded);
    editor.destroy();
  });
});

describe('DEV-023 无选区格式化骨架（applySourceFormat 直接作用于折叠光标）', () => {
  it('空选区插入语法骨架，光标落在待填位置，单次 undo 撤销', () => {
    const cases: Array<[string, string, string]> = [
      ['format:bold', '****第一句原文。', ''],
      ['format:italic', '**第一句原文。', ''],
      ['format:strike', '~~~~第一句原文。', ''],
      ['format:code', '``第一句原文。', ''],
      ['format:wikilink', '[[页面名]]第一句原文。', '页面名'],
    ];
    for (const [id, expected, selected] of cases) {
      const { editor } = mount('第一句原文。');
      editor.view.dispatch({ selection: { anchor: 0, head: 0 } });
      expect(applySourceFormat(editor.view, id), id).toBe(true);
      expect(editor.getText(), id).toBe(expected);
      const sel = editor.view.state.selection.main;
      if (selected) {
        expect([sel.from, sel.to], id).toEqual([2, 2 + selected.length]);
      } else {
        expect(sel.from, id).toBe(sel.to);
        expect(sel.from, id).toBeGreaterThan(0);
      }
      expect(undo(editor.view), id).toBe(true);
      expect(editor.getText(), id).toBe('第一句原文。');
      editor.destroy();
    }
  });

  it('空选区链接：入 URL 后插入 [](url)，光标在 [] 内；取消不写回', () => {
    const promptMock = vi.fn((): string | null => 'https://example.com');
    window.prompt = promptMock as typeof window.prompt;
    const { editor } = mount('第一句原文。');
    editor.view.dispatch({ selection: { anchor: 0, head: 0 } });
    expect(applySourceFormat(editor.view, 'format:link')).toBe(true);
    expect(editor.getText()).toBe('[](https://example.com)第一句原文。');
    const sel = editor.view.state.selection.main;
    expect(sel.from).toBe(1);
    expect(sel.to).toBe(1);
    expect(undo(editor.view)).toBe(true);

    promptMock.mockReturnValueOnce(null);
    expect(applySourceFormat(editor.view, 'format:link')).toBe(true);
    expect(editor.getText()).toBe('第一句原文。');
    editor.destroy();
  });

  it('非格式化 id 返回 false（交回 AI/询问 AI 分派）', () => {
    const { editor } = mount('第一句原文。');
    expect(applySourceFormat(editor.view, 'ai:rewrite')).toBe(false);
    expect(applySourceFormat(editor.view, SOURCE_CHAT_ASK_ACTION)).toBe(false);
    expect(editor.getText()).toBe('第一句原文。');
    editor.destroy();
  });
});

describe('DEV-034 划词工具栏 AI 下拉（源码模式）', () => {
  const menuOf = (): HTMLElement => {
    const menu = bubbleOf().querySelector<HTMLElement>('[data-ai-menu]');
    expect(menu).toBeTruthy();
    return menu as HTMLElement;
  };
  const triggerOf = (): HTMLButtonElement => {
    const trigger = bubbleOf().querySelector<HTMLButtonElement>('[data-bubble-action="ai:menu"]');
    expect(trigger).toBeTruthy();
    return trigger as HTMLButtonElement;
  };
  const key = (el: HTMLElement, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('单一 AI 入口：六个写作动作 + 询问 AI 收在菜单内，工具栏只剩平铺格式化/双链', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf();
    const flat = Array.from(bubble.querySelectorAll('[data-bubble-action]')).map(
      (b) => (b as HTMLElement).dataset.bubbleAction,
    );
    expect(flat).toEqual([
      'format:bold',
      'format:italic',
      'format:strike',
      'format:code',
      'format:link',
      'format:wikilink',
      'ai:menu',
      // 停止控件也是工具栏动作（非流式时 hidden+disabled）
      'ai:stop',
    ]);
    const menuIds = Array.from(bubble.querySelectorAll('[data-ai-menu-action]')).map(
      (b) => (b as HTMLElement).dataset.aiMenuAction,
    );
    expect(menuIds).toEqual(writingAiMenuActions().map((a) => a.id));
    // 快捷键提示保留在菜单项上（下拉不吞掉可发现性）
    const rewrite = bubble.querySelector<HTMLElement>('[data-ai-menu-action="ai:rewrite"]');
    expect(rewrite?.querySelector('.nexnote-selection-bubble__shortcut')?.textContent).toBe('⌘⌥R');
    expect(menuOf().hidden).toBe(true);
    editor.destroy();
  });

  it('纯图标格式化、Sparkles + AI + chevron、Tooltip 和 roving 工具栏键盘行为一致', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf();
    const bold = bubble.querySelector<HTMLButtonElement>('[data-bubble-action="format:bold"]')!;
    const italic = bubble.querySelector<HTMLButtonElement>('[data-bubble-action="format:italic"]')!;
    const ai = triggerOf();
    expect(bold.textContent).toBe('粗体（⌘B）');
    expect(bold.querySelector('[data-icon="bold"]')).toBeTruthy();
    expect(bold.getAttribute('aria-label')).toBe('粗体');
    expect(bold.querySelector('[role="tooltip"]')?.textContent).toBe('粗体（⌘B）');
    expect(ai.querySelector('[data-icon="sparkles"]')).toBeTruthy();
    expect(ai.querySelector('.nexnote-selection-bubble__ai-label')?.textContent).toBe('AI');
    expect(ai.querySelector('.nexnote-selection-bubble__chevron')).toBeTruthy();

    const tooltip = bold.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.hidden).toBe(true);
    bold.dispatchEvent(new PointerEvent('pointerenter'));
    expect(tooltip.hidden).toBe(false);
    bold.dispatchEvent(new PointerEvent('pointerleave'));
    expect(tooltip.hidden).toBe(true);
    bold.focus();
    expect(tooltip.hidden).toBe(false);
    key(bold, 'Escape');
    expect(tooltip.hidden).toBe(true);
    expect(bubble.style.display).not.toBe('none');

    key(bold, 'ArrowRight');
    expect(document.activeElement).toBe(italic);
    key(italic, 'End');
    expect(document.activeElement).toBe(ai);
    key(ai, 'Home');
    expect(document.activeElement).toBe(bold);
    editor.destroy();
  });

  it('CodeMirror real DOM dispatches format and AI shortcuts, consumes Mod+E, and honors dynamic disabled', () => {
    const onAction = vi.fn();
    let disabled = false;
    const actions = sourceFormatBubbleActions().map((action) =>
      action.id === 'format:code' ? { ...action, disabled: () => disabled } : action,
    );
    const { parent, editor } = mount('第一句原文。第二句。', { actions, onAction });
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });

    const code = new KeyboardEvent('keydown', {
      key: 'e',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(code);
    expect(code.defaultPrevented).toBe(true);
    expect(onAction).toHaveBeenCalledWith(
      'format:code',
      expect.objectContaining({ text: '第一句原文。' }),
    );

    disabled = true;
    const blocked = new KeyboardEvent('keydown', {
      key: 'e',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    expect(onAction).toHaveBeenCalledTimes(1);

    const ai = new KeyboardEvent('keydown', {
      key: 'r',
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(ai);
    expect(ai.defaultPrevented).toBe(true);
    expect(onAction).toHaveBeenLastCalledWith('ai:rewrite', expect.any(Object));
    editor.destroy();
  });

  it('CodeMirror uses one top-level tabstop, repairs it after hidden/disabled changes, and closes on external focusout', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf();
    const top = () =>
      Array.from(
        bubble.querySelectorAll<HTMLButtonElement>(
          ':scope > button:not([hidden]), :scope > [data-ai-dropdown] > button:not([hidden])',
        ),
      );
    expect(top().filter((button) => button.tabIndex === 0)).toHaveLength(1);
    const first = top().find((button) => button.tabIndex === 0)!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const last = top().at(-1)!;
    expect(document.activeElement).toBe(last);
    expect(last.tabIndex).toBe(0);
    expect(top().filter((button) => button.tabIndex === 0)).toEqual([last]);
    last.hidden = true;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(first.tabIndex).toBe(0);
    expect(top().filter((button) => button.tabIndex === 0)).toEqual([first]);

    const italic = bubble.querySelector<HTMLButtonElement>('[data-bubble-action="format:italic"]')!;
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: italic }));
    expect(bubble.style.display).not.toBe('none');
    const outside = document.createElement('button');
    document.body.append(outside);
    italic.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    expect(bubble.style.display).toBe('none');
    editor.destroy();
  });

  it('stop button Tooltip has hover/focus/Escape DOM behavior and matching CSS selectors', () => {
    const control = writingStopControl();
    document.body.append(control.dom);
    const tooltip = control.dom.querySelector<HTMLElement>('[role="tooltip"]')!;
    control.dom.disabled = false;
    control.dom.hidden = false;
    expect(control.dom.classList.contains('nexnote-selection-bubble__stop')).toBe(true);
    expect(tooltip.hidden).toBe(true);
    control.dom.dispatchEvent(new PointerEvent('pointerenter'));
    expect(tooltip.hidden).toBe(false);
    control.dom.dispatchEvent(new PointerEvent('pointerleave'));
    expect(tooltip.hidden).toBe(true);
    control.dom.focus();
    expect(tooltip.hidden).toBe(false);
    control.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tooltip.hidden).toBe(true);
    const css = readFileSync(resolve(process.cwd(), 'packages/renderer/src/globals.css'), 'utf8');
    expect(css).toContain(
      '.nexnote-selection-bubble__stop:hover > .nexnote-selection-bubble__tooltip',
    );
    expect(css).toContain(
      '.nexnote-selection-bubble__stop:focus-visible > .nexnote-selection-bubble__tooltip',
    );
    control.destroy();
  });

  it('disabled action retains an explained Tooltip without executing', () => {
    const onAction = vi.fn();
    const parent = document.createElement('div');
    document.body.append(parent);
    parent.getBoundingClientRect = () =>
      makeRect({ top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 });
    const editor = createSourceEditor(parent, {
      initialText: '第一句原文。',
      onChange: () => undefined,
      extraExtensions: [
        sourceSelectionBubble({
          actions: [
            {
              id: 'format:bold',
              title: '粗体',
              icon: 'bold',
              disabled: true,
              disabledReason: '当前选区不可格式化',
            },
          ],
          onAction,
        }),
      ],
    });
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const button = bubbleOf().querySelector<HTMLButtonElement>(
      '[data-bubble-action="format:bold"]',
    )!;
    expect(button.getAttribute('aria-label')).toBe('粗体（当前选区不可格式化）');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.querySelector('[role="tooltip"]')?.textContent).toContain('当前选区不可格式化');
    button.click();
    expect(onAction).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('actual CodeMirror toolbar DOM Escape only closes its nested Tooltip or menu, not the bubble', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf();
    const bold = bubble.querySelector<HTMLButtonElement>('[data-bubble-action="format:bold"]')!;
    const tooltip = bold.querySelector<HTMLElement>('[role="tooltip"]')!;
    bold.focus();
    expect(tooltip.hidden).toBe(false);
    bold.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(tooltip.hidden).toBe(true);
    expect(bubble.style.display).not.toBe('none');

    const trigger = triggerOf();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const menu = menuOf();
    const item = menu.querySelector<HTMLButtonElement>('[data-ai-menu-action="ai:rewrite"]')!;
    item.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(bubble.style.display).not.toBe('none');

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const activeItem = document.activeElement as HTMLButtonElement;
    activeItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);

    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(bubble.style.display).toBe('none');
    expect(document.activeElement).toBe(editor.view.contentDOM);
    editor.destroy();
  });

  it('键盘：向下键打开并聚焦首项、方向键移动、Enter 执行、Esc 关闭且工具栏保留', async () => {
    const bridge = installBridge();
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const trigger = triggerOf();
    const menu = menuOf();

    key(trigger, 'ArrowDown');
    expect(menu.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(menu.querySelector('[data-ai-menu-action="ai:rewrite"]'));

    key(menu, 'ArrowDown');
    expect(document.activeElement).toBe(menu.querySelector('[data-ai-menu-action="ai:polish"]'));
    key(menu, 'End');
    expect(document.activeElement).toBe(
      menu.querySelector(`[data-ai-menu-action="${TRANSLATE_SELECTION_ACTION_ID}"]`),
    );
    key(menu, 'Home');
    expect(document.activeElement).toBe(menu.querySelector('[data-ai-menu-action="ai:rewrite"]'));
    key(menu, 'ArrowUp');
    expect(document.activeElement).toBe(
      menu.querySelector(`[data-ai-menu-action="${TRANSLATE_SELECTION_ACTION_ID}"]`),
    );
    key(menu, 'Home');

    // Esc 只关菜单，工具栏保持可见（选区仍在）
    key(document.activeElement as HTMLElement, 'Escape');
    expect(menu.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(bubbleOf().style.display).not.toBe('none');

    // 再次打开 → Enter 执行首项（改写）
    key(trigger, 'ArrowDown');
    key(document.activeElement as HTMLElement, 'Enter');
    await bridge.flush();
    expect(bridge.startCalls).toHaveLength(1);
    expect(bridge.startCalls[0]).toMatchObject({ actionId: 'rewrite', target: '第一句原文。' });
    expect(menu.hidden).toBe(true);
    // AI 写作动作保留工具栏：生成中停止控件必须可点
    expect(bubbleOf().style.display).not.toBe('none');
    editor.destroy();
  });

  it('生成中停止控件可点击停止上游流：保留内容并标记未完成，结束后隐藏', async () => {
    const bridge = installBridge();
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const stop = bubbleOf().querySelector<HTMLButtonElement>('[data-testid="bubble-stop"]');
    expect(stop).toBeTruthy();
    expect(stop!.hidden).toBe(true);
    expect(stop!.disabled).toBe(true);
    // 原生 button：Tab 可达、Enter/Space 触发，无需自定义 keydown
    expect(stop!.tagName).toBe('BUTTON');
    expect(stop!.getAttribute('aria-label')).toBe('停止生成');

    const item = bubbleOf().querySelector<HTMLButtonElement>('[data-ai-menu-action="ai:rewrite"]');
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await bridge.flush();
    expect(stop!.hidden).toBe(false);
    expect(stop!.disabled).toBe(false);

    stop!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await bridge.flush();
    expect(bridge.cancelCalls).toContain('stream-1');
    // DEV-037：停止不丢弃会话——保留已显示内容并标记未完成（浮层继续提供 Accept/Reject）
    expect(useWritingStore.getState().session?.status).toBe('cancelled');
    expect(stop!.hidden).toBe(true);
    useWritingStore.getState().session?.reject();
    expect(useWritingStore.getState().session).toBeNull();
    editor.destroy();
  });

  it('浮层不遮挡选区：工具栏底边在选区上方，菜单自工具栏向上展开', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf();
    // 工具栏 translate(-50%,-100%)：style.top 即底边，距选区起点 8px（300-8）
    return nextFrame().then(() => {
      expect(bubble.style.top).toBe('292px');
      const menu = menuOf();
      // 菜单向上展开：位于工具栏之上 ⇒ 不可能覆盖下方的选区文本
      expect(menu.style.bottom).toBe('calc(100% + 4px)');
      expect(menu.style.top).toBe('');
      expect(menu.parentElement?.dataset.aiDropdown).toBe('');
      editor.destroy();
    });
  });

  it('dynamic disabled and reason refresh from configuration updates without DOM mutation', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    let disabled = true;
    let reason = '配置暂不可用';
    const editor = createSourceEditor(parent, {
      initialText: '第一句原文。第二句。',
      onChange: () => undefined,
      extraExtensions: [
        sourceSelectionBubble({
          actions: [
            {
              id: 'format:bold',
              title: '粗体',
              icon: 'bold',
              disabled: () => disabled,
              disabledReason: () => reason,
            },
          ],
          onAction: () => undefined,
        }),
      ],
    });
    editor.view.dispatch({ selection: { anchor: 0, head: 6 } });
    const button = bubbleOf().querySelector<HTMLButtonElement>(
      '[data-bubble-action="format:bold"]',
    )!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('配置暂不可用');
    expect(button.tabIndex).toBe(-1);

    disabled = false;
    reason = undefined as unknown as string;
    editor.view.dispatch({ selection: { anchor: 1, head: 6 } });
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('粗体');
    expect(button.tabIndex).toBe(0);

    disabled = true;
    reason = '权限已收回';
    editor.view.dispatch({ selection: { anchor: 0, head: 6 } });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('权限已收回');
    expect(button.tabIndex).toBe(-1);
    editor.destroy();
  });

  it('SourceModeView preview mounts real CodeMirror but keeps selected-text bubble hidden and unreachable', async () => {
    const markdown = '# 预览页\n\n第一句原文。第二句。';
    (window as unknown as { nexnote: unknown }).nexnote = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'fs:readTextFile') return { ok: true, data: markdown };
        if (channel === 'fs:stat') {
          return {
            ok: true,
            data: {
              path: '预览页.md',
              name: '预览页.md',
              kind: 'file',
              size: markdown.length,
              modifiedAt: 'v1',
            },
          };
        }
        if (channel === 'fs:exists') return { ok: true, data: false };
        if (channel === 'fs:listDir' || channel === 'index:pageSummaries') {
          return { ok: true, data: [] };
        }
        return { ok: true, data: null };
      }),
      on: () => () => undefined,
    };
    const tab: TabDescriptor = {
      id: 'selection-preview-real',
      kind: 'page',
      title: '预览页',
      pagePath: '预览页.md',
      format: 'markdown',
      editorMode: 'source',
      markdownView: 'preview',
      createdAt: 1,
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<SourceModeView tab={tab} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(getActiveSourceEditor()).not.toBeNull());
    const editor = getActiveSourceEditor()!;
    editor.view.dispatch({ selection: { anchor: 8, head: 14 } });
    const bubble = document.querySelector<HTMLElement>('[data-source-selection-bubble]')!;
    expect(bubble).not.toBeNull();
    expect(bubble.style.display).toBe('none');
    expect(
      document.querySelector('[data-testid="source-editor-pane"]')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      Array.from(bubble.querySelectorAll<HTMLButtonElement>('button')).every(
        (button) => button.tabIndex === -1 || button.hidden,
      ),
    ).toBe(true);
    await act(async () => root.unmount());
  });

  it('preview capability excludes the bubble even when a real CodeMirror text selection exists', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    let previewOnly = true;
    const editor = createSourceEditor(parent, {
      initialText: '第一句原文。第二句。',
      onChange: () => undefined,
      extraExtensions: [
        sourceSelectionBubble({
          actions: sourceFormatBubbleActions(),
          isEnabled: () => !previewOnly,
          onAction: () => undefined,
        }),
      ],
    });
    editor.view.dispatch({ selection: { anchor: 0, head: 6 } });
    const bubble = bubbleOf();
    expect(bubble.style.display).toBe('none');
    previewOnly = false;
    editor.view.dispatch({ selection: { anchor: 1, head: 6 } });
    expect(bubble.style.display).not.toBe('none');
    editor.destroy();
  });

  it('无选区时不显示工具栏（含 AI 入口）', () => {
    const { editor } = mount('第一句原文。第二句。');
    const bubble = bubbleOf();
    expect(bubble.style.display).toBe('none');
    // 折叠光标：工具栏整体隐藏 ⇒ AI 入口不可见也不可点
    editor.view.dispatch({ selection: { anchor: 3, head: 3 } });
    expect(bubble.style.display).toBe('none');
    expect(bubble.querySelector('[data-bubble-action="ai:menu"]')).toBeTruthy();
    editor.destroy();
  });
});

describe('DEV-034 两模式按钮集一致（源码 vs 块编辑）', () => {
  it('平铺动作与 AI 下拉动作完全一致（同一装配函数）', () => {
    // 源码模式实际装配
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const sourceBubble = bubbleOf();
    const sourceFlat = Array.from(sourceBubble.querySelectorAll('[data-bubble-action]')).map(
      (b) => (b as HTMLElement).dataset.bubbleAction,
    );
    const sourceMenu = Array.from(sourceBubble.querySelectorAll('[data-ai-menu-action]')).map(
      (b) => (b as HTMLElement).dataset.aiMenuAction,
    );
    const sourceMenuTitles = Array.from(sourceBubble.querySelectorAll('[data-ai-menu-action]')).map(
      (b) => b.textContent,
    );
    editor.destroy();

    // 块编辑实际装配（EditorView 使用同一平铺动作与同一 AI 菜单函数）
    const host = document.createElement('div');
    document.body.append(host);
    const kernel = createEditor(host, {
      initialMarkdown: '第一句原文。第二句。',
      slashMenu: false,
      dragHandle: false,
      selectionBubble: {
        actions: formatBubbleActions(),
        aiMenu: { label: 'AI', actions: writingAiMenuActions() },
        extraControl: writingStopControl(),
        onAction: () => undefined,
      },
    });
    const doc = kernel.editor.view.state.doc;
    kernel.editor.view.dispatch(
      kernel.editor.view.state.tr.setSelection(TextSelection.create(doc, 1, 6)),
    );
    const blockBubble = host.querySelector<HTMLElement>('[data-selection-bubble]');
    expect(blockBubble).toBeTruthy();
    const blockFlat = Array.from(blockBubble!.querySelectorAll('[data-bubble-action]')).map(
      (b) => (b as HTMLElement).dataset.bubbleAction,
    );
    const blockMenu = Array.from(blockBubble!.querySelectorAll('[data-ai-menu-action]')).map(
      (b) => (b as HTMLElement).dataset.aiMenuAction,
    );
    const blockMenuTitles = Array.from(blockBubble!.querySelectorAll('[data-ai-menu-action]')).map(
      (b) => b.textContent,
    );

    expect(blockFlat).toEqual(sourceFlat);
    expect(blockMenu).toEqual(sourceMenu);
    expect(blockMenuTitles).toEqual(sourceMenuTitles);
    const sourceActions = Array.from(
      sourceBubble.querySelectorAll<HTMLElement>('[data-bubble-action^="format:"]'),
    ).map((button) => ({
      id: button.dataset.bubbleAction,
      label: button.getAttribute('aria-label'),
      icon: button.querySelector<HTMLElement>('[data-icon]')?.dataset.icon,
      tooltip: button.querySelector<HTMLElement>('[role="tooltip"]')?.textContent,
    }));
    const blockActions = Array.from(
      blockBubble!.querySelectorAll<HTMLElement>('[data-bubble-action^="format:"]'),
    ).map((button) => ({
      id: button.dataset.bubbleAction,
      label: button.getAttribute('aria-label'),
      icon: button.querySelector<HTMLElement>('[data-icon]')?.dataset.icon,
      tooltip: button.querySelector<HTMLElement>('[role="tooltip"]')?.textContent,
    }));
    expect(blockActions).toEqual(sourceActions);
    // 六写作动作 + 询问 AI + 划词翻译（DEV-041）
    expect(blockMenu).toHaveLength(8);
    kernel.destroy();
  });
});
