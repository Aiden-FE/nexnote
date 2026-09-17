// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { history } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { undo, redo } from '@codemirror/commands';
import { createEditor } from '@nexnote/kernel';
import { TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import {
  applyBlockTypeAction,
  applySourceBlockTypeAction,
  blockHeadingCapability,
  COMPLEX_HEADING_SELECTION_REASON,
  sourceHeadingCapability,
  LIST_OR_QUOTE_HEADING_CONTEXT_REASON,
  READ_ONLY_HEADING_CONTEXT_REASON,
  UNSAFE_MARKDOWN_HEADING_CONTEXT_REASON,
} from '../src/editor/toolbar/heading-actions';

describe('DEV-050 TipTap 标题/段落转换', () => {
  it('H1-H6 与正文保留文字且可撤销/重做', () => {
    for (let level = 1; level <= 6; level += 1) {
      const host = document.createElement('div');
      const kernel = createEditor(host, { initialMarkdown: '正文内容' });
      expect(applyBlockTypeAction(kernel, `block:heading:${level}`)).toBe(true);
      expect(kernel.getMarkdown()).toContain(`${'#'.repeat(level)} 正文内容`);
      expect(kernel.undo()).toBe(true);
      expect(kernel.getMarkdown()).not.toContain(`${'#'.repeat(level)} 正文内容`);
      expect(kernel.redo()).toBe(true);
      expect(kernel.getMarkdown()).toContain(`${'#'.repeat(level)} 正文内容`);
      expect(applyBlockTypeAction(kernel, 'block:paragraph')).toBe(true);
      expect(kernel.getMarkdown()).toContain('正文内容');
      kernel.destroy();
    }
  });

  it('跨多个顶层块禁用并解释，且不改变内容', () => {
    const host = document.createElement('div');
    const kernel = createEditor(host, { initialMarkdown: '第一段\n\n第二段' });
    const before = kernel.getMarkdown();
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, 1, kernel.editor.state.doc.content.size - 1),
      ),
    );
    expect(blockHeadingCapability(kernel)).toEqual({
      enabled: false,
      reason: COMPLEX_HEADING_SELECTION_REASON,
    });
    expect(applyBlockTypeAction(kernel, 'block:heading:2')).toBe(false);
    expect(kernel.getMarkdown()).toBe(before);
    kernel.destroy();
  });
});

describe('DEV-050 CodeMirror 标题/段落转换', () => {
  function view(text: string): EditorView {
    return new EditorView({
      state: EditorState.create({ doc: text, extensions: [history(), markdown()] }),
    });
  }

  it('只替换当前行前缀，保留 CRLF 与未触及字节，可撤销/重做', () => {
    const editor = view('before\r\n正文\r\nafter');
    editor.dispatch({ selection: { anchor: 'before\r\n'.length + 1 } });
    const original = editor.state.doc.toString();
    expect(applySourceBlockTypeAction(editor, 'block:heading:4')).toBe(true);
    expect(editor.state.doc.toString()).toBe('before\n#### 正文\nafter');
    expect(undo(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe(original);
    expect(redo(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe('before\n#### 正文\nafter');
    expect(applySourceBlockTypeAction(editor, 'block:paragraph')).toBe(true);
    expect(editor.state.doc.toString()).toBe(original);
    editor.destroy();
  });

  it('Setext 转换在 CRLF 行分隔下保留换行风格', () => {
    const original = 'before\r\n\r\nTitle\r\n---\r\nafter';
    const editor = new EditorView({
      state: EditorState.create({
        doc: original,
        extensions: [history(), markdown(), EditorState.lineSeparator.of('\r\n')],
      }),
    });
    // CodeMirror 内部位置统一以单字符换行计数，序列化时由 lineSeparator 恢复 CRLF。
    editor.dispatch({ selection: { anchor: 'before\n\n'.length + 2 } });
    expect(applySourceBlockTypeAction(editor, 'block:heading:2')).toBe(true);
    expect(editor.state.sliceDoc()).toBe('before\r\n\r\n## Title\r\nafter');
    expect(applySourceBlockTypeAction(editor, 'block:paragraph')).toBe(true);
    expect(editor.state.sliceDoc()).toBe('before\r\n\r\nTitle\r\nafter');
    expect(undo(editor)).toBe(true);
    expect(editor.state.sliceDoc()).toBe('before\r\n\r\n## Title\r\nafter');
    editor.destroy();
  });

  it.each([
    ['代码围栏', '```ts\nconst x = 1\n```', 8],
    ['表格', '| a | b |\n| --- | --- |', 2],
    ['缩进代码块', '    const x = 1\n', 7],
    ['HTML 块', '<div>\ncontent\n</div>', 8],
    ['水平线', '***\n', 1],
  ])('%s 上下文禁用且零事务/零字节', (_label, text, anchor) => {
    const editor = view(text);
    editor.dispatch({ selection: { anchor } });
    const before = editor.state.doc.toString();
    expect(sourceHeadingCapability(editor)).toEqual({
      enabled: false,
      reason: UNSAFE_MARKDOWN_HEADING_CONTEXT_REASON,
    });
    expect(applySourceBlockTypeAction(editor, 'block:heading:2')).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
    expect(undo(editor)).toBe(false);
    editor.destroy();
  });

  it.each([
    ['无序列表', '- item\n', 2],
    ['有序列表', '12. item\n', 5],
    ['任务列表', '- [ ] task\n', 6],
    ['引用', '> quote\n', 3],
    ['嵌套引用', '> > nested\n', 5],
    ['引用中的列表', '> - item\n', 5],
    ['嵌套列表', '  - nested\n', 5],
    ['列表项续行', '- item\ncontinuation\n', '- item\n'.length + 5],
  ])('%s fail closed：原因明确、零事务/零字节', (_label, text, anchor) => {
    const editor = view(text);
    editor.dispatch({ selection: { anchor } });
    const before = editor.state.doc.toString();
    expect(sourceHeadingCapability(editor)).toEqual({
      enabled: false,
      reason: LIST_OR_QUOTE_HEADING_CONTEXT_REASON,
    });
    expect(applySourceBlockTypeAction(editor, 'block:heading:2')).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
    expect(undo(editor)).toBe(false);
    editor.destroy();
  });

  it.each([
    ['Setext H1', 'Title', '='],
    ['Setext H2', 'Title', '-'],
    ['带 inline HTML 的 Setext H2', 'Title <span>inline</span>', '-'],
  ])('%s 支持转正文和 H1-H6：单事务、局部保真、undo/redo', (_label, title, marker) => {
    const original = `before\n\n${title}\n${marker.repeat(5)}\nafter\n`;
    for (let level = 0; level <= 6; level += 1) {
      const editor = view(original);
      const titleStart = 'before\n\n'.length;
      editor.dispatch({ selection: { anchor: titleStart + 2 } });
      const id = level === 0 ? 'block:paragraph' : `block:heading:${level}`;
      expect(sourceHeadingCapability(editor)).toEqual({ enabled: true });
      expect(applySourceBlockTypeAction(editor, id)).toBe(true);
      const expected = `before\n\n${level === 0 ? '' : `${'#'.repeat(level)} `}${title}\nafter\n`;
      expect(editor.state.doc.toString()).toBe(expected);
      expect(undo(editor)).toBe(true);
      expect(editor.state.doc.toString()).toBe(original);
      // 单事务：一次 undo 已到原文，不能再撤一次标题转换。
      expect(undo(editor)).toBe(false);
      expect(redo(editor)).toBe(true);
      expect(editor.state.doc.toString()).toBe(expected);
      editor.destroy();
    }
  });

  it('光标位于 Setext 下划线行时能力与执行一致', () => {
    const original = 'before\n\nTitle\n---\nafter';
    const editor = view(original);
    editor.dispatch({ selection: { anchor: 'before\n\nTitle\n'.length + 1 } });
    expect(sourceHeadingCapability(editor)).toEqual({ enabled: true });
    expect(applySourceBlockTypeAction(editor, 'block:heading:3')).toBe(true);
    expect(editor.state.doc.toString()).toBe('before\n\n### Title\nafter');
    expect(undo(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe(original);
    editor.destroy();
  });

  it.each([
    ['首行', 'alpha\nbeta\n---\nafter', 2],
    ['末行', 'alpha\nbeta\n---\nafter', 'alpha\n'.length + 2],
    ['下划线', 'alpha\nbeta\n---\nafter', 'alpha\nbeta\n'.length + 1],
  ])('多行 Setext 光标位于%s时作为复杂块 fail closed', (_label, original, anchor) => {
    const editor = view(original);
    editor.dispatch({ selection: { anchor } });
    expect(sourceHeadingCapability(editor)).toEqual({
      enabled: false,
      reason: COMPLEX_HEADING_SELECTION_REASON,
    });
    expect(applySourceBlockTypeAction(editor, 'block:heading:2')).toBe(false);
    expect(editor.state.doc.toString()).toBe(original);
    expect(undo(editor)).toBe(false);
    editor.destroy();
  });

  it.each([
    ['孤立水平线', 'before\n\n---\nafter', 'before\n\n'.length + 1],
    ['列表项后的水平线', '- item\n---\nafter', '- item\n'.length + 1],
  ])('%s 不误判为 Setext，fail closed 且零字节', (_label, original, anchor) => {
    const editor = view(original);
    editor.dispatch({ selection: { anchor } });
    expect(sourceHeadingCapability(editor)).toEqual({
      enabled: false,
      reason: UNSAFE_MARKDOWN_HEADING_CONTEXT_REASON,
    });
    expect(applySourceBlockTypeAction(editor, 'block:heading:2')).toBe(false);
    expect(editor.state.doc.toString()).toBe(original);
    expect(undo(editor)).toBe(false);
    editor.destroy();
  });

  it('只读状态的能力判断与执行一致', () => {
    const editor = new EditorView({
      state: EditorState.create({
        doc: 'Title',
        extensions: [history(), markdown(), EditorState.readOnly.of(true)],
      }),
    });
    expect(sourceHeadingCapability(editor)).toEqual({
      enabled: false,
      reason: READ_ONLY_HEADING_CONTEXT_REASON,
    });
    expect(applySourceBlockTypeAction(editor, 'block:heading:2')).toBe(false);
    expect(editor.state.doc.toString()).toBe('Title');
    editor.destroy();
  });

  it('跨行选择禁用且不改变原文字节', () => {
    const editor = view('第一行\n第二行\n');
    editor.dispatch({ selection: { anchor: 0, head: 6 } });
    const before = editor.state.doc.toString();
    expect(sourceHeadingCapability(editor)).toEqual({
      enabled: false,
      reason: COMPLEX_HEADING_SELECTION_REASON,
    });
    expect(applySourceBlockTypeAction(editor, 'block:heading:2')).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
    editor.destroy();
  });
});
