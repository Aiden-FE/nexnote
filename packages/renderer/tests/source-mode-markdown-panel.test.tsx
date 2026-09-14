// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultVaultSettings } from '@nexnote/shared';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import { useSettingsStore } from '../src/stores/settings-store';
import type { TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let initialEditorText: string | null = null;

vi.mock('../src/editor/source/codemirror-host', () => ({
  createSourceEditor: (
    _parent: HTMLElement,
    options: { initialText: string; onChange(text: string): void },
  ) => {
    initialEditorText = options.initialText;
    let text = options.initialText;
    return {
      scrollDOM: document.createElement('div'),
      getText: () => text,
      setText: (next: string) => {
        text = next;
      },
      focus: () => undefined,
      destroy: () => undefined,
    };
  },
}));

vi.mock('../src/editor/source/LivePreview', () => ({
  LivePreview: () => null,
}));

const tab: TabDescriptor = {
  id: 'md-panel-test',
  kind: 'page',
  title: '属性面板页',
  pagePath: '属性面板页.md',
  format: 'markdown',
  editorMode: 'source',
  previewVisible: false,
  createdAt: 1,
};

const WITH_YAML = '---\ntitle: 原值\ncustom: "keep me"\n---\n\n# 正文\n\n段落   \n';
const WITHOUT_YAML = '# 无头文档\n\n正文\n';
const BROKEN_YAML = '---\ntitle: ok\n  bad indent: value\n---\n\n正文\n';

interface Bridge {
  readonly writes: string[];
}

function installBridge(content: string): Bridge {
  const writes: string[] = [];
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'fs:readTextFile') return { ok: true, data: content };
      if (channel === 'fs:stat') {
        return {
          ok: true,
          data: {
            path: tab.pagePath,
            name: tab.pagePath,
            kind: 'file',
            size: content.length,
            modifiedAt: 'v1',
          },
        };
      }
      if (channel === 'fs:writeTextFile') {
        const next = (payload as { content: string }).content;
        writes.push(next);
        return {
          ok: true,
          data: {
            path: tab.pagePath,
            name: tab.pagePath,
            kind: 'file',
            size: next.length,
            modifiedAt: `v${writes.length + 1}`,
          },
        };
      }
      if (channel === 'fs:exists') return { ok: true, data: false };
      if (channel === 'fs:listDir') return { ok: true, data: [] };
      return { ok: true, data: null };
    }),
    on: () => () => undefined,
  };
  return { writes };
}

async function renderView(
  content: string,
): Promise<{ bridge: Bridge; root: ReturnType<typeof createRoot> }> {
  const bridge = installBridge(content);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SourceModeView tab={tab} />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(initialEditorText).not.toBeNull());
  return { bridge, root };
}

async function unmount(root: ReturnType<typeof createRoot>): Promise<void> {
  await act(async () => {
    root.unmount();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openCatalog(): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="document-properties-trigger"]')?.click();
    await Promise.resolve();
  });
  act(() => {
    document.querySelector<HTMLButtonElement>('[data-testid="add-field-trigger"]')?.click();
  });
}

function clickCatalogItem(key: string): void {
  act(() => {
    document
      .querySelector<HTMLButtonElement>(`[data-testid="field-catalog-item"][data-field="${key}"]`)
      ?.click();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  initialEditorText = null;
  useSettingsStore.setState({
    vault: {
      ...defaultVaultSettings(),
      editor: { ...defaultVaultSettings().editor, autoSaveMs: 40 },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { nexnote?: unknown }).nexnote;
  document.body.innerHTML = '';
});

describe('Markdown 文档属性面板（DEV-025）', () => {
  it('YAML 头从 CodeMirror 正文抽离，属性面板默认关闭并按需打开', async () => {
    const { root } = await renderView(WITH_YAML);
    expect(initialEditorText).toBe('# 正文\n\n段落   \n');
    expect(initialEditorText).not.toContain('title:');
    expect(document.querySelector('[data-testid="frontmatter-panel"]')).toBeNull();
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="document-properties-trigger"]',
    );
    expect(trigger?.textContent).toContain('属性');
    expect(trigger?.getAttribute('title')).toBe('编辑文档属性');
    act(() => trigger?.click());
    expect(document.querySelector('[data-testid="frontmatter-panel"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="frontmatter-field-title"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="frontmatter-field-custom"]')).not.toBeNull();
    await unmount(root);
  });

  it('属性入口支持再次点击、Escape 与点击外部关闭', async () => {
    const { root } = await renderView(WITH_YAML);
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="document-properties-trigger"]',
    );
    act(() => trigger?.click());
    expect(document.querySelector('[data-testid="document-properties-popover"]')).not.toBeNull();
    act(() => trigger?.click());
    expect(document.querySelector('[data-testid="document-properties-popover"]')).toBeNull();
    act(() => trigger?.click());
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('[data-testid="document-properties-popover"]')).toBeNull();
    act(() => trigger?.click());
    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(document.querySelector('[data-testid="document-properties-popover"]')).toBeNull();
    await unmount(root);
  });

  it('未编辑的打开 → 保存往返字节不变（不触发任何写盘）', async () => {
    const { bridge, root } = await renderView(WITH_YAML);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await unmount(root);
    expect(bridge.writes).toEqual([]);
  });

  it('面板添加标准字段仅写回 YAML 头，正文字节原样保留', async () => {
    const { bridge, root } = await renderView(WITH_YAML);
    await openCatalog();
    clickCatalogItem('tags');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await vi.waitFor(() => expect(bridge.writes.length).toBe(1));
    const written = bridge.writes[0] ?? '';
    // 序列化按「标准字段约定序 + 自定义字母序」重排 YAML 头；正文字节原样保留
    expect(written).toBe('---\ntitle: 原值\ntags: []\ncustom: keep me\n---\n\n# 正文\n\n段落   \n');
    await unmount(root);
  });

  it('无 YAML 头的 .md 经面板添加首个字段后生成文件头', async () => {
    const { bridge, root } = await renderView(WITHOUT_YAML);
    expect(initialEditorText).toBe(WITHOUT_YAML);
    await openCatalog();
    clickCatalogItem('title');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await vi.waitFor(() => expect(bridge.writes.length).toBe(1));
    const written = bridge.writes[0] ?? '';
    expect(written.startsWith('---\ntitle:')).toBe(true);
    expect(written.endsWith('# 无头文档\n\n正文\n')).toBe(true);
    await unmount(root);
  });

  it('YAML 解析失败：面板锁定在源码模式并保留原文，不丢数据', async () => {
    const { bridge, root } = await renderView(BROKEN_YAML);
    // 正文仍从编辑框承载，YAML 原文进入锁定的面板源码视图
    expect(initialEditorText).toBe('正文\n');
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="document-properties-trigger"]')?.click();
    });
    const panel = document.querySelector('[data-testid="frontmatter-panel"]');
    expect(panel?.textContent).toContain('源码锁定');
    const yamlEditor = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="frontmatter-yaml-editor"]',
    );
    expect(yamlEditor?.value).toBe('title: ok\n  bad indent: value');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await unmount(root);
    expect(bridge.writes).toEqual([]);
  });
});
