// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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
import { createEditor } from '@nexnote/kernel';
import { TextSelection } from '@tiptap/pm/state';
import { formatBubbleActions } from '../src/editor/interactions/formatting';
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
        // 与 SourceModeView 相同：格式化/双链平铺，写作与询问 AI 收口下拉。
        actions: sourceFormatBubbleActions(),
        aiMenu: { label: 'AI', actions: writingAiMenuActions() },
        extraControl: writingStopControl(),
        onAction: (id, ctx) => {
          if (applySourceFormat(editor.view, id)) return;
          handleSourceBubbleAction(editor.view, id, ctx, { getDocPath: () => 'Notes/测试.md' });
        },
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

  it('AI 六项与询问 AI 收口为单一入口，两模式共用的按钮集完整且顺序稳定', () => {
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

  it('双链按钮与外链按钮视觉可区分（图标与 tooltip）', () => {
    const { parent, editor } = mount('第一句原文。第二句。');
    selectWithCoords(editor, parent, 0, 6, { top: 300, left: 100, right: 120, bottom: 320 });
    const bubble = bubbleOf();
    const link = bubble.querySelector<HTMLElement>('[data-bubble-action="format:link"]');
    const wiki = bubble.querySelector<HTMLElement>('[data-bubble-action="format:wikilink"]');
    expect(link?.textContent).toBe('🔗');
    expect(wiki?.textContent).toBe('[[]]');
    expect(link?.title).not.toBe(wiki?.title);
    expect(wiki?.title).toContain('双链');
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
    key(menu, 'ArrowUp');
    expect(document.activeElement).toBe(menu.querySelector('[data-ai-menu-action="ai:rewrite"]'));

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
    expect(blockMenu).toHaveLength(7);
    kernel.destroy();
  });
});
