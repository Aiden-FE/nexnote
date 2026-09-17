// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { undo } from '@codemirror/commands';
import { MERMAID_FLOWCHART_SOURCE } from '@nexnote/kernel';
import { blockAnchorRange, createSourceEditor } from '../src/editor/source/codemirror-host';
import { mermaidFence } from '../src/editor/toolbar/snippets';

describe('源码模式 CodeMirror caret', () => {
  it('暗色主题下原生 caret 与 drawSelection cursor 都使用 --foreground', () => {
    const parent = document.createElement('div');
    parent.style.setProperty('--foreground', 'rgb(230, 240, 250)');
    document.body.append(parent);
    const editor = createSourceEditor(parent, { initialText: '', onChange: () => undefined });
    const editorDOM = parent.querySelector<HTMLElement>('.cm-editor');
    const content = parent.querySelector<HTMLElement>('.cm-content');
    const cursor = document.createElement('span');
    cursor.className = 'cm-cursor';
    editorDOM?.append(cursor);

    expect(getComputedStyle(content!).caretColor).toBe('rgb(230, 240, 250)');
    expect(getComputedStyle(cursor).borderLeftColor).toBe('rgb(230, 240, 250)');

    editor.destroy();
    parent.remove();
  });
});

describe('源码块锚点视觉弱化（DEV-020 GUI 反馈）', () => {
  it('识别行尾块锚点且不把分隔空格算入 decoration', () => {
    expect(blockAnchorRange('# 标题 ^20urxq4')).toEqual({ from: 5, to: 13 });
    expect(blockAnchorRange('^isf2gy8')).toEqual({ from: 0, to: 8 });
    expect(blockAnchorRange('正文 ^abc  ')).toEqual({ from: 3, to: 7 });
  });

  it('不误伤正文内的 ^ 或非法锚点', () => {
    expect(blockAnchorRange('a^b')).toBeNull();
    expect(blockAnchorRange('正文 ^含中文')).toBeNull();
    expect(blockAnchorRange('正文 ^abc 后续')).toBeNull();
  });

  it('CodeMirror 只做视觉标记，不改源码字节', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const original = '# 标题 ^20urxq4\n\n正文 a^b\n\n^isf2gy8\n\n```js\n^codeanchor\n```\n';
    const editor = createSourceEditor(parent, { initialText: original, onChange: () => undefined });

    expect(editor.getText()).toBe(original);
    expect(parent.querySelectorAll('.cm-block-anchor')).toHaveLength(2);
    editor.destroy();
    parent.remove();
  });
});

describe('源码编辑命令', () => {
  function setup(text: string) {
    const parent = document.createElement('div');
    document.body.append(parent);
    const onChange = vi.fn();
    const editor = createSourceEditor(parent, { initialText: text, onChange });
    return {
      editor,
      onChange,
      cleanup: () => {
        editor.destroy();
        parent.remove();
      },
    };
  }

  it('多行选区 Tab 在一个事务内覆盖完整行增加两个空格，行首边界不包含下一行', () => {
    const fixture = setup('a\r\n\r\nb\r\nc');
    const { editor } = fixture;
    editor.view.dispatch({ selection: { anchor: 1, head: 5 } });
    expect(editor.indentSelection()).toBe(true);
    expect(editor.getText()).toBe('  a\r\n  \r\n  b\r\nc');
    expect(editor.view.state.selection.main).toMatchObject({ anchor: 3, head: 11 });
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('a\r\n\r\nb\r\nc');
    fixture.cleanup();
  });

  it('Shift+Tab 每行最多移除两个前导空格并保持反向选区', () => {
    const fixture = setup('    a\n b\nc');
    const { editor } = fixture;
    editor.view.dispatch({ selection: { anchor: 8, head: 2 } });
    expect(editor.indentSelection(true)).toBe(true);
    expect(editor.getText()).toBe('  a\nb\nc');
    expect(editor.view.state.selection.main.anchor).toBeGreaterThan(
      editor.view.state.selection.main.head,
    );
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('    a\n b\nc');
    fixture.cleanup();
  });

  it('空选区和单行选区不接管 Tab', () => {
    const fixture = setup('a\nb');
    fixture.editor.view.dispatch({ selection: { anchor: 1 } });
    expect(fixture.editor.indentSelection()).toBe(false);
    fixture.editor.view.dispatch({ selection: { anchor: 0, head: 1 } });
    expect(fixture.editor.indentSelection()).toBe(false);
    expect(fixture.editor.getText()).toBe('a\nb');
    fixture.cleanup();
  });

  it('格式化以单事务应用并可一次 undo，selection 映射可预测', () => {
    const fixture = setup('#   标题\n\n\n+ 项目');
    const { editor } = fixture;
    editor.view.dispatch({ selection: { anchor: 4, head: 13 } });
    expect(editor.formatMarkdown('selection')).toBe(true);
    expect(editor.getText()).toBe('# 标题\n\n+ 项目');
    expect(editor.view.state.selection.main).toMatchObject({ anchor: 2, head: 10 });
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('#   标题\n\n\n+ 项目');
    fixture.cleanup();
  });

  it('insertBlock 为结构片段补空行、一次 transaction 可 undo', () => {
    const fixture = setup('before\nafter');
    const { editor, onChange } = fixture;
    editor.view.dispatch({ selection: { anchor: 'before'.length } });
    editor.insertBlock('| A | B |\n| --- | --- |\n|  |  |');
    expect(editor.getText()).toBe('before\n\n| A | B |\n| --- | --- |\n|  |  |\n\nafter');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('before\nafter');
    fixture.cleanup();
  });

  it('insertText 替换选区；setText 继续屏蔽 programmatic onChange', () => {
    const fixture = setup('abc');
    const { editor, onChange } = fixture;
    editor.view.dispatch({ selection: { anchor: 1, head: 2 } });
    editor.insertText('XY');
    expect(editor.getText()).toBe('aXYc');
    expect(editor.view.state.selection.main.head).toBe(3);
    expect(onChange).toHaveBeenCalledTimes(1);
    editor.setText('external');
    expect(editor.getText()).toBe('external');
    expect(onChange).toHaveBeenCalledTimes(1);
    fixture.cleanup();
  });
});

describe('源码编辑命令 CRLF 回归', () => {
  function setup(text: string) {
    const parent = document.createElement('div');
    document.body.append(parent);
    const onChange = vi.fn();
    const editor = createSourceEditor(parent, { initialText: text, onChange });
    return {
      editor,
      onChange,
      cleanup: () => {
        editor.destroy();
        parent.remove();
      },
    };
  }

  it('insertBlock 将 LF table 规范化为 CRLF，并保持行模型、selection 与单次 undo', () => {
    const fixture = setup('before\r\nafter');
    const { editor, onChange } = fixture;
    editor.view.dispatch({ selection: { anchor: 'before'.length } });

    editor.insertBlock('| A | B |\n| --- | --- |\n|  |  |');

    expect(editor.getText()).toBe(
      'before\r\n\r\n| A | B |\r\n| --- | --- |\r\n|  |  |\r\n\r\nafter',
    );
    expect(editor.view.state.doc.lines).toBe(7);
    expect(editor.view.state.sliceDoc(editor.view.state.selection.main.anchor)).toBe('\r\nafter');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('before\r\nafter');
    fixture.cleanup();
  });

  it('insertBlock 将 LF mermaid 规范化为 CRLF，文档中不留下孤立 LF', () => {
    const fixture = setup('# 标题\r\n\r\n正文');
    const { editor, onChange } = fixture;
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    const fence = mermaidFence(MERMAID_FLOWCHART_SOURCE);
    const expected = `# 标题\r\n\r\n正文\r\n\r\n${fence.replace(/\r\n?|\n/g, '\r\n')}\r\n`;

    editor.insertBlock(fence);

    expect(editor.getText()).toBe(expected);
    expect(editor.getText()).not.toMatch(/(?<!\r)\n/);
    expect(editor.view.state.doc.lines).toBe(expected.split('\r\n').length);
    expect(editor.view.state.sliceDoc(editor.view.state.selection.main.anchor)).toBe('');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('# 标题\r\n\r\n正文');
    fixture.cleanup();
  });

  it('insertBlock 以 CRLF 边界判断已有空行，不重复补行', () => {
    const fixture = setup('段落一\r\n\r\n段落二');
    const { editor } = fixture;
    const secondParagraph = editor.view.state.doc.line(3);
    editor.view.dispatch({ selection: { anchor: secondParagraph.from } });

    editor.insertBlock('<!-- nexnote:toc -->');

    expect(editor.getText()).toBe('段落一\r\n\r\n<!-- nexnote:toc -->\r\n\r\n段落二');
    expect(editor.view.state.doc.lines).toBe(5);
    expect(editor.view.state.sliceDoc(editor.view.state.selection.main.anchor)).toBe('段落二');
    fixture.cleanup();
  });

  it('insertText 双向规范化外部换行，CRLF 行模型与 selection 可一次 undo', () => {
    const crlfFixture = setup('a\r\nb');
    const { editor, onChange } = crlfFixture;
    editor.view.dispatch({ selection: { anchor: 2, head: 3 } });

    editor.insertText('x\ny');

    expect(editor.getText()).toBe('a\r\nx\r\ny');
    expect(editor.view.state.doc.lines).toBe(3);
    expect(editor.view.state.selection.main.anchor).toBe(editor.view.state.doc.length);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('a\r\nb');
    crlfFixture.cleanup();

    const lfFixture = setup('a\nb');
    lfFixture.editor.view.dispatch({ selection: { anchor: 2, head: 3 } });
    lfFixture.editor.insertText('x\r\ny');
    expect(lfFixture.editor.getText()).toBe('a\nx\ny');
    expect(lfFixture.editor.view.state.doc.lines).toBe(3);
    lfFixture.cleanup();
  });
});
