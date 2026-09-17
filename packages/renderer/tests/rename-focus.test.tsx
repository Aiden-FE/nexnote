// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorKernelInstance } from '@nexnote/kernel';
import { defaultVaultSettings } from '@nexnote/shared';
import { EditorView } from '../src/editor/EditorView';
import { getActiveEditor } from '../src/editor/active-editor';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import { usePageTreeStore } from '../src/stores/page-tree-store';
import { useSettingsStore } from '../src/stores/settings-store';
import { useTabStore, type TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let sourceCreateCount = 0;
let sourceOnChange: ((text: string) => void) | null = null;
let sourceHandle: { destroy: () => void } | null = null;

vi.mock('../src/editor/source/codemirror-host', () => ({
  createSourceEditor: (
    _parent: HTMLElement,
    options: { initialText: string; onChange(text: string): void },
  ) => {
    sourceCreateCount += 1;
    let text = options.initialText;
    sourceOnChange = (next: string) => {
      text = next;
      options.onChange(next);
    };
    const handle = {
      scrollDOM: document.createElement('div'),
      getText: () => text,
      setText: (next: string) => {
        text = next;
      },
      focus: () => undefined,
      destroy: () => undefined,
    };
    sourceHandle = handle;
    return handle;
  },
}));

vi.mock('../src/editor/source/LivePreview', () => ({ LivePreview: () => null }));

type Call = { channel: string; path?: string; content?: string };

function installBridge(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const calls: Call[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let version = 1;

  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      const value = (payload ?? {}) as {
        path?: string;
        from?: string;
        to?: string;
        content?: string;
      };
      calls.push({ channel, path: value.path, content: value.content });
      if (channel === 'fs:exists') return { ok: true, data: files.has(value.path ?? '') };
      if (channel === 'fs:readTextFile') {
        const text = files.get(value.path ?? '');
        if (text === undefined) throw new Error(`missing ${value.path}`);
        return { ok: true, data: text };
      }
      if (channel === 'fs:stat') {
        const text = files.get(value.path ?? '');
        return {
          ok: true,
          data:
            text === undefined
              ? null
              : {
                  path: value.path,
                  name: value.path?.split('/').at(-1),
                  kind: 'file',
                  size: text.length,
                  modifiedAt: `v${version}:${value.path}`,
                },
        };
      }
      if (channel === 'fs:renameLinked') {
        const text = files.get(value.from ?? '');
        if (text === undefined) throw new Error(`missing ${value.from}`);
        files.delete(value.from!);
        files.set(value.to!, text);
        return { ok: true, data: undefined };
      }
      if (channel === 'fs:writeTextFile') {
        files.set(value.path!, value.content ?? '');
        version += 1;
        return {
          ok: true,
          data: {
            path: value.path,
            name: value.path?.split('/').at(-1),
            kind: 'file',
            size: (value.content ?? '').length,
            modifiedAt: `v${version}:${value.path}`,
          },
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
    }),
    on: (channel: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => set.delete(listener);
    },
  };

  return { files, calls };
}

function resetStores(tab: TabDescriptor): void {
  useTabStore.setState({ tabs: [tab], activeTabId: tab.id });
  usePageTreeStore.setState({ entries: [], status: 'ready', error: null });
  useSettingsStore.setState({
    vault: {
      ...defaultVaultSettings(),
      editor: { ...defaultVaultSettings().editor, autoSaveMs: 40 },
    },
  });
}

function TabEditorHost({ tabId, source }: { tabId: string; source: boolean }) {
  const tab = useTabStore((state) => state.tabs.find((candidate) => candidate.id === tabId));
  if (!tab) return null;
  return source ? <SourceModeView tab={tab} /> : <EditorView tab={tab} />;
}

function blockTab(): TabDescriptor {
  return {
    id: 'rename-block',
    kind: 'page',
    title: '测试页',
    pagePath: '测试页.md',
    format: 'native-block',
    editorMode: 'block',
    createdAt: 1,
  };
}

function sourceTab(): TabDescriptor {
  return {
    id: 'rename-source',
    kind: 'page',
    title: '源码页',
    pagePath: '源码页.md',
    format: 'markdown',
    editorMode: 'source',
    previewVisible: false,
    createdAt: 1,
  };
}

function openToolbarHeadingMenu(): void {
  document
    .querySelector<HTMLButtonElement>('[data-testid="toolbar-entry-block:type"]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
}

function clickToolbarHeading(level: number): void {
  document
    .querySelector<HTMLButtonElement>(`[data-testid="toolbar-menu-item-block:heading:${level}"]`)
    ?.click();
}

function replaceFirstHeading(kernel: EditorKernelInstance, title: string): void {
  const { state, dispatch } = kernel.editor.view;
  const heading = state.doc.firstChild;
  if (!heading) throw new Error('missing heading');
  dispatch(state.tr.insertText(title, 1, 1 + heading.content.size));
}

async function mount(tab: TabDescriptor, source: boolean) {
  resetStores(tab);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TabEditorHost tabId={tab.id} source={source} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  sourceCreateCount = 0;
  sourceOnChange = null;
  sourceHandle = null;
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { nexnote?: unknown }).nexnote;
  document.body.innerHTML = '';
  usePageTreeStore.setState({ entries: [], status: 'idle', error: null });
});

describe('rename keeps editor instances alive', () => {
  it('块编辑 H1 rename updates metadata without remounting the kernel', async () => {
    const tab = blockTab();
    const bridge = installBridge({ '测试页.md': '# 测试页\n\n' });
    const { container, root } = await mount(tab, false);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    const beforeNode = container.querySelector('[data-testid="editor-view"]');
    const beforeKernel = getActiveEditor();

    await act(async () => {
      replaceFirstHeading(beforeKernel!, '新标题');
      await vi.advanceTimersByTimeAsync(80);
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-testid="editor-view"]')?.getAttribute('data-path'),
      ).toBe('新标题.md'),
    );

    expect(container.querySelector('[data-testid="editor-view"]')).toBe(beforeNode);
    expect(getActiveEditor()).toBe(beforeKernel);
    expect(
      bridge.calls.filter(
        (call) => call.channel === 'fs:readTextFile' && call.path === '新标题.md',
      ),
    ).toHaveLength(0);
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      title: '新标题',
      pagePath: '新标题.md',
    });

    await act(async () => {
      const kernel = getActiveEditor()!;
      const end = kernel.editor.state.doc.content.size;
      kernel.editor.view.dispatch(kernel.editor.view.state.tr.insertText('续写', end - 1));
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(bridge.files.get('新标题.md')).toContain('续写');
    expect(bridge.files.has('测试页.md')).toBe(false);
    await act(async () => root.unmount());
  });

  it('块编辑工具栏把首个正文块转 H1 后沿既有链路同步文件名', async () => {
    const tab = blockTab();
    const bridge = installBridge({ '测试页.md': '测试页\n\n正文\n' });
    const { root } = await mount(tab, false);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    const kernel = getActiveEditor()!;
    act(() => {
      kernel.editor.commands.setTextSelection(1);
      openToolbarHeadingMenu();
    });
    act(() => clickToolbarHeading(1));
    await act(async () => vi.advanceTimersByTimeAsync(80));
    await vi.waitFor(() => expect(useTabStore.getState().tabs[0]?.pagePath).toBe('测试页.md'));
    expect(bridge.files.get('测试页.md')).toContain('# 测试页');
    await act(async () => root.unmount());
  });

  it('块编辑工具栏转换后续段落为 H1 不误触发文件名同步', async () => {
    const tab = blockTab();
    const bridge = installBridge({ '测试页.md': '# 测试页\n\n后续标题\n' });
    const { root } = await mount(tab, false);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    const kernel = getActiveEditor()!;
    const second = kernel.editor.state.doc.child(1);
    const secondPos = kernel.editor.state.doc.child(0).nodeSize + 1;
    expect(second.textContent).toBe('后续标题');
    act(() => {
      kernel.editor.commands.setTextSelection(secondPos);
      openToolbarHeadingMenu();
    });
    act(() => clickToolbarHeading(1));
    await act(async () => vi.advanceTimersByTimeAsync(80));
    expect(useTabStore.getState().tabs[0]?.pagePath).toBe('测试页.md');
    expect(bridge.files.has('后续标题.md')).toBe(false);
    expect(bridge.files.get('测试页.md')).toContain('# 后续标题');
    await act(async () => root.unmount());
  });

  it('块编辑真实切换到其他路径仍然重载', async () => {
    const tab = blockTab();
    const bridge = installBridge({ '测试页.md': '# 测试页\n\n', '其他页.md': '# 其他页\n\n' });
    const { container, root } = await mount(tab, false);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    const beforeKernel = getActiveEditor();

    await act(async () => {
      useTabStore.getState().updateTab(tab.id, { title: '其他页', pagePath: '其他页.md' });
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(getActiveEditor()).not.toBe(beforeKernel));
    expect(
      bridge.calls.some((call) => call.channel === 'fs:readTextFile' && call.path === '其他页.md'),
    ).toBe(true);
    expect(container.querySelector('[data-testid="editor-view"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it('源码模式 H1 rename updates metadata without remounting CodeMirror', async () => {
    const tab = sourceTab();
    const bridge = installBridge({ '源码页.md': '# 源码页\n\n' });
    const { container, root } = await mount(tab, true);
    await vi.waitFor(() => expect(sourceOnChange).not.toBeNull());
    const beforeNode = container.querySelector('[data-testid="source-mode-view"]');
    const beforeHandle = sourceHandle;

    await act(async () => {
      sourceOnChange?.('# 新源码名\n\n');
      await vi.advanceTimersByTimeAsync(80);
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-testid="source-mode-view"]')?.getAttribute('data-path'),
      ).toBe('新源码名.md'),
    );

    expect(container.querySelector('[data-testid="source-mode-view"]')).toBe(beforeNode);
    expect(sourceCreateCount).toBe(1);
    expect(sourceHandle).toBe(beforeHandle);
    expect(
      bridge.calls.filter(
        (call) => call.channel === 'fs:readTextFile' && call.path === '新源码名.md',
      ),
    ).toHaveLength(0);
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      title: '新源码名',
      pagePath: '新源码名.md',
    });

    await act(async () => {
      sourceOnChange?.('# 新源码名\n\n继续输入\n');
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(bridge.files.get('新源码名.md')).toContain('继续输入');
    expect(bridge.files.has('源码页.md')).toBe(false);
    await act(async () => root.unmount());
  });

  it('源码模式真实切换到其他路径仍然重载', async () => {
    const tab = sourceTab();
    const bridge = installBridge({ '源码页.md': '# 源码页\n\n', '另一页.md': '# 另一页\n\n' });
    const { container, root } = await mount(tab, true);
    await vi.waitFor(() => expect(sourceOnChange).not.toBeNull());

    await act(async () => {
      useTabStore.getState().updateTab(tab.id, { title: '另一页', pagePath: '另一页.md' });
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-testid="source-mode-view"]')?.getAttribute('data-path'),
      ).toBe('另一页.md'),
    );
    expect(sourceCreateCount).toBe(2);
    expect(
      bridge.calls.some((call) => call.channel === 'fs:readTextFile' && call.path === '另一页.md'),
    ).toBe(true);
    await act(async () => root.unmount());
  });
});
