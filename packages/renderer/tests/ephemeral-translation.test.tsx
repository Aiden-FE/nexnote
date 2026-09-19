// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { defaultVaultSettings, TRANSLATION_MAX_TEXT_CHARS } from '@nexnote/shared';
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
import {
  closeTranslationWorkbench,
  openTranslationWorkbench,
} from '../src/features/ai/translation/workbench';
import { commandRegistry } from '../src/registries';

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
  let runSequence = 0;
  const invokeSpy = vi.fn(async (channel: string) => {
    if (channel === 'agent:run:translation') {
      runSequence += 1;
      return { ok: true, data: { runId: `stream-${runSequence}` } };
    }
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
  useTranslationStore.setState({ selection: null, document: null, input: null });
  useTabStore.setState({ tabs: [], activeTabId: null });
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  document.body.innerHTML = '';
  delete (window as unknown as { nexnote?: unknown }).nexnote;
  useTranslationStore.setState({ selection: null, document: null, input: null });
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

  it('目标语言每次可选但不覆盖全局默认，切换语言以同一原文重译', async () => {
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

    // 当次覆盖不持久化；关闭后恢复全局/兼容默认
    c.closeSelection();
    c.translateSelection({ text: '你好', coords: { top: 0, left: 0 } });
    await bridge.flush();
    const third = translationPayloads(bridge)[2]!;
    expect(third.translation.targetLanguage).toBe('English');
  });

  it('划词与全文同受 200k 单源上限：超限明确报错且不提交、不截断', async () => {
    const bridge = installBridge();
    const oversized = 'x'.repeat(TRANSLATION_MAX_TEXT_CHARS + 1);
    const c = controller(() => oversized);
    c.translateSelection({ text: oversized, coords: { top: 0, left: 0 } });
    expect(useTranslationStore.getState().selection).toMatchObject({
      status: 'error',
      sourceText: oversized,
    });
    expect(useTranslationStore.getState().selection?.error).toContain('200,000');
    c.translateDocument();
    expect(useTranslationStore.getState().document).toMatchObject({
      status: 'error',
      sourceText: oversized,
    });
    expect(bridge.calls('agent:run:translation')).toHaveLength(0);
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

describe('DEV-059 翻译工作台（独立临时输入）', () => {
  it('命令面板/划词 AI 下拉/块 slash 均可打开工作台，且仅在显式提交时请求', async () => {
    const bridge = installBridge();
    await import('../src/features/ai');
    expect(commandRegistry.get('ai.translation.workbench')).toMatchObject({
      category: 'AI',
      title: '翻译工作台',
    });
    const sessionStore = openTranslationWorkbench();
    expect(useTranslationStore.getState().input).not.toBeNull();
    expect(bridge.calls('agent:run:translation')).toHaveLength(0);

    // 在无 runId 阶段之前输入、粘贴都不产生隐式 AI
    await act(async () => {
      sessionStore.setDraft('在控制台中粘贴一大段原文');
      await bridge.flush();
    });
    expect(bridge.calls('agent:run:translation')).toHaveLength(0);

    await act(async () => {
      sessionStore.submit();
      await bridge.flush();
    });
    const payloads = translationPayloads(bridge);
    const workbenchCall = payloads.find(
      (payload) => payload.translation.mode === 'input' && payload.translation.text.length > 0,
    );
    expect(workbenchCall).toBeDefined();
    expect(workbenchCall?.translation.targetLanguage).toBeTruthy();
    sessionStore.close();
  });

  it('显式 Cmd/Ctrl+Enter 提交并禁用 IME Enter；超限禁用提交并保留输入可编辑', async () => {
    const bridge = installBridge();
    const session = openTranslationWorkbench();
    const draft = 'x'.repeat(TRANSLATION_MAX_TEXT_CHARS + 1);
    await act(async () => {
      session.setDraft(draft);
      await bridge.flush();
    });
    const state = useTranslationStore.getState().input!;
    expect(state.overLimit).toBe(true);
    expect(state.canSubmit).toBe(false);
    expect(state.draft.length).toBe(TRANSLATION_MAX_TEXT_CHARS + 1);

    await act(async () => {
      session.submit({ ime: false });
      await bridge.flush();
    });
    expect(bridge.calls('agent:run:translation')).toHaveLength(0);

    await act(async () => {
      session.setDraft('Hello world');
      await bridge.flush();
    });
    expect(useTranslationStore.getState().input!.overLimit).toBe(false);
    await act(async () => {
      session.submit({ ime: true });
      await bridge.flush();
    });
    expect(bridge.calls('agent:run:translation')).toHaveLength(0);
    await act(async () => {
      session.submit({ ime: false });
      await bridge.flush();
    });
    expect(bridge.calls('agent:run:translation')).toHaveLength(1);
    session.close();
  });

  it('并发请求使用唯一 runId；晚到事件被丢弃；关闭即取消', async () => {
    const bridge = installBridge();
    const session = openTranslationWorkbench();
    await act(async () => {
      session.setDraft('并发请求');
      await bridge.flush();
    });
    await act(async () => {
      session.submit();
      await bridge.flush();
    });
    const firstRunId = translationPayloads(bridge).at(-1) as
      { translation: Record<string, string> } | undefined;
    expect(firstRunId).toBeDefined();
    await act(async () => {
      session.setDraft('第二次提交');
      session.submit();
      await bridge.flush();
    });
    const payloads = translationPayloads(bridge);
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    expect(payloads.at(-1)?.translation.text).toBe('第二次提交');

    // 当前会话的 runId 是最近一次
    const current = useTranslationStore.getState().input!;
    expect(current.runId).toBeTruthy();

    // 上一会话的迟到 delta 不再改写当前会话
    await act(async () => {
      bridge.emit('agent:runEvent', {
        runId: 'stream-1',
        scenario: 'translation',
        event: { type: 'delta', text: '应被丢弃' },
      });
      await bridge.flush();
    });
    expect(useTranslationStore.getState().input!.output).not.toContain('应被丢弃');

    // 关闭 → 取消当前会话且丢弃结果
    await act(async () => {
      session.close();
      await bridge.flush();
    });
    expect(useTranslationStore.getState().input).toBeNull();
    expect(bridge.calls('agent:cancel').length).toBeGreaterThan(0);
  });

  it('vault 切换与延迟翻译上下文通过同一会话关闭路径生效', async () => {
    const bridge = installBridge();
    const session = openTranslationWorkbench();
    await act(async () => {
      session.setDraft('临时翻译稿');
      session.submit();
      await bridge.flush();
    });
    expect(useTranslationStore.getState().input).not.toBeNull();
    await act(async () => {
      closeTranslationWorkbench();
      await bridge.flush();
    });
    expect(useTranslationStore.getState().input).toBeNull();
    expect(bridge.calls('agent:cancel').length).toBeGreaterThan(0);
  });

  it('复制后关闭工作台：再次打开为全新会话', async () => {
    const bridge = installBridge();
    const session = openTranslationWorkbench();
    await mount(<TranslationLayer />);
    await act(async () => {
      session.setDraft('copy me');
      session.submit();
      await bridge.flush();
    });
    await act(async () => {
      bridge.emit('agent:runEvent', {
        runId: useTranslationStore.getState().input!.runId!,
        scenario: 'translation',
        event: { type: 'delta', text: 'copied translation' },
      });
      bridge.emit('agent:runEvent', {
        runId: useTranslationStore.getState().input!.runId!,
        scenario: 'translation',
        event: { type: 'done' },
      });
      await bridge.flush();
    });
    const copyText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copyText },
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="translation-input-copy"]')!.click();
      await bridge.flush();
    });
    expect(copyText).toHaveBeenCalled();
    await act(async () => {
      session.close();
      await bridge.flush();
    });
    const closedId = useTranslationStore.getState().input?.id;
    expect(closedId).toBeUndefined();
    let reopened!: ReturnType<typeof openTranslationWorkbench>;
    await act(async () => {
      reopened = openTranslationWorkbench();
      await bridge.flush();
    });
    expect(useTranslationStore.getState().input!.id).not.toBe(closedId);
    expect(useTranslationStore.getState().input!.draft).toBe('');
    await act(async () => reopened.close());
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

    // 同一 AI 下拉的工作台入口使用选区作为 draft，但不得自动请求。
    await act(async () => {
      bubble!.querySelector<HTMLButtonElement>('[data-bubble-action="ai:menu"]')!.click();
      bubble!
        .querySelector<HTMLButtonElement>('[data-ai-menu-action="translate:workbench"]')!
        .click();
    });
    expect(useTranslationStore.getState().input?.draft).toBe('正文');
    expect(translationPayloads(bridge)).toHaveLength(1);
    useTranslationStore.getState().input?.onClose();

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
