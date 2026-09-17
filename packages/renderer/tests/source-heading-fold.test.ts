// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redo, undo } from '@codemirror/commands';
import { runScopeHandlers } from '@codemirror/view';
import { createSourceEditor, type SourceEditorHandle } from '../src/editor/source/codemirror-host';
import {
  clampSourceMouseSelection,
  parseSourceHeadings,
  revealSourceHeadingAt,
  sourceFoldState,
} from '../src/editor/source/heading-fold';

const editors: Array<{ parent: HTMLElement; editor: SourceEditorHandle }> = [];

function make(text: string, onChange = vi.fn()) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createSourceEditor(parent, {
    initialText: text,
    headingFolding: true,
    onChange,
  });
  editors.push({ parent, editor });
  return { parent, editor, onChange };
}

function buttons(parent: HTMLElement): HTMLButtonElement[] {
  return [...parent.querySelectorAll<HTMLButtonElement>('.cm-heading-fold-toggle')];
}

function click(button: HTMLButtonElement) {
  button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
}

function visibleText(parent: HTMLElement): string {
  return [...parent.querySelectorAll('.cm-line')].map((line) => line.textContent).join('\n');
}

function editorKey(editor: SourceEditorHandle, key: string, shift = false): boolean {
  return runScopeHandlers(
    editor.view,
    new KeyboardEvent('keydown', { key, shiftKey: shift, cancelable: true }),
    'editor',
  );
}

afterEach(() => {
  for (const { parent, editor } of editors.splice(0)) {
    editor.destroy();
    parent.remove();
  }
  vi.restoreAllMocks();
});

describe('DEV-055 Markdown 标题解析与章节边界', () => {
  it('解析 ATX H1-H6 与 Setext H1/H2，排除 fence 与 blockquote 控件候选', () => {
    const markdown =
      '# A\nbody\n## B\nbody\n### C\nbody\n#### D\nbody\n##### E\nbody\n###### F\nbody\nSetext 1\n===\nbody\nSetext 2\n---\nbody\n> # quote\n> body\n```md\n# fake\n```\n';
    const { editor } = make(markdown);
    const headings = parseSourceHeadings(editor.view.state);
    expect(headings.map(({ level, quoted }) => [level, quoted])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, false],
      [6, false],
      [1, false],
      [2, false],
      [1, true],
    ]);
    expect(
      headings.some((heading) =>
        editor.view.state.sliceDoc(heading.from, heading.to).includes('fake'),
      ),
    ).toBe(false);
  });

  it('同级/高层级边界正确，嵌套章节包含低级标题且空章节不可折叠', () => {
    const text = '# A\nA body\n## A.1\nchild\n### deep\ndeep body\n## A.2\n# B\nB body\n# Empty\n';
    const { editor } = make(text);
    const headings = sourceFoldState(editor.view.state)!.headings;
    const a = headings[0]!;
    const a1 = headings[1]!;
    const a2 = headings[3]!;
    const b = headings[4]!;
    const empty = headings[5]!;
    expect(editor.view.state.sliceDoc(a.to, a.end)).toContain('## A.2');
    expect(a.end).toBe(b.from);
    expect(a1.end).toBe(a2.from);
    expect(b.end).toBe(empty.from);
    expect(empty.content).toBe(false);
  });
});

describe('DEV-055 真实 CodeMirror renderer', () => {
  it('gutter 仅为有内容的非引用 ATX/Setext 标题渲染键盘可达 disclosure', () => {
    const { parent } = make('# ATX\nbody\nSetext\n---\nbody\n> # quote\n> body\n# Empty\n');
    expect(buttons(parent)).toHaveLength(2);
    for (const button of buttons(parent)) {
      expect(button.tabIndex).toBe(0);
      expect(button.getAttribute('aria-label')).toBe('折叠章节');
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(button.dataset.foldState).toBe('expanded');
    }
    expect(parent.querySelector('.cm-heading-fold-placeholder')).toBeNull();
  });

  it('鼠标折叠隐藏正确章节但不改字节、不触发 onChange、不写 undo 历史', () => {
    const original = '# A\r\nbody one\r\n## child\r\nbody two\r\n# B\r\ntail\r\n';
    const { parent, editor, onChange } = make(original);
    const before = new TextEncoder().encode(editor.getText());
    click(buttons(parent)[0]!);

    expect(editor.getText()).toBe(original);
    expect(new TextEncoder().encode(editor.getText())).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
    expect(sourceFoldState(editor.view.state)?.folded.size).toBe(1);
    expect(visibleText(parent)).not.toContain('body one');
    expect(visibleText(parent)).not.toContain('child');
    expect(visibleText(parent)).toContain('# B');
    expect(parent.querySelector('.cm-heading-fold-placeholder')?.textContent).toBe('…');
    expect(undo(editor.view)).toBe(false);
  });

  it('键盘 Enter/Space 连续切换时 widget 重建后焦点由新按钮承接', async () => {
    const { parent, editor } = make('# A\nbody\n# B\ntail\n');
    const original = buttons(parent)[0]!;
    original.focus();
    original.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const collapsed = buttons(parent)[0]!;
    await vi.waitFor(() => expect(document.activeElement).toBe(collapsed));
    expect(collapsed).not.toBe(original);
    expect(collapsed.getAttribute('aria-label')).toBe('展开章节');
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');

    collapsed.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const reopened = buttons(parent)[0]!;
    await vi.waitFor(() => expect(document.activeElement).toBe(reopened));
    expect(reopened).not.toBe(collapsed);
    expect(sourceFoldState(editor.view.state)?.folded.size).toBe(0);
  });

  it('父子嵌套状态独立：重开父章节后子章节仍保持折叠', () => {
    const { parent, editor } = make('# parent\n## child\nchild body\nparent tail\n# after\ntail\n');
    click(buttons(parent)[1]!);
    click(buttons(parent)[0]!);
    expect(sourceFoldState(editor.view.state)?.folded.size).toBe(2);
    click(buttons(parent)[0]!);
    expect(sourceFoldState(editor.view.state)?.folded.size).toBe(1);
    expect(visibleText(parent)).toContain('## child');
    expect(visibleText(parent)).not.toContain('child body');
  });

  it('同名、空标题、改名保持独立身份；层级变化保留并立即重算边界', () => {
    const text = '# \nempty body\n## same\nfirst\n## same\nsecond\n# after\ntail\n';
    const { parent, editor } = make(text);
    const state = sourceFoldState(editor.view.state)!;
    const ids = state.headings.map((heading) => heading.id);
    const [first, , third] = buttons(parent);
    click(first!);
    click(third!);

    const second = sourceFoldState(editor.view.state)!.headings[2]!;
    const headingText = editor.view.state.doc.lineAt(second.from).text;
    editor.view.dispatch({
      changes: { from: second.from, to: second.from + headingText.length, insert: '### renamed' },
    });
    const next = sourceFoldState(editor.view.state)!;
    expect(next.headings.map((heading) => heading.id)).toEqual(ids);
    expect(next.headings[2]!.level).toBe(3);
    expect(next.folded.has(ids[0]!)).toBe(true);
    expect(next.folded.has(ids[2]!)).toBe(true);
    expect(editor.getText()).toContain('### renamed');
    expect(undo(editor.view)).toBe(true);
    expect(redo(editor.view)).toBe(true);
  });

  it('删除/整行替换导致无法可靠映射时安全展开，Undo 恢复标题也默认展开', () => {
    const { parent, editor } = make('# A\nbody\n# B\ntail\n');
    click(buttons(parent)[0]!);
    const first = sourceFoldState(editor.view.state)!.headings[0]!;
    editor.view.dispatch({ changes: { from: first.from, to: first.to, insert: 'paragraph' } });
    expect(sourceFoldState(editor.view.state)?.folded.size).toBe(0);
    expect(visibleText(parent)).toContain('body');
    expect(undo(editor.view)).toBe(true);
    expect(sourceFoldState(editor.view.state)?.folded.size).toBe(0);
  });

  it('折叠时隐藏区选区回退；完整选择仍覆盖文档；可见区拖选不包含隐藏正文', () => {
    const { parent, editor } = make('# A\nhidden one\nhidden two\n# B\nvisible\n');
    const heading = sourceFoldState(editor.view.state)!.headings[0]!;
    editor.view.dispatch({ selection: { anchor: heading.to + 2 } });
    click(buttons(parent)[0]!);
    expect(editor.view.state.selection.main.head).toBe(heading.to);
    click(buttons(parent)[0]!);
    // 非全文的跨章节选区也不能在折叠后遗留隐藏端点。
    editor.view.dispatch({ selection: { anchor: heading.from, head: heading.end + 1 } });
    click(buttons(parent)[0]!);
    expect(editor.view.state.selection.main.head).toBe(heading.to);

    editor.view.dispatch({ selection: { anchor: 0, head: editor.view.state.doc.length } });
    expect(editor.view.state.selection.main.to).toBe(editor.view.state.doc.length);
    clampSourceMouseSelection(editor.view);
    expect(editor.view.state.selection.main.to).toBe(editor.view.state.doc.length);

    // 拖选起点必须在可见区域：以尾部可见段为 anchor 反向拖入折叠区。
    const tail = sourceFoldState(editor.view.state)!.headings[1]!;
    editor.view.dispatch({ selection: { anchor: tail.from + 2, head: heading.to - 1 } });
    clampSourceMouseSelection(editor.view);
    expect(editor.view.state.selection.main.head).toBe(tail.from);
    expect(
      editor.view.state.sliceDoc(
        editor.view.state.selection.main.from,
        editor.view.state.selection.main.to,
      ),
    ).not.toContain('hidden');
  });

  it('ArrowUp/Down 跳过隐藏区，Shift+Arrow 不把隐藏正文纳入选区', () => {
    const { parent, editor } = make('# A\nhidden one\nhidden two\n# B\nvisible\n');
    const [a, b] = sourceFoldState(editor.view.state)!.headings;
    click(buttons(parent)[0]!);

    editor.view.dispatch({ selection: { anchor: a!.to } });
    expect(editorKey(editor, 'ArrowDown')).toBe(true);
    expect(editor.view.state.selection.main.head).toBe(a!.end);
    editor.view.dispatch({ selection: { anchor: a!.to } });
    const before = editor.view.state.selection.main.toJSON();
    expect(editorKey(editor, 'ArrowDown', true)).toBe(true);
    expect(editor.view.state.selection.main.toJSON()).toEqual(before);

    editor.view.dispatch({ selection: { anchor: b!.from } });
    expect(editorKey(editor, 'ArrowUp')).toBe(true);
    expect(editor.view.state.selection.main.head).toBe(a!.to);
  });

  it('正文编辑与 undo/redo 不受折叠影响，保存源仍是完整 Markdown', () => {
    const original = '# A\nhidden\n# B\ntail\n';
    const { parent, editor, onChange } = make(original);
    click(buttons(parent)[0]!);
    editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: 'edited' } });
    expect(editor.getText()).toBe(`${original}edited`);
    expect(onChange).toHaveBeenLastCalledWith(`${original}edited`);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe(original);
    expect(redo(editor.view)).toBe(true);
    expect(editor.getText()).toBe(`${original}edited`);
  });

  it('目录/跳转只展开遮蔽目标的祖先，目标自身折叠保持', () => {
    const { parent, editor } = make('# parent\n## target\ntarget body\n# after\ntail\n');
    const headings = sourceFoldState(editor.view.state)!.headings;
    click(buttons(parent)[1]!);
    click(buttons(parent)[0]!);
    revealSourceHeadingAt(editor.view, headings[1]!.from);
    const folded = sourceFoldState(editor.view.state)!.folded;
    expect(folded.has(headings[0]!.id)).toBe(false);
    expect(folded.has(headings[1]!.id)).toBe(true);
  });

  it('重建编辑器（重开 tab）默认全部展开；不启用时 native-block 源码无控件', () => {
    const markdown = '# A\nbody\n# B\ntail\n';
    const first = make(markdown);
    click(buttons(first.parent)[0]!);
    expect(sourceFoldState(first.editor.view.state)?.folded.size).toBe(1);
    first.editor.destroy();
    first.parent.remove();
    editors.splice(editors.indexOf(first), 1);

    const reopened = make(markdown);
    expect(sourceFoldState(reopened.editor.view.state)?.folded.size).toBe(0);
    const plainParent = document.createElement('div');
    document.body.append(plainParent);
    const plain = createSourceEditor(plainParent, {
      initialText: markdown,
      onChange: () => undefined,
    });
    editors.push({ parent: plainParent, editor: plain });
    expect(buttons(plainParent)).toHaveLength(0);
  });
});
