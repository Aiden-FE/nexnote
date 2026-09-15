// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { defaultVaultSettings } from '@nexnote/shared';
import { EditorView } from '../src/editor/EditorView';
import { getActiveEditor } from '../src/editor/active-editor';
import { createSourceEditor } from '../src/editor/source/codemirror-host';
import { sourceSelectionBubble } from '../src/editor/source/source-bubble';
import { useSettingsStore } from '../src/stores/settings-store';
import { useTabStore, type TabDescriptor } from '../src/stores/tab-store';
import { createTranslationController } from '../src/features/ai/translation/controller';
import { TranslationLayer } from '../src/features/ai/translation/TranslationLayer';
import {
  isIncomplete,
  useTranslationStore,
} from '../src/features/ai/translation/translation-store';
import { readLastTargetLanguage } from '../src/features/ai/translation/languages';

/**
 * DEV-041 临时翻译：
 * - 划词/全文请求只带原文与目标语言（reasoning 不由渲染层控制）
 * - 首 token 即显；停止/失败保留已显示内容并标记未完成
 * - 目标语言每次可选并记住上次选择
 * - 全文翻译为内存临时视图：不写盘、不进 Tab 文档树
 * - 划词浮层随选区消失关闭
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Listener = (payload: unknown) => void;

interface Bridge {
  invokeSpy: ReturnType<typeof vi.fn>;
  emit: (channel: string, payload: unknown) => void;
  flush: () => Promise<void>;
  calls: (channel: string) => Array<[string, unknown]>;
}

function installBridge(diskText = ''): Bridge {
  const listeners: Record<string, Set<Listener>> = {};
  const invokeSpy = vi.fn(async (channel: string) => {
    if (channel === 'agent:run:translation') return { ok: true, data: { runId: 'stream-1' } };
    if (channel === 'agent:cancel') return { ok: true, data: { cancelled: true } };
    if (channel === 'fs:exists') return { ok: true, data: true };
    if (channel === 'fs:readTextFile') return { ok: true, data: diskText };
    if (channel === 'fs:stat') {
      return {
        ok: true,
        data: { path: 'x', name: 'x', kind: 'file', size: diskText.length, modifiedAt: 'v1' },
      };
    }
    if (
      channel === 'fs:listDir' ||
      channel === 'index:backlinks' ||
      channel === 'index:pageSummaries'
    ) {
      return { ok: true, data: [] };
    }
    return { ok: true, data: null };
  });
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: invokeSpy,
    on: (channel: string, cb: Listener) => {
      const set = listeners[channel] ?? new Set<Listener>();
      set.add(cb);
      listeners[channel] = set;
      return () => set.delete(cb);
    },
  };
  return {
    invokeSpy,
    emit: (channel, payload) => listeners[channel]?.forEach((cb) => cb(payload)),
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
    calls: (channel) =>
      invokeSpy.mock.calls.filter((call) => call[0] === channel) as Array<[string, unknown]>,
  };
}

function translationPayloads(bridge: Bridge) {
  return bridge
    .calls('agent:run:translation')
    .map(([, payload]) => payload as { translation: Record<string, string> });
}

function controller(
  getDocumentText = () => '# 页\n\n正文原文',
): ReturnType<typeof createTranslationController> {
  return createTranslationController({
    getDocumentText,
    getDocumentMeta: () => ({ path: '页面 A.md', title: '页面 A' }),
  });
}

let root: Root | null = null;
let container: HTMLDivElement;

async function mount(node: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
    await Promise.resolve();
  });
}

beforeEach(() => {
  globalThis.localStorage?.clear();
  useTranslationStore.setState({ selection: null, document: null });
  useTabStore.setState({ tabs: [], activeTabId: null });
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  document.body.innerHTML = '';
  delete (window as unknown as { nexnote?: unknown }).nexnote;
  useTranslationStore.setState({ selection: null, document: null });
});

describe('DEV-041 翻译请求与流式状态', () => {
  it('划词翻译只发送原文与目标语言；首 token 即显、完成后标记完成', async () => {
    const bridge = installBridge();
    const c = controller();
    c.translateSelection({ text: '你好，世界', coords: { top: 10, left: 20 } });
    await bridge.flush();

    const payload = translationPayloads(bridge)[0]!;
    expect(payload.translation.mode).toBe('selection');
    expect(payload.translation.text).toBe('你好，世界');
    // reasoning 不在渲染层可控范围（请求不携带 params）
    expect(JSON.stringify(payload)).not.toContain('reasoning');
    expect(payload.translation.targetLanguage).toBe('English');

    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'translation',
      event: { type: 'delta', text: 'Hello' },
    });
    expect(useTranslationStore.getState().selection?.output).toBe('Hello');
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'translation',
      event: { type: 'delta', text: ', world' },
    });
    expect(useTranslationStore.getState().selection?.output).toBe('Hello, world');
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'translation',
      event: { type: 'done' },
    });
    const session = useTranslationStore.getState().selection!;
    expect(session.status).toBe('done');
    expect(isIncomplete(session)).toBe(false);
  });

  it('停止保留已显示内容并标记未完成，并取消上游流', async () => {
    const bridge = installBridge();
    const c = controller();
    c.translateSelection({ text: '你好', coords: { top: 0, left: 0 } });
    await bridge.flush();
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'translation',
      event: { type: 'delta', text: '部分译文' },
    });
    c.stopSelection();

    const session = useTranslationStore.getState().selection!;
    expect(session.status).toBe('cancelled');
    expect(session.output).toBe('部分译文');
    expect(isIncomplete(session)).toBe(true);
    expect(bridge.calls('agent:cancel')).toEqual([['agent:cancel', { runId: 'stream-1' }]]);

    // 停止后上游事件不再改写会话
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'translation',
      event: { type: 'delta', text: '不应出现' },
    });
    expect(useTranslationStore.getState().selection?.output).toBe('部分译文');
  });

  it('失败保留已显示内容并标记未完成，错误码可见', async () => {
    const bridge = installBridge();
    const c = controller();
    c.translateSelection({ text: '你好', coords: { top: 0, left: 0 } });
    await bridge.flush();
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'translation',
      event: { type: 'delta', text: '半截' },
    });
    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'translation',
      event: { type: 'error', message: '供应商失败', code: 'PROVIDER_HTTP' },
    });
    const session = useTranslationStore.getState().selection!;
    expect(session.status).toBe('error');
    expect(session.output).toBe('半截');
    expect(session.error).toContain('PROVIDER_HTTP');
    expect(isIncomplete(session)).toBe(true);
  });

  it('目标语言每次可选并记住上次选择，切换语言以同一原文重译', async () => {
    const bridge = installBridge();
    const c = controller();
    c.translateSelection({ text: '你好', coords: { top: 0, left: 0 } });
    await bridge.flush();
    expect(translationPayloads(bridge)[0]!.translation.targetLanguage).toBe('English');

    useTranslationStore.getState().selection!.onChangeLanguage('日本語');
    await bridge.flush();
    const second = translationPayloads(bridge)[1]!;
    expect(second.translation.targetLanguage).toBe('日本語');
    expect(second.translation.text).toBe('你好');
    expect(readLastTargetLanguage()).toBe('日本語');

    // 关闭后再次翻译沿用上次选择
    c.closeSelection();
    c.translateSelection({ text: 'plain ascii text', coords: { top: 0, left: 0 } });
    await bridge.flush();
    const third = translationPayloads(bridge)[2]!;
    expect(third.translation.targetLanguage).toBe('日本語');
  });

  it('全文翻译为内存态：不写盘、不进文档树、关闭即弃', async () => {
    const bridge = installBridge('# 页\n\n正文原文');
    const c = controller();
    c.translateDocument();
    await bridge.flush();

    const payload = translationPayloads(bridge)[0]!;
    expect(payload.translation.mode).toBe('document');
    expect(payload.translation.text).toContain('正文原文');
    expect(useTranslationStore.getState().document).not.toBeNull();
    expect(bridge.calls('fs:writeTextFile')).toHaveLength(0);
    expect(useTabStore.getState().tabs).toHaveLength(0);

    bridge.emit('agent:runEvent', {
      runId: 'stream-1',
      scenario: 'translation',
      event: { type: 'delta', text: 'Translated' },
    });
    expect(useTranslationStore.getState().document?.output).toBe('Translated');

    c.closeDocument();
    expect(useTranslationStore.getState().document).toBeNull();
    expect(bridge.calls('agent:cancel')).toEqual([['agent:cancel', { runId: 'stream-1' }]]);
  });
});

describe('DEV-041 翻译浮层/临时视图', () => {
  it('划词浮层可复制、可关闭，未完成态有明确标记', async () => {
    const bridge = installBridge();
    const c = controller();
    await mount(<TranslationLayer />);
    await act(async () => {
      c.translateSelection({ text: '你好', coords: { top: 100, left: 300 } });
      await bridge.flush();
    });

    const popover = document.querySelector<HTMLElement>(
      '[data-testid="translation-selection-popover"]',
    );
    expect(popover).not.toBeNull();
    const select = popover!.querySelector<HTMLSelectElement>(
      '[data-testid="translation-selection-language"]',
    );
    expect(select?.value).toBe('English');

    await act(async () => {
      bridge.emit('agent:runEvent', {
        runId: 'stream-1',
        scenario: 'translation',
        event: { type: 'delta', text: 'Hello' },
      });
    });
    expect(
      popover!.querySelector('[data-testid="translation-selection-output"]')?.textContent,
    ).toContain('Hello');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await act(async () => {
      popover!
        .querySelector<HTMLButtonElement>('[data-testid="translation-selection-copy"]')!
        .click();
      await bridge.flush();
    });
    expect(writeText).toHaveBeenCalledWith('Hello');

    await act(async () => {
      useTranslationStore.getState().selection!.onStop();
    });
    expect(
      document.querySelector('[data-testid="translation-selection-incomplete"]'),
    ).not.toBeNull();

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="translation-selection-close"]')!
        .click();
    });
    expect(useTranslationStore.getState().selection).toBeNull();
    expect(document.querySelector('[data-testid="translation-selection-popover"]')).toBeNull();
  });

  it('全文翻译打开临时只读视图并标注不写盘', async () => {
    const bridge = installBridge();
    const c = controller();
    await mount(<TranslationLayer />);
    await act(async () => {
      c.translateDocument();
      await bridge.flush();
    });

    const view = document.querySelector<HTMLElement>('[data-testid="translation-document-view"]');
    expect(view).not.toBeNull();
    expect(view!.getAttribute('data-path')).toBe('页面 A.md');
    expect(view!.textContent).toContain('不会写入文件');

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="translation-document-close"]')!
        .click();
    });
    expect(useTranslationStore.getState().document).toBeNull();
  });
});

describe('DEV-041 选区消失清理', () => {
  it('源码模式：选区折叠时回调清理划词浮层', () => {
    const onSelectionLost = vi.fn();
    const onAction = vi.fn();
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createSourceEditor(parent, {
      initialText: '第一句原文。第二句。',
      onChange: () => undefined,
      extraExtensions: [sourceSelectionBubble({ actions: [], onSelectionLost, onAction })],
    });
    editor.view.dispatch({ selection: { anchor: 0, head: 3 } });
    editor.view.dispatch({ selection: { anchor: 1, head: 1 } });
    expect(onSelectionLost).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it('块编辑：选区折叠关闭划词翻译；全文翻译不改文件、不进文档树', async () => {
    const disk = '# 测试页\n\n正文一段\n';
    const bridge = installBridge(disk);
    useSettingsStore.setState({
      vault: {
        ...defaultVaultSettings(),
        editor: { ...defaultVaultSettings().editor, autoSaveMs: 10_000 },
      },
    });
    const tab: TabDescriptor = {
      id: 'translation-block',
      kind: 'page',
      title: '测试页',
      pagePath: '测试页.md',
      format: 'native-block',
      editorMode: 'block',
      createdAt: 1,
    };
    await mount(<EditorView tab={tab} />);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    const kernel = getActiveEditor()!;
    const doc = kernel.editor.state.doc;
    let from = -1;
    doc.descendants((node, pos) => {
      if (from >= 0 || !node.isText) return true;
      const at = node.text?.indexOf('正文') ?? -1;
      if (at >= 0) from = pos + at;
      return false;
    });
    expect(from).toBeGreaterThanOrEqual(0);

    await act(async () => {
      kernel.editor.view.dispatch(
        kernel.editor.view.state.tr.setSelection(
          TextSelection.create(doc, from, from + '正文'.length),
        ),
      );
    });
    const bubble = document.querySelector<HTMLElement>('[data-selection-bubble]');
    expect(bubble).not.toBeNull();
    await act(async () => {
      bubble!.querySelector<HTMLButtonElement>('[data-bubble-action="ai:menu"]')!.click();
    });
    await act(async () => {
      bubble!
        .querySelector<HTMLButtonElement>('[data-ai-menu-action="translate:selection"]')!
        .click();
    });
    expect(useTranslationStore.getState().selection).not.toBeNull();
    expect(translationPayloads(bridge)[0]!.translation.mode).toBe('selection');

    await act(async () => {
      kernel.editor.view.dispatch(
        kernel.editor.view.state.tr.setSelection(TextSelection.create(doc, from, from)),
      );
    });
    expect(useTranslationStore.getState().selection).toBeNull();

    // 工具栏全文翻译：临时视图，不写盘、不进文档树
    const tabsBefore = useTabStore.getState().tabs.length;
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="toolbar-entry-ai"]')!.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="toolbar-menu-item-translate:document"]')!
        .click();
    });
    await act(async () => bridge.flush());
    expect(useTranslationStore.getState().document).not.toBeNull();
    expect(translationPayloads(bridge).at(-1)!.translation.mode).toBe('document');
    expect(bridge.calls('fs:writeTextFile')).toHaveLength(0);
    expect(useTabStore.getState().tabs).toHaveLength(tabsBefore);
  });
});
