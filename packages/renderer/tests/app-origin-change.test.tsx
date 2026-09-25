// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultVaultSettings } from '@nexnote/shared';
import { EditorView } from '../src/editor/EditorView';
import { getActiveEditor } from '../src/editor/active-editor';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import { useSettingsStore } from '../src/stores/settings-store';
import type { TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Listener = (payload: unknown) => void;

const sourceTab: TabDescriptor = {
  id: 'app-origin-source',
  kind: 'page',
  title: '源码页',
  pagePath: '源码页.md',
  format: 'markdown',
  editorMode: 'source',
  previewVisible: false,
  createdAt: 1,
};

const blockTab: TabDescriptor = {
  id: 'app-origin-block',
  kind: 'page',
  title: '测试页',
  pagePath: '测试页.md',
  format: 'native-block',
  editorMode: 'block',
  createdAt: 1,
};

// ── 源码模式：CodeMirror 以受控 mock 代替，记录 setText 后的文本 ──

let sourceOnChange: ((text: string) => void) | null = null;
let sourceEditorText = '';

vi.mock('../src/editor/source/codemirror-host', () => ({
  createSourceEditor: (
    _parent: HTMLElement,
    options: { initialText: string; onChange(text: string): void },
  ) => {
    sourceEditorText = options.initialText;
    // 模拟用户键入：同步 mock 编辑器内部文本，再交给组件 onChange
    sourceOnChange = (text: string) => {
      sourceEditorText = text;
      options.onChange(text);
    };
    return {
      scrollDOM: document.createElement('div'),
      getText: () => sourceEditorText,
      setText: (next: string) => {
        sourceEditorText = next;
      },
      focus: () => undefined,
      destroy: () => undefined,
    };
  },
}));

vi.mock('../src/editor/source/LivePreview', () => ({
  LivePreview: () => null,
}));

interface ChangeBridge {
  emitChange: (origin?: 'app') => void;
  setDisk: (text: string) => void;
  readonly writes: number;
  readonly diskText: string;
}

function installBridge(page: 'source' | 'block', autoSaveMs: number): ChangeBridge {
  let diskText = page === 'source' ? '# 源码页\n\n' : '# 测试页\n\n';
  let version = 1;
  let writes = 0;
  const listeners = new Map<string, Set<Listener>>();
  const pagePath = page === 'source' ? sourceTab.pagePath! : blockTab.pagePath!;

  useSettingsStore.setState({
    vault: {
      ...defaultVaultSettings(),
      editor: { ...defaultVaultSettings().editor, autoSaveMs },
    },
  });

  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      const p = (payload ?? {}) as { path?: string; content?: string };
      const path = p.path ?? pagePath;
      if (channel === 'fs:exists') return { ok: true, data: path === pagePath };
      if (channel === 'fs:readTextFile') return { ok: true, data: diskText };
      if (channel === 'fs:stat') {
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
        diskText = p.content ?? diskText;
        version += 1;
        return {
          ok: true,
          data: {
            path,
            name: path.split('/').at(-1)!,
            kind: 'file',
            size: (p.content ?? '').length,
            modifiedAt: `v${version}`,
          },
        };
      }
      if (channel === 'fs:listDir') return { ok: true, data: [] };
      if (channel === 'index:backlinks' || channel === 'index:pageSummaries') {
        return { ok: true, data: [] };
      }
      return { ok: true, data: null };
    }),
    on: (channel: string, listener: Listener) => {
      const set = listeners.get(channel) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(channel, set);
      return () => set.delete(listener);
    },
  };

  return {
    emitChange(origin?: 'app') {
      for (const listener of listeners.get('fs:changed') ?? []) {
        listener({ kind: 'change', path: pagePath, ...(origin ? { origin } : {}) });
      }
    },
    setDisk(text: string) {
      diskText = text;
      version += 1;
    },
    get writes() {
      return writes;
    },
    get diskText() {
      return diskText;
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  delete (window as unknown as { nexnote?: unknown }).nexnote;
});

describe('SourceModeView 收到 origin:"app" 的 fs:changed', () => {
  function mountSource() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    return { container, root };
  }

  it('写入后事件窗口内继续输入（dirty）：不弹冲突、不丢输入、自动保存继续', async () => {
    vi.useFakeTimers();
    try {
      const bridge = installBridge('source', 875);
      const { container, root } = mountSource();
      await act(async () => {
        root.render(<SourceModeView tab={sourceTab} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(sourceOnChange).not.toBeNull());

      // 第一笔输入 → autosave 落盘
      act(() => sourceOnChange?.('# 源码页\n\n第一笔\n'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      await act(async () => {
        await act(async () => {
          await vi.waitFor(() => expect(bridge.writes).toBe(1));
        });
      });

      // 落盘后事件窗口内继续输入（dirty），随后应用写入回声事件到达
      act(() => sourceOnChange?.('# 源码页\n\n第一笔\n第二笔\n'));
      await act(async () => {
        bridge.emitChange('app');
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector('[data-testid="source-conflict-banner"]')).toBeNull();
      expect(sourceEditorText).toContain('第二笔'); // 本地 buffer 未被打断

      // 自动保存未被暂停：第二笔继续落盘且无冲突
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      await act(async () => {
        await act(async () => {
          await vi.waitFor(() => expect(bridge.writes).toBe(2));
        });
      });
      expect(container.querySelector('[data-testid="source-conflict-banner"]')).toBeNull();

      await act(async () => root.unmount());
    } finally {
      vi.useRealTimers();
      sourceOnChange = null;
    }
  });

  it('dirty 时收到应用联动改写（renameWithLinks 重写本页）：仅刷新基线，下一笔正常保存', async () => {
    vi.useFakeTimers();
    try {
      const bridge = installBridge('source', 875);
      const { container, root } = mountSource();
      await act(async () => {
        root.render(<SourceModeView tab={sourceTab} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(sourceOnChange).not.toBeNull());

      act(() => sourceOnChange?.('# 源码页\n\n第一笔\n'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      await act(async () => {
        await act(async () => {
          await vi.waitFor(() => expect(bridge.writes).toBe(1));
        });
      });

      // 继续输入保持 dirty；应用自身（如 renameWithLinks 联动）改写了磁盘与本页
      act(() => sourceOnChange?.('# 源码页\n\n第一笔\n第二笔\n'));
      bridge.setDisk('# 源码页\n\n重写后的链接 [[a-renamed]]\n');
      await act(async () => {
        bridge.emitChange('app');
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      // 绝不弹冲突：我们的写入不可能与用户意图冲突
      expect(container.querySelector('[data-testid="source-conflict-banner"]')).toBeNull();
      expect(sourceEditorText).toContain('第二笔');

      // 基线已刷新到磁盘当前版本：autosave 顺滑落盘，不会误报 conflict
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      await act(async () => {
        await act(async () => {
          await vi.waitFor(() => expect(bridge.writes).toBe(2));
        });
      });
      expect(container.querySelector('[data-testid="source-conflict-banner"]')).toBeNull();

      await act(async () => root.unmount());
    } finally {
      vi.useRealTimers();
      sourceOnChange = null;
    }
  });

  it('clean 时收到应用联动改写：静默重载磁盘内容，不弹冲突也不触发写盘', async () => {
    vi.useFakeTimers();
    try {
      const bridge = installBridge('source', 875);
      const { container, root } = mountSource();
      await act(async () => {
        root.render(<SourceModeView tab={sourceTab} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(sourceOnChange).not.toBeNull());

      bridge.setDisk('# 源码页\n\n重写后的链接 [[a-renamed]]\n');
      await act(async () => {
        bridge.emitChange('app');
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector('[data-testid="source-conflict-banner"]')).toBeNull();
      expect(sourceEditorText).toBe('# 源码页\n\n重写后的链接 [[a-renamed]]\n');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(bridge.writes).toBe(0);

      await act(async () => root.unmount());
    } finally {
      vi.useRealTimers();
      sourceOnChange = null;
    }
  });

  it('未带 origin 的真外部事件保持 conflict 语义（回归保护）', async () => {
    vi.useFakeTimers();
    try {
      const bridge = installBridge('source', 875);
      const { container, root } = mountSource();
      await act(async () => {
        root.render(<SourceModeView tab={sourceTab} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(sourceOnChange).not.toBeNull());

      act(() => sourceOnChange?.('# 源码页\n\n本地修改\n'));
      bridge.setDisk('# 外部版本\n');
      await act(async () => {
        bridge.emitChange(); // 无 origin = 外部修改
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector('[data-testid="source-conflict-banner"]')).not.toBeNull();
      // 自动保存被暂停：不产生新写盘
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(bridge.writes).toBe(0);

      await act(async () => root.unmount());
    } finally {
      vi.useRealTimers();
      sourceOnChange = null;
    }
  });
});

describe('EditorView 收到 origin:"app" 的 fs:changed', () => {
  /** 在文档末尾追加一个段落（模拟用户键入；不动首 H1，避免触发改名联动）。 */
  function typeAtEnd(text: string): boolean {
    const kernel = getActiveEditor();
    if (!kernel) return false;
    const end = kernel.editor.state.doc.content.size;
    return kernel.editor.chain().insertContentAt(end, `\n\n${text}`).run();
  }

  async function mountBlock(): Promise<{
    container: HTMLElement;
    root: ReturnType<typeof createRoot>;
  }> {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<EditorView tab={blockTab} />);
    });
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    return { container, root };
  }

  it('写入后 120ms 事件窗口内继续输入：echo 不弹冲突、不丢输入、下一笔正常落盘', async () => {
    const bridge = installBridge('block', 100);
    const { container, root } = await mountBlock();

    await act(async () => {
      expect(typeAtEnd('第一笔')).toBe(true);
    });
    await act(async () => {
      await vi.waitFor(() => expect(bridge.writes).toBe(1));
    });

    // 保存落盘后事件窗口内继续输入（dirty），随后自身写入的 echo 到达
    await act(async () => {
      expect(typeAtEnd('第二笔')).toBe(true);
      bridge.emitChange('app');
    });
    expect(container.querySelector('[data-testid="editor-conflict-banner"]')).toBeNull();

    await act(async () => {
      expect(typeAtEnd('第三笔')).toBe(true);
    });
    await act(async () => {
      await vi.waitFor(() => expect(bridge.writes).toBe(2));
    });
    expect(bridge.diskText).toContain('第二笔');
    expect(container.querySelector('[data-testid="editor-conflict-banner"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('dirty 时收到应用联动改写（磁盘版本变化）：仅刷新基线，autosave 顺滑落盘', async () => {
    const bridge = installBridge('block', 100);
    const { container, root } = await mountBlock();

    await act(async () => {
      expect(typeAtEnd('第一笔')).toBe(true);
    });
    await act(async () => {
      await vi.waitFor(() => expect(bridge.writes).toBe(1));
    });

    // 继续输入保持 dirty；应用自身（如 renameWithLinks 联动）改写了磁盘与本页
    await act(async () => {
      expect(typeAtEnd('第二笔')).toBe(true);
      bridge.setDisk('# 测试页\n\n第一笔\n\n重写后的链接 [[a-renamed]]\n');
      bridge.emitChange('app');
    });
    // 绝不弹冲突：我们的写入不可能与用户意图冲突
    expect(container.querySelector('[data-testid="editor-conflict-banner"]')).toBeNull();

    await act(async () => {
      expect(typeAtEnd('第三笔')).toBe(true);
    });
    await act(async () => {
      await vi.waitFor(() => expect(bridge.writes).toBe(2));
    });
    expect(bridge.diskText).toContain('第二笔');
    expect(container.querySelector('[data-testid="editor-conflict-banner"]')).toBeNull();

    await act(async () => root.unmount());
  });
});
