// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, defaultVaultSettings, translate } from '@nexnote/shared';
import { EditorView } from '../src/editor/EditorView';
import { getActiveEditor } from '../src/editor/active-editor';
import { setLanguage } from '../src/lib/i18n';
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
  setLanguage('zh-CN');
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

  it('保存期间的新增输入会排队写盘，之后外部修改在 clean 状态静默重载', async () => {
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
    await act(async () => {
      await started;
    });
    await act(async () => {
      expect(typeAtEnd('第二笔')).toBe(true);
    });
    await act(async () => {
      releaseFirstWrite();
      await bridge.firstSaveStat;
      await Promise.resolve();
    });
    expect(bridge.writes).toBe(2);

    await act(async () => {
      bridge.emitExternalChange('# 外部版本\n');
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="editor-conflict-banner"]')).toBeNull();
    });

    await act(async () => root.unmount());
  });
});

describe('EditorView 冲突与保存状态双语（ADR-0023 阶段④第十一批）', () => {
  it('冲突横幅、操作按钮与保存失败状态按词典成文，en-US 无中文残留', async () => {
    setLanguage('en-US');
    const bridge = installBridge({ autoSaveMs: 30 });
    const { container, root } = await mountEditor();

    await act(async () => {
      expect(typeAtEnd('external change')).toBe(true);
      bridge.emitExternalChange('# External version\n');
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="editor-conflict-banner"]')).not.toBeNull();
    });

    const banner = container.querySelector('[data-testid="editor-conflict-banner"]');
    expect(banner?.textContent).toContain(
      translate(CATALOGS['en-US'], 'source.conflict.banner', 'en-US'),
    );
    // 冲突横幅接管提示；kernel 重抛的内部「等待用户选择」不得上屏
    // （EditorView.onSaveError 的 conflictRef 分支）。
    expect(container.innerHTML).not.toContain(
      translate(CATALOGS['en-US'], 'source.conflict.internalError', 'en-US'),
    );

    // 冲突期间继续输入 → save() 提前抛出内部信号 → kernel 转交 onSaveError。
    // 该分支必须早退，否则内部信号会覆盖成「保存失败：…」的 aria-label。
    await act(async () => {
      expect(typeAtEnd('typed while conflicted')).toBe(true);
    });
    // 冲突状态下 save() 会提前 throw，不落盘；等防抖窗口过去，确认无写入。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(bridge.writes).toBe(0);
    const afterTyping = container.querySelector('[data-testid="editor-save-status"]');
    expect(afterTyping?.getAttribute('aria-label') ?? '').not.toContain(
      translate(CATALOGS['en-US'], 'source.conflict.internalError', 'en-US'),
    );
    const buttons = [...(banner?.querySelectorAll('button') ?? [])].map(
      (button) => button.textContent?.trim() ?? '',
    );
    expect(buttons).toContain(translate(CATALOGS['en-US'], 'source.conflict.keepLocal', 'en-US'));
    expect(buttons).toContain(translate(CATALOGS['en-US'], 'source.conflict.takeDisk', 'en-US'));
    expect(banner?.textContent).not.toMatch(/[\u4e00-\u9fff]/);

    const status = container.querySelector('[data-testid="editor-save-status"]');
    expect(status?.textContent).toContain(
      translate(CATALOGS['en-US'], 'source.saveStatus.saved', 'en-US'),
    );
    expect(status?.textContent).not.toMatch(/[\u4e00-\u9fff]/);

    await act(async () => root.unmount());
  });

  it('保存失败状态按词典成文，en-US 无中文残留', async () => {
    setLanguage('en-US');
    const bridge = installBridge({
      autoSaveMs: 50,
      onWrite: () => Promise.reject(new Error('disk unavailable')),
    });
    const { container, root } = await mountEditor();

    await act(async () => {
      expect(typeAtEnd('failing save')).toBe(true);
    });
    await vi.waitFor(() => {
      expect(bridge.writes).toBeGreaterThan(0);
    });
    await vi.waitFor(() => {
      const status = container.querySelector('[data-testid="editor-save-status"]');
      expect(status?.textContent).toContain(
        translate(CATALOGS['en-US'], 'source.saveStatus.error', 'en-US'),
      );
    });

    const status = container.querySelector('[data-testid="editor-save-status"]');
    expect(status?.textContent).not.toMatch(/[\u4e00-\u9fff]/);
    const label = status?.getAttribute('aria-label') ?? '';
    expect(label).toContain(translate(CATALOGS['en-US'], 'source.saveStatus.error', 'en-US'));
    expect(label).toContain('disk unavailable');
    // 拼接分隔符必须随界面语言成文：英文界面不得残留中文全角冒号（ADR-0023）。
    expect(label).toBe(
      translate(CATALOGS['en-US'], 'common.withColon', 'en-US', {
        text: translate(CATALOGS['en-US'], 'source.saveStatus.error', 'en-US'),
        detail: 'disk unavailable',
      }),
    );
    expect(label).not.toMatch(/[\u4e00-\u9fff]/);

    await act(async () => root.unmount());
  });
});
