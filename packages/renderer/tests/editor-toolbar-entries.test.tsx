// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultVaultSettings } from '@nexnote/shared';
import { TextSelection } from '@tiptap/pm/state';
import { EditorView } from '../src/editor/EditorView';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import { getActiveEditor } from '../src/editor/active-editor';
import {
  EDITOR_ACTION_MODEL,
  blockToolbarEntries,
  editorAction,
  editorActionsForMode,
  sourceToolbarEntries,
} from '../src/editor/toolbar/entries';
import { useSettingsStore } from '../src/stores/settings-store';
import { useTabStore, type TabDescriptor } from '../src/stores/tab-store';

/**
 * DEV-035/DEV-050 验收：块编辑与源码模式的顶部均为单行 Icon-first 工具栏（无独立
 * 文件名）；常驻集合 +「格式 / 插入 / AI」动作组；工具栏动作真实作用到编辑器内核。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const sourceCommands = vi.hoisted(() => ({
  insertBlock: vi.fn(),
  formatMarkdown: vi.fn(),
}));

vi.mock('../src/editor/source/codemirror-host', () => ({
  createSourceEditor: (_parent: HTMLElement, options: { initialText: string }) => ({
    scrollDOM: document.createElement('div'),
    getText: () => options.initialText,
    setText: () => undefined,
    insertText: () => undefined,
    insertBlock: sourceCommands.insertBlock,
    formatMarkdown: sourceCommands.formatMarkdown,
    indentSelection: () => false,
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
  markdownView: 'source',
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
const menuItem = (id: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`[data-testid="toolbar-menu-item-${id}"]`);
const press = (el: Element, key: string): void => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  sourceCommands.insertBlock.mockReset();
  sourceCommands.formatMarkdown.mockReset();
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

describe('DEV-050 共享动作模型单一数据源', () => {
  it('toolbar 名称/图标/模式能力从共享定义投影，不出现重复漂移', () => {
    const block = blockToolbarEntries({ sourceModeToggle: false });
    const source = sourceToolbarEntries({ isMarkdown: true, markdownView: 'source' });
    for (const entry of [...block, ...source]) {
      if (entry.id.startsWith('menu:') || entry.id.startsWith('view:')) continue;
      const action = editorAction(entry.id);
      expect(entry.label, entry.id).toBe(action.label);
      expect(entry.icon, entry.id).toBe(action.icon);
    }
    expect(editorAction('format:code').label).toBe('行内代码');
    expect(editorAction('format:link').label).toBe('外链');
    expect(editorActionsForMode('source').some((action) => action.id === 'insert:image')).toBe(
      false,
    );
    expect(editorActionsForMode('block').some((action) => action.id === 'format:document')).toBe(
      false,
    );
    expect(EDITOR_ACTION_MODEL.every((action) => action.semantic && action.priority)).toBe(true);
  });
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
      'edit:undo',
      'edit:redo',
      'block:type',
      'format:bold',
      'format:italic',
      'format:wikilink',
      'menu:format',
      'menu:insert',
      'ai',
      'view:outline',
    ]) {
      expect(entry(id), id).not.toBeNull();
    }
  });

  it('格式与插入动作组收纳低频动作，菜单项保留图标与文案', async () => {
    installBridge('# 测试页\n\n正文一段\n');
    await mount(<EditorView tab={blockTab} />);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());

    for (const [menu, ids] of [
      ['menu:format', ['format:strike', 'format:code', 'format:link']],
      [
        'menu:insert',
        [
          'insert:table',
          'insert:image',
          'insert:attachment',
          'insert:mermaid-flowchart',
          'insert:mermaid-gantt',
          'insert:toc',
        ],
      ],
    ] as const) {
      press(entry(menu)!, 'ArrowDown');
      for (const id of ids) {
        const item = menuItem(id);
        expect(item, id).not.toBeNull();
        expect(item?.textContent ?? '').not.toBe('');
        expect(item?.querySelector('svg, [class*="font-semibold"]')).not.toBeNull();
      }
      act(() => entry(menu)?.click());
    }
  });

  it('标题/段落下拉提供正文与 H1-H6，H1 说明文件名同步语义', async () => {
    installBridge('# 测试页\n\n正文一段\n');
    await mount(<EditorView tab={blockTab} />);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    press(entry('block:type')!, 'ArrowDown');
    expect(menuItem('block:paragraph')).not.toBeNull();
    for (let level = 1; level <= 6; level += 1) {
      expect(menuItem(`block:heading:${level}`), `h${level}`).not.toBeNull();
    }
    expect(menuItem('block:heading:1')?.textContent).toContain('页面标题 H1');
    expect(menuItem('block:heading:1')?.textContent).toContain('首个正文 H1 与文件名同步');
  });

  it('复杂跨块标题转换项保持可聚焦并以 aria-label 解释禁用原因', async () => {
    installBridge('# 测试页\n\n正文一段\n');
    await mount(<EditorView tab={blockTab} />);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    const kernel = getActiveEditor()!;
    act(() => {
      kernel.editor.view.dispatch(
        kernel.editor.state.tr.setSelection(
          TextSelection.create(
            kernel.editor.state.doc,
            1,
            kernel.editor.state.doc.content.size - 1,
          ),
        ),
      );
    });
    press(entry('block:type')!, 'ArrowDown');
    const h2 = menuItem('block:heading:2');
    expect(h2?.getAttribute('aria-disabled')).toBe('true');
    expect(h2?.getAttribute('aria-label')).toContain('跨复杂结构');
    h2?.focus();
    expect(document.activeElement).toBe(h2);
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
    // 询问 AI + 光标处 AI 插入 + 六个白名单写作动作 + 全文翻译（DEV-041）
    expect(menu?.querySelectorAll('[role="menuitem"]').length).toBe(9);
    expect(
      menu?.querySelector('[data-testid="toolbar-menu-item-translate:document"]'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(
      menu?.querySelector<HTMLElement>('[data-testid="toolbar-menu-item-ai:ask"]'),
    );
  });
});

describe('DEV-050 工具栏普通交互无副作用', () => {
  it('hover/focus/menu 键盘导航不改正文、不写盘、不改名、不发 AI', async () => {
    installBridge('# 测试页\n\n正文一段\n');
    const invokeSpy = vi.mocked(
      (window as unknown as { nexnote: { invoke: ReturnType<typeof vi.fn> } }).nexnote.invoke,
    );
    await mount(<EditorView tab={blockTab} />);
    await vi.waitFor(() => expect(getActiveEditor()).not.toBeNull());
    const kernel = getActiveEditor()!;
    const markdown = kernel.getMarkdown();
    const revision = kernel.getRevision();
    const calls = invokeSpy.mock.calls.length;
    const bold = entry('format:bold')!;
    act(() => {
      bold.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      bold.focus();
    });
    press(entry('menu:format')!, 'ArrowDown');
    press(document.querySelector('[data-testid="toolbar-menu"]')!, 'ArrowDown');
    press(document.querySelector('[data-testid="toolbar-menu"]')!, 'Escape');
    press(entry('ai')!, 'ArrowDown');
    press(document.querySelector('[data-testid="toolbar-menu"]')!, 'ArrowDown');
    press(document.querySelector('[data-testid="toolbar-menu"]')!, 'Escape');
    await Promise.resolve();
    expect(kernel.getMarkdown()).toBe(markdown);
    expect(kernel.getRevision()).toBe(revision);
    expect(invokeSpy.mock.calls.length).toBe(calls);
    expect(document.querySelector('[data-testid="editor-view"]')?.getAttribute('data-path')).toBe(
      '测试页.md',
    );
  });
});

describe('Markdown 预览视图（DEV-045）', () => {
  const previewTab: TabDescriptor = {
    id: 'preview-tab',
    kind: 'page',
    title: '预览页',
    pagePath: '预览页.md',
    format: 'markdown',
    editorMode: 'source',
    markdownView: 'preview',
    createdAt: 1,
  };

  it('预览视图只保留视图切换器，无编辑动作与属性入口', async () => {
    installBridge('# 预览页\n\n正文\n');
    await mount(<SourceModeView tab={previewTab} />);

    const bar = toolbar();
    expect(bar).not.toBeNull();
    for (const id of ['view:source', 'view:split', 'view:preview', 'view:outline']) {
      expect(entry(id), id).not.toBeNull();
    }
    // 零编辑态：格式化 / AI / 属性 Popover 入口全部消失
    for (const id of [
      'format:bold',
      'format:selection',
      'format:document',
      'edit:undo',
      'edit:redo',
      'insert:table',
      'insert:mermaid-flowchart',
      'insert:mermaid-gantt',
      'insert:toc',
      'ai',
    ]) {
      expect(entry(id), id).toBeNull();
    }
    expect(document.querySelector('[data-testid="document-properties-trigger"]')).toBeNull();
    // 编辑器实例保留但不展示（隐藏 host 仍挂载，aria-hidden 标记不可达）
    const pane = document.querySelector('[data-testid="source-editor-pane"]');
    expect(pane?.getAttribute('aria-hidden')).toBe('true');
    // Renderer 挂载态也不允许遗留可见划词工具栏（CodeMirror 实例可保留但 selection UI 排除）。
    expect(document.querySelector('[data-source-selection-bubble]')).toBeNull();
    expect(document.querySelector('[data-selection-bubble]')).toBeNull();
  });
});

describe('DEV-050 预览视图只读边界', () => {
  const previewTab: TabDescriptor = {
    id: 'preview-tab',
    kind: 'page',
    title: '预览页',
    pagePath: '预览页.md',
    format: 'markdown',
    editorMode: 'source',
    markdownView: 'preview',
    createdAt: 1,
  };

  it('预览视图工具栏交互不触碰源码缓冲与磁盘', async () => {
    installBridge('# 预览页\n\n正文\n');
    const invokeSpy = vi.mocked(
      (window as unknown as { nexnote: { invoke: ReturnType<typeof vi.fn> } }).nexnote.invoke,
    );
    await mount(<SourceModeView tab={previewTab} />);
    const calls = invokeSpy.mock.calls.length;
    for (const id of ['view:source', 'view:split']) {
      act(() => entry(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    act(() => {
      useTabStore.getState().setMarkdownView('preview-tab', 'preview');
    });
    await act(async () => Promise.resolve());
    expect(invokeSpy.mock.calls.length).toBe(calls);
    expect(sourceCommands.insertBlock).not.toHaveBeenCalled();
    expect(sourceCommands.formatMarkdown).not.toHaveBeenCalled();
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
      'edit:undo',
      'edit:redo',
      'block:type',
      'format:bold',
      'format:italic',
      'format:wikilink',
      'menu:format',
      'menu:insert',
      'ai',
      'view:source',
      'view:split',
      'view:preview',
      'view:outline',
    ]) {
      expect(entry(id), id).not.toBeNull();
    }
    press(entry('menu:format')!, 'ArrowDown');
    expect(menuItem('format:selection')).not.toBeNull();
    expect(menuItem('format:document')).not.toBeNull();
    act(() => entry('menu:format')?.click());
    press(entry('menu:insert')!, 'ArrowDown');
    expect(menuItem('insert:image')).toBeNull();
    expect(menuItem('insert:attachment')).toBeNull();
    act(() => entry('menu:insert')?.click());
    // 属性 Popover 触发器仍在工具栏上（不随文件名移除而丢失）
    expect(document.querySelector('[data-testid="document-properties-trigger"]')).not.toBeNull();
    expect(
      document.querySelector('[data-testid="source-mode-view"]')?.getAttribute('data-path'),
    ).toBe('源码页.md');
  });

  it('表格/mermaid/正文目录与格式化 scope 分发到 SourceEditorHandle', async () => {
    installBridge('# 源码页\n\n正文\n');
    await mount(<SourceModeView tab={sourceTab} />);

    for (const id of [
      'insert:table',
      'insert:mermaid-flowchart',
      'insert:mermaid-gantt',
      'insert:toc',
    ]) {
      press(entry('menu:insert')!, 'ArrowDown');
      act(() => menuItem(id)?.click());
    }
    for (const id of ['format:selection', 'format:document']) {
      press(entry('menu:format')!, 'ArrowDown');
      act(() => menuItem(id)?.click());
    }

    expect(sourceCommands.insertBlock).toHaveBeenCalledTimes(4);
    expect(sourceCommands.insertBlock.mock.calls[0]?.[0]).toContain('| 列 1 | 列 2 |');
    expect(sourceCommands.insertBlock.mock.calls[1]?.[0]).toContain('```mermaid\nflowchart TD');
    expect(sourceCommands.insertBlock.mock.calls[2]?.[0]).toContain('```mermaid\ngantt');
    expect(sourceCommands.insertBlock.mock.calls[3]?.[0]).toBe('<!-- nexnote:toc -->');
    expect(sourceCommands.formatMarkdown.mock.calls).toEqual([['selection'], ['document']]);
  });
});
