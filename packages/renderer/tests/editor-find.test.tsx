// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor } from '@nexnote/kernel';
import { EditorFindBar } from '../src/editor/EditorFindBar';
import { findInBlockView, findInSourceView, textMatches } from '../src/editor/find';
import { createSourceEditor } from '../src/editor/source/codemirror-host';
import { sourceFoldState } from '../src/editor/source/heading-fold';
import { useTabStore } from '../src/stores/tab-store';

// The real find bar is mounted beside a real editor, not a mocked onFind callback.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalStore = useTabStore.getState();
const cleanups: Array<() => void | Promise<void>> = [];

async function mountFindBar(tabId: string, onFind: Parameters<typeof EditorFindBar>[0]['onFind']) {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  useTabStore.setState({
    activeTabId: tabId,
    tabs: [{ id: tabId, kind: 'page', title: tabId, createdAt: 1 }],
  });
  await act(async () => root.render(<EditorFindBar tabId={tabId} onFind={onFind} />));
  cleanups.push(async () => act(async () => root.unmount()));
  return host;
}

async function openAndType(host: HTMLElement, query: string, ctrlKey = false) {
  const key = new KeyboardEvent('keydown', {
    key: 'f',
    metaKey: !ctrlKey,
    ctrlKey,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => window.dispatchEvent(key));
  expect(key.defaultPrevented).toBe(true);
  const input = host.querySelector<HTMLInputElement>('[data-testid="editor-find-input"]')!;
  expect(document.activeElement).toBe(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  useTabStore.setState({ activeTabId: originalStore.activeTabId, tabs: originalStore.tabs });
  document.body.innerHTML = '';
});

describe('DEV-056 Unicode 查找 offsets', () => {
  it('按原始 UTF-16 偏移返回命中，fold 扩展不挪动后续 B，代理对亦不越界', () => {
    expect(textMatches('AİB', 'b')).toEqual([{ from: 2, to: 3 }]);
    expect(textMatches('😀İB', 'b')).toEqual([{ from: 3, to: 4 }]);
    expect(textMatches('AİB', 'İ')).toEqual([{ from: 1, to: 2 }]);
    expect(textMatches('ΟΣ', 'ος')).toEqual([{ from: 0, to: 2 }]);
    expect(textMatches('Α ΟΣ Β', 'ος')).toEqual([{ from: 2, to: 4 }]);
    for (const match of textMatches('😀İB', 'b')) {
      expect('😀İB'.slice(match.from, match.to)).toBe('B');
    }
  });

  it('真实 CodeMirror 保留 CRLF 时按 CM 坐标定位 body/emoji/tail，且不会越界', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const source = createSourceEditor(host, {
      initialText: '# A\r\nbody 😀\r\ntail\r\n',
      headingFolding: true,
      onChange: vi.fn(),
    });
    cleanups.push(() => source.destroy());

    expect(findInSourceView(source.view, 'body', 1, true)).toEqual({ current: 1, total: 1 });
    let selection = source.view.state.selection.main;
    expect(source.view.state.sliceDoc(selection.from, selection.to)).toBe('body');
    expect(selection.from).toBe(source.view.state.doc.line(2).from);
    expect(findInSourceView(source.view, '😀', 1, true)).toEqual({ current: 1, total: 1 });
    selection = source.view.state.selection.main;
    expect(source.view.state.sliceDoc(selection.from, selection.to)).toBe('😀');
    expect(findInSourceView(source.view, 'tail', 1, true)).toEqual({ current: 1, total: 1 });
    selection = source.view.state.selection.main;
    expect(source.view.state.sliceDoc(selection.from, selection.to)).toBe('tail');
    expect(selection.to).toBeLessThanOrEqual(source.view.state.doc.length);
    expect(source.getText()).toBe('# A\r\nbody 😀\r\ntail\r\n');
  });

  it('真实 CodeMirror 与 TipTap 将 B 定位到原文而非 case-folded 文本偏移', () => {
    const sourceHost = document.createElement('div');
    const blockHost = document.createElement('div');
    document.body.append(sourceHost, blockHost);
    const source = createSourceEditor(sourceHost, {
      initialText: '# A\nAİB\n',
      headingFolding: true,
      onChange: vi.fn(),
    });
    const block = createEditor(blockHost, { initialMarkdown: '# A ^a\n\nAİB ^body\n' });
    cleanups.push(() => {
      source.destroy();
      block.destroy();
    });
    expect(findInSourceView(source.view, 'b', 1, true)).toEqual({ current: 1, total: 1 });
    const sourceSelection = source.view.state.selection.main;
    expect(source.view.state.sliceDoc(sourceSelection.from, sourceSelection.to)).toBe('B');
    expect(findInBlockView(block.editor.view, 'b', 1, true)).toEqual({ current: 1, total: 1 });
    const { doc, selection } = block.editor.state;
    expect(doc.textBetween(selection.from, selection.to)).toBe('B');
  });
});

describe('DEV-056 TipTap 跨 mark 原文查找', () => {
  it('可在同一个块内跨 text nodes 命中 hello world，不跨块拼接相邻文本', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const kernel = createEditor(host, {
      initialMarkdown: '# A ^a\n\nhello **world** ^first\n\nhello\n\nworld ^second\n',
      slashMenu: false,
      dragHandle: false,
    });
    cleanups.push(() => kernel.destroy());
    const textNodes: Array<{ text: string; pos: number }> = [];
    kernel.editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) textNodes.push({ text: node.text, pos });
    });
    expect(textNodes.some(({ text }) => text === 'hello ')).toBe(true);
    expect(textNodes.some(({ text }) => text === 'world')).toBe(true);
    expect(findInBlockView(kernel.editor.view, 'hello world', 1, true)).toEqual({
      current: 1,
      total: 1,
    });
    const { doc, selection } = kernel.editor.state;
    expect(selection.from).toBe(textNodes.find(({ text }) => text === 'hello ')!.pos);
    expect(doc.textBetween(selection.from, selection.to)).toBe('hello world');
    expect(selection.to - selection.from).toBe('hello world'.length);
    expect(findInBlockView(kernel.editor.view, 'hello world', 1, false).total).toBe(1);
  });

  it('希腊文整词查找保留折叠最小祖先规则及原文坐标', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const kernel = createEditor(host, {
      initialMarkdown: '# A ^a\n\nΟΣ ^body\n\n# unrelated ^other\n\nother text ^p\n',
      slashMenu: false,
      dragHandle: false,
    });
    cleanups.push(() => kernel.destroy());
    kernel.toggleBlockFold('a');
    kernel.toggleBlockFold('other');
    expect(findInBlockView(kernel.editor.view, 'ος', 1, true)).toEqual({ current: 1, total: 1 });
    const { doc, selection } = kernel.editor.state;
    expect(doc.textBetween(selection.from, selection.to)).toBe('ΟΣ');
    expect(kernel.isBlockFolded('a')).toBe(false);
    expect(kernel.isBlockFolded('other')).toBe(true);
  });
});

describe('DEV-056 页内查找栏集成（⌘/Ctrl+F；⌘⇧F 保留全局 SearchPanel）', () => {
  it('真实 CodeMirror：输入隐藏命中只展开必要祖先，定位、保留焦点、字节不变', async () => {
    const markdown = '# parent\n## middle\nhidden AİB\n# unrelated\nother body\n';
    const parent = document.createElement('div');
    document.body.append(parent);
    const onChange = vi.fn();
    const source = createSourceEditor(parent, {
      initialText: markdown,
      headingFolding: true,
      onChange,
    });
    cleanups.push(() => source.destroy());
    const headings = sourceFoldState(source.view.state)!.headings;
    for (const heading of headings.slice(0, 2).reverse().concat(headings.slice(2))) {
      parent
        .querySelector<HTMLButtonElement>(`.cm-heading-fold-toggle[data-fold-id="${heading.id}"]`)!
        .click();
    }
    const bar = await mountFindBar('source-find', (query, direction, restart) =>
      findInSourceView(source.view, query, direction, restart),
    );
    const input = await openAndType(bar, 'b');
    expect(bar.querySelector('[data-testid="editor-find-status"]')?.textContent).toBe('1/2');
    expect(sourceFoldState(source.view.state)!.folded.has(headings[0]!.id)).toBe(false);
    expect(sourceFoldState(source.view.state)!.folded.has(headings[1]!.id)).toBe(false);
    expect(sourceFoldState(source.view.state)!.folded.has(headings[2]!.id)).toBe(true);
    const { from, to } = source.view.state.selection.main;
    expect(source.view.state.sliceDoc(from, to)).toBe('B');
    expect(document.activeElement).toBe(input);
    expect(source.getText()).toBe(markdown);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('真实 TipTap：输入隐藏命中只展开必要祖先，定位、保留焦点、无保存', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const onContentChange = vi.fn();
    const kernel = createEditor(parent, {
      initialMarkdown:
        '# parent ^parent\n\n## middle ^middle\n\nhidden AİB ^body\n\n# unrelated ^other\n\nother body ^otherBody\n',
      onContentChange,
      slashMenu: false,
      dragHandle: false,
    });
    cleanups.push(() => kernel.destroy());
    for (const id of ['middle', 'parent', 'other']) kernel.toggleBlockFold(id);
    const before = kernel.getMarkdown();
    const bar = await mountFindBar('block-find', (query, direction, restart) =>
      findInBlockView(kernel.editor.view, query, direction, restart),
    );
    const input = await openAndType(bar, 'b', true);
    expect(kernel.isBlockFolded('parent')).toBe(false);
    expect(kernel.isBlockFolded('middle')).toBe(false);
    expect(kernel.isBlockFolded('other')).toBe(true);
    const { selection, doc } = kernel.editor.state;
    expect(doc.textBetween(selection.from, selection.to)).toBe('B');
    expect(document.activeElement).toBe(input);
    expect(kernel.getMarkdown()).toBe(before);
    expect(kernel.hasPendingSave()).toBe(false);
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it('⌘⇧F 不触发页内栏；后台 tab 的 listener 不抢当前 tab', async () => {
    const background = await mountFindBar('background', () => ({ current: 0, total: 0 }));
    const foreground = await mountFindBar('foreground', () => ({ current: 0, total: 0 }));
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(background.querySelector('[data-testid="editor-find-bar"]')).toBeNull();
    expect(foreground.querySelector('[data-testid="editor-find-bar"]')).toBeNull();
    await openAndType(foreground, 'a');
    expect(background.querySelector('[data-testid="editor-find-bar"]')).toBeNull();
  });
});
