// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultVaultSettings } from '@nexnote/shared';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import { useSettingsStore } from '../src/stores/settings-store';
import type { TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const importCalls: Array<{ channel: string; payload: unknown }> = [];
const openDocumentTab = vi.fn(async () => ({ kind: 'xlsx' as const }));
const sourceCommands = vi.hoisted(() => ({
  insertText: vi.fn(),
  insertBlock: vi.fn(),
}));

vi.mock('../src/editor/source/codemirror-host', () => ({
  createSourceEditor: (_parent: HTMLElement, options: { initialText: string }) => ({
    scrollDOM: document.createElement('div'),
    getText: () => options.initialText,
    setText: () => undefined,
    insertText: sourceCommands.insertText,
    insertBlock: sourceCommands.insertBlock,
    formatMarkdown: vi.fn(),
    indentSelection: () => false,
    focus: () => undefined,
    destroy: () => undefined,
  }),
}));

vi.mock('../src/editor/source/LivePreview', () => ({ LivePreview: () => null }));

vi.mock('../src/lib/open-document', () => ({
  openDocumentTab: (...args: unknown[]) => openDocumentTab(...args),
}));

const markdownTab: TabDescriptor = {
  id: 'editor-drop-source',
  kind: 'page',
  title: '源码页',
  pagePath: '源码页.md',
  format: 'markdown',
  editorMode: 'source',
  markdownView: 'source',
  createdAt: 1,
};

function installBridge(): void {
  useSettingsStore.setState({
    vault: {
      ...defaultVaultSettings(),
      editor: { ...defaultVaultSettings().editor, autoSaveMs: 10_000 },
    },
  });
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      importCalls.push({ channel, payload });
      if (channel === 'fs:exists') return { ok: true, data: true };
      if (channel === 'fs:readTextFile') return { ok: true, data: '# 源码页\n' };
      if (channel === 'fs:stat') {
        return {
          ok: true,
          data: { path: 'x', name: 'x', kind: 'file', size: 8, modifiedAt: 'v1' },
        };
      }
      if (channel === 'binary:import')
        return { ok: true, data: { path: 'imported.xlsx', sha256: 'x' } };
      if (channel === 'index:backlinks' || channel === 'index:pageSummaries')
        return { ok: true, data: [] };
      return { ok: true, data: null };
    }),
    on: () => () => undefined,
  };
}

function fakeFile(name: string, bytes = 'binary-bytes'): File {
  return {
    name,
    arrayBuffer: async () => {
      const encoded = new TextEncoder().encode(bytes);
      return encoded.buffer as ArrayBuffer;
    },
  } as unknown as File;
}

function drop(root: HTMLElement, file: File): void {
  const dt = {
    files: [file],
    getData: () => '',
    setData: () => undefined,
    effectAllowed: 'none',
    dropEffect: 'none',
  } as unknown as DataTransfer;
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dt });
  root.dispatchEvent(event);
}

const mountedRoots: ReturnType<typeof createRoot>[] = [];

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    root.render(node);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

beforeEach(() => {
  importCalls.length = 0;
  openDocumentTab.mockClear();
  sourceCommands.insertBlock.mockReset();
  sourceCommands.insertText.mockReset();
});

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  delete (window as unknown as { nexnote?: unknown }).nexnote;
});

describe('DEV-074 编辑器外部文件拖放导入', () => {
  it('SourceModeView 拖入 .xlsx → binary:import + 打开二进制 tab，不插入 Markdown', async () => {
    installBridge();
    const container = await mount(<SourceModeView tab={markdownTab} />);
    const root = container.querySelector<HTMLElement>('[data-testid="source-mode-view"]');
    expect(root).not.toBeNull();
    act(() => drop(root!, fakeFile('external.xlsx')));

    await act(async () => Promise.resolve());
    await vi.waitFor(() =>
      expect(importCalls.some((c) => c.channel === 'binary:import')).toBe(true),
    );
    expect(importCalls.find((c) => c.channel === 'binary:import')!.payload).toMatchObject({
      kind: 'xlsx',
      name: 'external.xlsx',
      targetDir: '',
    });
    expect(openDocumentTab).toHaveBeenCalledWith('imported.xlsx');
    // 不能把二进制字节塞进 Markdown 编辑器。
    expect(sourceCommands.insertText).not.toHaveBeenCalled();
  });

  it('内部拖拽（无外部文件）不触发导入', async () => {
    installBridge();
    const container = await mount(<SourceModeView tab={markdownTab} />);
    const root = container.querySelector<HTMLElement>('[data-testid="source-mode-view"]')!;
    const dt = {
      files: [],
      getData: () => '',
      setData: () => undefined,
    } as unknown as DataTransfer;
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: dt });
    act(() => root.dispatchEvent(event));
    await act(async () => Promise.resolve());
    expect(importCalls.some((c) => c.channel === 'binary:import')).toBe(false);
  });
});
