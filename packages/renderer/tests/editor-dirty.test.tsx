// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultVaultSettings } from '@nexnote/shared';
import { EditorView } from '../src/editor/EditorView';
import { getActiveEditor } from '../src/editor/active-editor';
import { useSettingsStore } from '../src/stores/settings-store';
import type { TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tab: TabDescriptor = {
  id: 'dirty-test',
  kind: 'page',
  title: '测试页',
  pagePath: '测试页.md',
  format: 'native-block',
  editorMode: 'block',
  createdAt: 1,
};

type Listener = (payload: unknown) => void;

function installBridge(options?: {
  onWrite?: (content: string, writeNumber: number) => Promise<void>;
  autoSaveMs?: number;
}) {
  let diskText = '# 测试页\n\n';
  let version = 1;
  let writes = 0;
  let resolveFirstSaveStat!: () => void;
  const firstSaveStat = new Promise<void>((resolve) => {
    resolveFirstSaveStat = resolve;
  });
  const listeners = new Map<string, Set<Listener>>();

  useSettingsStore.setState({
    vault: {
      ...defaultVaultSettings(),
      editor: {
        ...defaultVaultSettings().editor,
        autoSaveMs: options?.autoSaveMs ?? 1500,
      },
    },
  });

  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      const path = (payload as { path?: string } | undefined)?.path ?? tab.pagePath!;
      if (channel === 'fs:exists') return { ok: true, data: path === tab.pagePath };
      if (channel === 'fs:readTextFile') return { ok: true, data: diskText };
      if (channel === 'fs:stat') {
        if (writes === 1) resolveFirstSaveStat();
        return {
          ok: true,
          data: {
            path,
            name: path.split('/').at(-1)!,
            kind: 'file',
            size: diskText.length,
            modifiedAt: `v${version}`,
          },
        };
      }
      if (channel === 'fs:writeTextFile') {
        writes += 1;
        const content = (payload as { content: string }).content;
        await options?.onWrite?.(content, writes);
        diskText = content;
        version += 1;
        return { ok: true, data: undefined };
      }
      if (channel === 'fs:listDir') return { ok: true, data: [] };
      if (channel === 'index:backlinks' || channel === 'index:pageSummaries') {
        return { ok: true, data: [] };
      }
      return { ok: true, data: null };
    }),
    on: (channel: string, listener: Listener) => {
      const channelListeners = listeners.get(channel) ?? new Set<Listener>();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
      return () => channelListeners.delete(listener);
    },
  };

  return {
    emitExternalChange(text: string) {
      diskText = text;
      version += 1;
      for (const listener of listeners.get('fs:changed') ?? []) {
        listener({ kind: 'change', path: tab.pagePath });
      }
    },
    firstSaveStat,
    get writes() {
      return writes;
    },
  };
}

async function mountEditor() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<EditorView tab={tab} />);
  });
  await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
  return { container, root };
}

/** 在文档末尾追加一个段落（模拟用户在正文键入；不动首 H1，避免触发改名联动）。 */
function typeAtEnd(text: string): boolean {
  const kernel = getActiveEditor();
  if (!kernel) return false;
  const end = kernel.editor.state.doc.content.size;
  return kernel.editor.chain().insertContentAt(end, `\n\n${text}`).run();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  delete (window as unknown as { nexnote?: unknown }).nexnote;
});

describe('EditorView dirty 生命周期', () => {
  it('用户键入后立即保护 dirty 内容，不等待自动保存防抖', async () => {
    const bridge = installBridge();
    const { container, root } = await mountEditor();

    await act(async () => {
      expect(typeAtEnd('即时输入')).toBe(true);
      bridge.emitExternalChange('# 外部版本\n');
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="editor-conflict-banner"]')).not.toBeNull();
    });
    expect(bridge.writes).toBe(0);

    await act(async () => root.unmount());
  });

  it('保存期间的新增输入在旧 snapshot 保存完成后仍保持 dirty', async () => {
    let releaseFirstWrite!: () => void;
    let firstWriteStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstWriteStarted = resolve;
    });
    const bridge = installBridge({
      autoSaveMs: 100,
      onWrite: (_content, writeNumber) => {
        if (writeNumber !== 1) return Promise.resolve();
        firstWriteStarted();
        return new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      },
    });
    const { container, root } = await mountEditor();

    await act(async () => {
      expect(typeAtEnd('第一笔')).toBe(true);
    });
    await started;
    await act(async () => {
      expect(typeAtEnd('第二笔')).toBe(true);
    });
    await act(async () => {
      releaseFirstWrite();
      await bridge.firstSaveStat;
      await Promise.resolve();
    });
    expect(bridge.writes).toBe(1);

    await act(async () => {
      bridge.emitExternalChange('# 外部版本\n');
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="editor-conflict-banner"]')).not.toBeNull();
    });

    await act(async () => root.unmount());
  });
});
