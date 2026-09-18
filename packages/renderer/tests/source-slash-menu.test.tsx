// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { undo, redo } from '@codemirror/commands';
import { pluginQuickInsertMetadata } from '@nexnote/shared';
import { createSourceEditor } from '../src/editor/source/codemirror-host';
import { getSourceEditorForTab } from '../src/editor/source/active-source-editor';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import { useTabStore, type TabDescriptor } from '../src/stores/tab-store';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { sourceSlashMenu } from '../src/editor/source/source-slash-menu';

interface Fixture {
  readonly parent: HTMLElement;
  readonly editor: ReturnType<typeof createSourceEditor>;
  readonly ai: ReturnType<typeof vi.fn>;
  cleanup(): void;
}

function mount(
  text = '',
  enabled = true,
  overrides: Partial<Parameters<typeof sourceSlashMenu>[0]> = {},
): Fixture {
  const parent = document.createElement('div');
  document.body.append(parent);
  const ai = vi.fn(() => true);
  const editor = createSourceEditor(parent, {
    initialText: text,
    onChange: () => undefined,
    extraExtensions: [sourceSlashMenu({ isEnabled: () => enabled, onAiInsert: ai, ...overrides })],
  });
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  return {
    parent,
    editor,
    ai,
    cleanup: () => {
      editor.destroy();
      parent.remove();
    },
  };
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Deliberately walk browser events, not `view.dispatch`: DOM insertion causes CodeMirror's input path. */
async function type(fixture: Fixture, text: string): Promise<void> {
  const dom = fixture.editor.view.contentDOM;
  dom.focus();
  for (const character of text) {
    dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: character, bubbles: true, cancelable: true }),
    );
    dom.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: character,
      }),
    );
    const pos = fixture.editor.view.state.selection.main.head;
    const at = fixture.editor.view.domAtPos(pos);
    let node: Text;
    let offset: number;
    if (at.node.nodeType === Node.TEXT_NODE) {
      node = at.node as Text;
      offset = at.offset;
      node.insertData(offset, character);
    } else {
      node = document.createTextNode(character);
      at.node.insertBefore(node, at.node.childNodes[at.offset] ?? null);
      offset = 0;
    }
    const range = document.createRange();
    range.setStart(node, offset + character.length);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    dom.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }),
    );
    await Promise.resolve();
    await Promise.resolve();
  }
}
function press(fixture: Fixture, key: string): void {
  fixture.editor.view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Markdown CodeMirror / 快捷输入（DEV-053）', () => {
  it.each([
    ['', '/h2', '## '],
    ['# ', '/h2', '## '],
    ['- ', '/task', '- [ ] '],
    ['> ', '/quote', '> '],
  ])('真实 DOM 输入在 %s 空行打开并转换', async (prefix, query, expected) => {
    const fixture = mount(prefix);
    await type(fixture, query);
    expect(fixture.parent.querySelector('[data-slash-menu]')?.getAttribute('style')).not.toContain(
      'display: none',
    );
    press(fixture, 'Enter');
    expect(fixture.editor.getText()).toBe(expected);
    expect(undo(fixture.editor.view)).toBe(true);
    expect(fixture.editor.getText()).toBe(`${prefix}${query}`);
    expect(redo(fixture.editor.view)).toBe(true);
    expect(fixture.editor.getText()).toBe(expected);
    fixture.cleanup();
  });

  it.each([
    ['fence', '```ts\n', '/h2'],
    ['inline code', '`', '/h2'],
    ['URL', 'https:', '//host'],
    ['path', '', '/Users/path'],
    ['math', '$x', '/h2'],
    ['word', 'word', '/h2'],
  ])('在 %s 中普通 / 不触发且保留源码', async (label, prefix, input) => {
    const fixture = mount(prefix);
    await type(fixture, input);
    expect(fixture.parent.querySelector('[data-slash-menu]')?.getAttribute('style')).toContain(
      'display: none',
    );
    expect(fixture.editor.getText()).toBe(`${prefix}${input}`);
    fixture.cleanup();
  });

  it('分组、别名、键盘选择、结构边界与行内双链复用共享目录', async () => {
    const structure = mount('正文 后文');
    structure.editor.view.dispatch({ selection: { anchor: 3 } });
    await type(structure, '/表格');
    const table = structure.parent.querySelector('[data-slash-item="insert:table"]');
    expect(table?.querySelector('[data-slash-icon="table"]')?.textContent).toBe('▦');
    expect(structure.parent.querySelector('.nexnote-slash-menu__group')?.textContent).toBe('插入');
    press(structure, 'Tab');
    expect(structure.editor.getText()).toBe(
      '正文 后文\n\n| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n',
    );
    expect(undo(structure.editor.view)).toBe(true);
    expect(structure.editor.getText()).toBe('正文 /表格后文');
    structure.cleanup();

    const inline = mount('正文 ');
    await type(inline, '/双链');
    press(inline, 'Enter');
    expect(inline.editor.getText()).toBe('正文 [[]]');
    expect(inline.editor.view.state.selection.main.head).toBe('正文 [['.length);
    inline.cleanup();
  });

  it('Escape、Backspace、空态与 IME 保持可预测原文', async () => {
    const fixture = mount();
    await type(fixture, '/二级标题');
    press(fixture, 'Escape');
    expect(fixture.editor.getText()).toBe('/二级标题');
    await type(fixture, ' ');
    await type(fixture, '/不存在');
    expect(fixture.parent.querySelector('[data-slash-empty]')).not.toBeNull();
    press(fixture, 'Enter');
    expect(fixture.editor.getText()).toBe('/二级标题 /不存在');
    for (let i = 0; i < '不存在'.length + 1; i++) press(fixture, 'Backspace');
    expect(fixture.parent.querySelector('[data-slash-menu]')?.getAttribute('style')).toContain(
      'display: none',
    );
    fixture.editor.view.contentDOM.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    await type(fixture, '/');
    fixture.editor.view.contentDOM.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    );
    expect(fixture.parent.querySelector('[data-slash-menu]')?.getAttribute('style')).toContain(
      'display: none',
    );
    fixture.cleanup();
  });

  it('CRLF、frontmatter、尾空行与未触及区域逐字节保真', async () => {
    const original = '---\r\ntitle: 保留\r\n---\r\n\r\n正文\r\n\r\n尾部\r\n\r\n';
    const fixture = mount(original);
    fixture.editor.view.dispatch({
      selection: { anchor: fixture.editor.view.state.doc.line(6).from },
    });
    await type(fixture, '/h2');
    press(fixture, 'Enter');
    expect(fixture.editor.getText()).toBe(
      '---\r\ntitle: 保留\r\n---\r\n\r\n正文\r\n## \r\n尾部\r\n\r\n',
    );
    expect(undo(fixture.editor.view)).toBe(true);
    expect(fixture.editor.getText()).toBe(
      original.replace('正文\r\n\r\n尾部', '正文\r\n/h2\r\n尾部'),
    );
    fixture.cleanup();
  });

  it.each([
    ['/h1', '# '],
    ['/h3', '### '],
    ['/h4', '#### '],
    ['/h5', '##### '],
    ['/h6', '###### '],
    ['/paragraph', ''],
    ['/list', '- '],
    ['/ordered', '1. '],
    ['/code', '```\n\n```'],
  ])('空行 %s 转换为 %s，单步撤销', async (query, expected) => {
    const fixture = mount();
    await type(fixture, query);
    press(fixture, 'Enter');
    expect(fixture.editor.getText()).toBe(expected);
    expect(undo(fixture.editor.view)).toBe(true);
    expect(fixture.editor.getText()).toBe(query);
    fixture.cleanup();
  });

  it('菜单提供按钮键盘激活，扩展异常不阻断普通源码输入', async () => {
    const broken = mount('', true, {
      pluginActions: () => {
        throw new Error('plugin registry unavailable');
      },
    });
    await expect(type(broken, '/h2')).resolves.toBeUndefined();
    expect(broken.editor.getText()).toBe('/h2');
    broken.cleanup();

    const fixture = mount();
    await type(fixture, '/h2');
    const button = fixture.parent.querySelector<HTMLButtonElement>('[data-slash-item="block:heading:2"]')!;
    button.focus();
    button.click();
    expect(fixture.editor.getText()).toBe('## ');
    fixture.cleanup();
  });

  it('媒体动作等待成功导入，取消或失效的异步结果保留 trigger', async () => {
    let complete!: (path: string | null) => void;
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createSourceEditor(parent, {
      initialText: '',
      onChange: () => undefined,
      extraExtensions: [
        sourceSlashMenu({
          isEnabled: () => true,
          onAiInsert: () => undefined,
          importMedia: () =>
            new Promise((resolve) => {
              complete = resolve;
            }),
        }),
      ],
    });
    const fixture: Fixture = {
      parent,
      editor,
      ai: vi.fn(),
      cleanup: () => {
        editor.destroy();
        parent.remove();
      },
    };
    await type(fixture, '/图片');
    press(fixture, 'Enter');
    expect(editor.getText()).toBe('/图片');
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    complete(null);
    await Promise.resolve();
    expect(editor.getText()).toBe('/图片');
    fixture.cleanup();
  });

  it('禁用时不创建入口，AI 仅在确认和显式指令后调用', async () => {
    const preview = mount('', false);
    await type(preview, '/h2');
    expect(preview.parent.querySelector('[data-slash-menu]')?.getAttribute('style')).toContain(
      'display: none',
    );
    preview.cleanup();

    const ai = mount();
    const prompt = vi.fn(() => '补充说明');
    window.prompt = prompt;
    await type(ai, '/AI');
    expect(ai.parent.querySelector('[data-slash-item="ai:insert"]')).not.toBeNull();
    expect(ai.ai).not.toHaveBeenCalled();
    ai.parent
      .querySelector<HTMLElement>('[data-slash-item="ai:insert"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(prompt).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(ai.ai).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(ai.editor.getText()).toBe(''));
    ai.cleanup();
  });
  it('AI 取消指令或启动失败保留 /query，确认后接收结果仅写入原光标', async () => {
    const cancelled = mount();
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null);
    await type(cancelled, '/AI');
    cancelled.parent
      .querySelector<HTMLElement>('[data-slash-item="ai:insert"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(cancelled.ai).not.toHaveBeenCalled();
    expect(cancelled.editor.getText()).toBe('/AI');
    cancelled.cleanup();

    const failed = mount('', true, { onAiInsert: () => Promise.resolve(false) });
    vi.spyOn(window, 'prompt').mockReturnValueOnce('扩写');
    await type(failed, '/AI');
    failed.parent
      .querySelector<HTMLElement>('[data-slash-item="ai:insert"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(failed.editor.getText()).toBe('/AI');
    failed.cleanup();

    let apply!: (generated: string) => void;
    const started = mount('前文 后文', true, {
      onAiInsert: (_view, _instruction, accept) => {
        apply = accept;
        return Promise.resolve(true);
      },
    });
    started.editor.view.dispatch({ selection: { anchor: 3 } });
    vi.spyOn(window, 'prompt').mockReturnValueOnce('扩写');
    await type(started, '/AI');
    started.parent
      .querySelector<HTMLElement>('[data-slash-item="ai:insert"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(started.editor.getText()).toBe('前文 后文'));
    apply('补充');
    expect(started.editor.getText()).toBe('前文 补充后文');
    expect(undo(started.editor.view)).toBe(true);
    expect(started.editor.getText()).toBe('前文 后文');
    started.cleanup();
  });

  it('AI 已启动但文档变化或换 tab 后 Accept 永久失效', async () => {
    let apply!: (generated: string) => void;
    let active = true;
    const fixture = mount('', true, {
      isEnabled: () => active,
      onAiInsert: (_view, _instruction, accept) => {
        apply = accept;
        return true;
      },
    });
    vi.spyOn(window, 'prompt').mockReturnValueOnce('扩写');
    await type(fixture, '/AI');
    fixture.parent
      .querySelector<HTMLElement>('[data-slash-item="ai:insert"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fixture.editor.getText()).toBe(''));
    await type(fixture, '改');
    expect(undo(fixture.editor.view)).toBe(true);
    const restored = fixture.editor.getText();
    apply('不应写入');
    expect(fixture.editor.getText()).toBe(restored);
    active = false;
    apply('不应写入');
    expect(fixture.editor.getText()).toBe(restored);
    fixture.cleanup();
  });

  it('插件能力过滤、失败与成功均精确保留或消费，插入保持单步 undo', async () => {
    const meta = pluginQuickInsertMetadata('block');
    let allowed = false;
    const fixture = mount('', true, {
      pluginActions: () => [
        {
          id: 'plugin:demo',
          name: '插件示例',
          icon: meta.icon,
          semantic: 'insert',
          group: 'insert',
          modes: ['source'],
          quickInsert: meta.quickInsert,
          available: () => allowed,
          run: async () => '```nexnote-plugin:demo:card\n{}\n```',
        },
      ],
    });
    await type(fixture, '/插件示例');
    expect(fixture.parent.querySelector('[data-slash-empty]')).not.toBeNull();
    press(fixture, 'Enter');
    expect(fixture.editor.getText()).toBe('/插件示例');
    allowed = true;
    press(fixture, 'Backspace');
    await type(fixture, '例');
    expect(fixture.parent.querySelector('[data-slash-item="plugin:demo"]')).not.toBeNull();
    press(fixture, 'Enter');
    await vi.waitFor(() => expect(fixture.editor.getText()).toContain('nexnote-plugin:demo:card'));
    expect(fixture.editor.getText()).not.toContain('/插件示例');
    expect(undo(fixture.editor.view)).toBe(true);
    expect(fixture.editor.getText()).toBe('/插件示例');
    fixture.cleanup();
  });
});

describe('SourceModeView 三视图真实 CodeMirror 挂载', () => {
  const page: TabDescriptor = {
    id: 'slash-markdown-page',
    kind: 'page',
    format: 'markdown',
    editorMode: 'source',
    title: 'Markdown',
    pagePath: 'Markdown.md',
    markdownView: 'source',
    createdAt: 1,
  };
  it.each(['source', 'split', 'preview'] as const)('%s 视图仅编辑侧响应真实输入', async (mode) => {
    const writes: string[] = [];
    (window as unknown as { nexnote: unknown }).nexnote = {
      invoke: vi.fn(async (channel: string, payload?: unknown) => {
        if (channel === 'fs:readTextFile') return { ok: true, data: '# 原标题\n\n' };
        if (channel === 'fs:stat')
          return {
            ok: true,
            data: {
              path: page.pagePath,
              name: page.pagePath,
              kind: 'file',
              size: 12,
              modifiedAt: 'v1',
            },
          };
        if (channel === 'fs:writeTextFile') {
          writes.push((payload as { content: string }).content);
          return {
            ok: true,
            data: {
              path: page.pagePath,
              name: page.pagePath,
              kind: 'file',
              size: 12,
              modifiedAt: 'v2',
            },
          };
        }
        if (channel === 'fs:exists') return { ok: true, data: false };
        if (channel === 'fs:listDir') return { ok: true, data: [] };
        return { ok: true, data: null };
      }),
      on: () => () => undefined,
    };
    const tab = { ...page, markdownView: mode };
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourceModeView tab={tab} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(getSourceEditorForTab(tab.id)?.view.contentDOM).not.toBeNull());
    const dom = getSourceEditorForTab(tab.id)!.view.contentDOM;
    if (mode !== 'preview') {
      // Real keyboard and DOM input on the actual SourceModeView instance (not an isolated extension).
      const handle = getSourceEditorForTab(tab.id)!;
      expect(handle.view.contentDOM).toBe(dom);
      await act(async () => {
        handle.view.dispatch({ selection: { anchor: handle.view.state.doc.length } });
        const fixture: Fixture = {
          parent: container,
          editor: handle,
          ai: vi.fn(),
          cleanup: () => undefined,
        };
        await type(fixture, '/h2');
      });

      expect(
        container.querySelector<HTMLElement>('[data-testid=source-editor-pane] [data-slash-menu]')
          ?.style.display,
      ).toBe('block');
      dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      expect(
        container.querySelector<HTMLElement>('[data-testid=source-editor-pane] [data-slash-menu]')
          ?.style.display,
      ).toBe('none');
    } else {
      expect(
        container.querySelector<HTMLElement>('[data-testid=source-editor-pane] [data-slash-menu]')
          ?.style.display,
      ).toBe('none');
      expect(
        container.querySelector('[data-testid="source-editor-pane"]')?.getAttribute('aria-hidden'),
      ).toBe('true');
    }
    expect(writes).toEqual([]);
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    delete (window as unknown as { nexnote?: unknown }).nexnote;
    useTabStore.setState({ tabs: [], activeTabId: null });
  });
});
