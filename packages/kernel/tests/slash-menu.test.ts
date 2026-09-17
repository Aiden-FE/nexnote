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
    view.someProp(
      'handleTextInput',
      (f: (v: never, a: number, b: number, t: string) => boolean) => {
        f(view, from, from, '/');
        return false;
      },
    );
    const menu = container.querySelector('.nexnote-slash-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    const groups = [...menu.querySelectorAll('.nexnote-slash-menu__group')].map(
      (g) => g.textContent,
    );
    expect(groups).toContain('基础块');
    expect(groups).toContain('插入');
    expect(groups).not.toContain('AI');
    // 分组排序后同组连续：分组头不重复
    expect(new Set(groups).size).toBe(groups.length);
    const rows = [...menu.querySelectorAll('[data-slash-item]')].map((r) =>
      r.getAttribute('data-slash-item'),
    );
    // 基础块齐备：标题/段落/无序/有序/任务/引用/代码块/表格/分割线
    for (const id of [
      'block:heading:1',
      'block:paragraph',
      'block:bullet-list',
      'block:ordered-list',
      'block:task-list',
      'block:blockquote',
      'block:code',
      'insert:table',
      'insert:horizontal-rule',
    ]) {
      expect(rows).toContain(id);
    }
    kernel.destroy();
    container.remove();
  });
  it('输入表格 过滤到表格项，Enter 插入 table 节点', () => {
    const { kernel, container } = make();
    placeCursorEnd(kernel);
    const view = kernel.editor.view as never;
    let from = view.state.selection.from;
    view.someProp('handleTextInput', (f) => (f(view, from, from, '/'), false));
    view.dispatch(view.state.tr.insertText('/', from, from));
    from = view.state.selection.from;
    view.someProp('handleTextInput', (f) => (f(view, from, from, '表'), false));
    view.dispatch(view.state.tr.insertText('表', from, from));
    from = view.state.selection.from;
    view.someProp('handleTextInput', (f) => (f(view, from, from, '格'), false));
    view.dispatch(view.state.tr.insertText('格', from, from));
    const menu = container.querySelector('.nexnote-slash-menu') as HTMLElement;
    const rows = [...menu.querySelectorAll('[data-slash-item]')].map((r) =>
      r.getAttribute('data-slash-item'),
    );
    expect(rows).toEqual(['insert:table']);
    view.someProp('handleKeyDown', (f: (v: never, e: KeyboardEvent) => boolean) => {
      f(view, new KeyboardEvent('keydown', { key: 'Enter' }));
      return false;
    });
    expect(kernel.getJSON().content?.some((b) => b.type === 'table')).toBe(true);
    kernel.destroy();
    container.remove();
  });
  it('内核默认项不再含死占位 image/attachment（媒体项由渲染层注入）', () => {
    const { kernel, container } = make();
    placeCursorEnd(kernel);
    const view = kernel.editor.view as never;
    const from = view.state.selection.from;
    view.someProp(
      'handleTextInput',
      (f: (v: never, a: number, b: number, t: string) => boolean) => {
        f(view, from, from, '/');
        return false;
      },
    );
    const rows = [...container.querySelectorAll('[data-slash-item]')].map((r) =>
      r.getAttribute('data-slash-item'),
    );
    expect(rows).not.toContain('image');
    expect(rows).not.toContain('attachment');
    kernel.destroy();
    container.remove();
  });
});
