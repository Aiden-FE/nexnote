// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { history } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
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
    return new EditorView({ state: EditorState.create({ doc: text, extensions: [history()] }) });
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
