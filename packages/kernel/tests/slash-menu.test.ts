// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createEditor } from '../src/editor';

function make(markdown = '占位\n\n') {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, {
    initialMarkdown: markdown,
    dragHandle: false,
    extraSlashItems: () => [
      {
        id: 'ai-polish',
        title: 'AI 润色',
        hint: '/ai',
        keywords: ['ai', 'polish'],
        group: 'AI',
        action: () => true,
      },
    ],
  });
  return { container, kernel };
}

function placeCursorEnd(kernel: ReturnType<typeof make>['kernel']) {
  const view = kernel.editor.view;
  const end = view.state.doc.content.size;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end))));
}

describe('斜杠菜单分组（DEV-017）', () => {
  it('打开 / 显示分组头与扁平条目', () => {
    const { kernel, container } = make();
    placeCursorEnd(kernel);
    const view = kernel.editor.view as never;
    const from = view.state.selection.from;
    view.someProp('handleTextInput', (f: (v: never, a: number, b: number, t: string) => boolean) => {
      f(view, from, from, '/');
      return false;
    });
    const menu = container.querySelector('.nexnote-slash-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    const groups = [...menu.querySelectorAll('.nexnote-slash-menu__group')].map((g) => g.textContent);
    expect(groups).toContain('基础块');
    expect(groups).toContain('媒体');
    expect(groups).toContain('AI');
    const rows = menu.querySelectorAll('[data-slash-item]');
    expect(rows.length).toBeGreaterThan(6);
    kernel.destroy();
    container.remove();
  });
  it('输入图片 过滤到媒体组 图片项', () => {
    const { kernel, container } = make();
    placeCursorEnd(kernel);
    const view = kernel.editor.view as never;
    let from = view.state.selection.from;
    view.someProp('handleTextInput', (f) => (f(view, from, from, '/'), false));
    view.dispatch(view.state.tr.insertText('/', from, from));
    from = view.state.selection.from;
    view.someProp('handleTextInput', (f) => (f(view, from, from, '图'), false));
    view.dispatch(view.state.tr.insertText('图', from, from));
    from = view.state.selection.from;
    view.someProp('handleTextInput', (f) => (f(view, from, from, '片'), false));
    view.dispatch(view.state.tr.insertText('片', from, from));
    const menu = container.querySelector('.nexnote-slash-menu') as HTMLElement;
    const rows = [...menu.querySelectorAll('[data-slash-item]')].map((r) => r.getAttribute('data-slash-item'));
    expect(rows).toContain('image');
    kernel.destroy();
    container.remove();
  });
});
