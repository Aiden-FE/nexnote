// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultVaultSettings } from '@nexnote/shared';
import { TextSelection } from '@tiptap/pm/state';
import { EditorView } from '../src/editor/EditorView';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import { getActiveEditor } from '../src/editor/active-editor';
import { useSettingsStore } from '../src/stores/settings-store';
import { useTabStore, type TabDescriptor } from '../src/stores/tab-store';

/**
 * DEV-035 验收 1/3/4：块编辑与源码模式的顶部均为单行工具栏，且不再有独立左上角
 * 文件名；工具栏动作真实作用到编辑器内核；AI 入口在工具栏上可开可键盘选择。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/editor/source/codemirror-host', () => ({
  createSourceEditor: (_parent: HTMLElement, options: { initialText: string }) => ({
    scrollDOM: document.createElement('div'),
    getText: () => options.initialText,
    setText: () => undefined,
    focus: () => undefined,
    destroy: () => undefined,
  }),
}));

vi.mock('../src/editor/source/LivePreview', () => ({ LivePreview: () => null }));

const blockTab: TabDescriptor = {
  id: 'toolbar-block',
  kind: 'page',
  title: '测试页',
  pagePath: '测试页.md',
  format: 'native-block',
  editorMode: 'block',
  createdAt: 1,
};

const sourceTab: TabDescriptor = {
  id: 'toolbar-source',
  kind: 'page',
  title: '源码页',
  pagePath: '源码页.md',
  format: 'markdown',
  editorMode: 'source',
  previewVisible: false,
  createdAt: 1,
};

let container: HTMLDivElement;
let root: Root | null = null;

function installBridge(diskText: string): void {
  useSettingsStore.setState({
    vault: {
      ...defaultVaultSettings(),
      editor: { ...defaultVaultSettings().editor, autoSaveMs: 10_000 },
    },
  });
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string) => {
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
    }),
    on: () => () => undefined,
  };
}

async function mount(node: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const toolbar = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-testid="editor-toolbar"]');
const entry = (id: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`[data-testid="toolbar-entry-${id}"]`);

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  document.body.innerHTML = '';
  delete (window as unknown as { nexnote?: unknown }).nexnote;
  useTabStore.setState({ tabs: [], activeTabId: null });
});

describe('块编辑工具栏（DEV-035）', () => {
  it('顶部为单行工具栏：无独立文件名，动作与 AI 入口齐备', async () => {
    installBridge('# 测试页\n\n正文一段\n');
    await mount(<EditorView tab={blockTab} />);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());

    const bar = toolbar();
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('role')).toBe('toolbar');
    // 文件名只在 Tab 显示：工具栏不再回显页面路径
    expect(bar?.textContent ?? '').not.toContain('测试页.md');
    // 路径仍作为编辑器根属性存在（Tab 联动与既有契约不受影响）
    expect(document.querySelector('[data-testid="editor-view"]')?.getAttribute('data-path')).toBe(
      '测试页.md',
    );
    for (const id of [
      'format:bold',
      'format:italic',
      'format:strike',
      'format:code',
      'format:link',
      'format:wikilink',
      'insert:image',
      'insert:attachment',
      'ai',
    ]) {
      expect(entry(id), id).not.toBeNull();
    }
  });

  it('工具栏格式化动作真实作用于内核选区', async () => {
    installBridge('# 测试页\n\n正文一段\n');
    await mount(<EditorView tab={blockTab} />);
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
    act(() => {
      kernel.editor.view.dispatch(
        kernel.editor.view.state.tr.setSelection(
          TextSelection.create(doc, from, from + '正文'.length),
        ),
      );
    });
    await act(async () => {
      entry('format:bold')?.click();
      await Promise.resolve();
    });
    expect(kernel.getMarkdown()).toContain('**正文**');
  });

  it('AI 入口在工具栏上整体可开、子动作键盘可达', async () => {
    installBridge('# 测试页\n\n正文一段\n');
    await mount(<EditorView tab={blockTab} />);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    const ai = entry('ai');
    expect(ai?.getAttribute('aria-haspopup')).toBe('menu');
    await act(async () => {
      ai?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
    });
    const menu = document.querySelector('[data-testid="toolbar-menu"]');
    expect(menu).not.toBeNull();
    // 询问 AI + 六个白名单写作动作
    expect(menu?.querySelectorAll('[role="menuitem"]').length).toBe(7);
    expect(document.activeElement).toBe(
      menu?.querySelector<HTMLElement>('[data-testid="toolbar-menu-item-ai:ask"]'),
    );
  });
});

describe('源码模式工具栏（DEV-035）', () => {
  it('顶部为单行工具栏：无独立文件名，编辑/AI/视图动作齐备', async () => {
    installBridge('---\ntitle: 源码页\n---\n\n# 源码页\n\n正文\n');
    await mount(<SourceModeView tab={sourceTab} />);

    const bar = toolbar();
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('role')).toBe('toolbar');
    expect(bar?.textContent ?? '').not.toContain('源码页.md');
    for (const id of [
      'format:bold',
      'format:italic',
      'format:strike',
      'format:code',
      'format:link',
      'format:wikilink',
      'ai',
      'view:block',
      'view:preview',
    ]) {
      expect(entry(id), id).not.toBeNull();
    }
    // 属性 Popover 触发器仍在工具栏上（不随文件名移除而丢失）
    expect(document.querySelector('[data-testid="document-properties-trigger"]')).not.toBeNull();
    expect(
      document.querySelector('[data-testid="source-mode-view"]')?.getAttribute('data-path'),
    ).toBe('源码页.md');
  });
});
