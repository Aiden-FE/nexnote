// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';
import { createEditor } from '@nexnote/kernel';
import { createSourceEditor } from '../src/editor/source/codemirror-host';
import { registerEditor } from '../src/editor/active-editor';
import { registerSourceEditor } from '../src/editor/source/active-source-editor';
import { getActiveInsertionMode, insertAtActiveCursor } from '../src/editor/caret-insert';

describe('统一活动编辑器光标插入（DEV-036）', () => {
  it('无活动编辑器时返回 false，且模式为空', () => {
    expect(getActiveInsertionMode()).toBeNull();
    expect(insertAtActiveCursor('回复')).toBe(false);
  });

  it('TipTap 在当前块光标插入，并可单步 undo', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const kernel = createEditor(parent, { initialMarkdown: '# 标题\n\n正文' });
    const registration = registerEditor(kernel);
    const end = kernel.editor.state.doc.content.size - 1;
    kernel.editor.commands.setTextSelection(end);

    expect(getActiveInsertionMode()).toBe('block');
    expect(insertAtActiveCursor('新增块')).toBe(true);
    expect(kernel.getMarkdown()).toContain('新增块');
    expect(kernel.undo()).toBe(true);
    expect(kernel.getMarkdown()).not.toContain('新增块');

    registration.unregister();
    kernel.destroy();
    parent.remove();
    expect(getActiveInsertionMode()).toBeNull();
  });

  it('CodeMirror 在当前光标单事务插入，并可单步 undo', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createSourceEditor(parent, { initialText: '前后', onChange: () => undefined });
    const unregisterSource = registerSourceEditor(editor);
    editor.view.dispatch({ selection: { anchor: 1 } });

    expect(getActiveInsertionMode()).toBe('source');
    expect(insertAtActiveCursor('一\n二')).toBe(true);
    expect(editor.getText()).toBe('前一\n二后');
    expect(undo(editor.view)).toBe(true);
    expect(editor.getText()).toBe('前后');

    unregisterSource();
    editor.destroy();
    parent.remove();
    expect(getActiveInsertionMode()).toBeNull();
  });
});
