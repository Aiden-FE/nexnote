// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createEditor } from '../src/editor';

function make(markdown: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, {
    initialMarkdown: markdown,
    slashMenu: false,
    dragHandle: false,
    selectionBubble: false,
  });
  return { container, kernel };
}

describe('链接（DEV-017 格式按钮依赖）', () => {
  it('setLink 命令为选区加链接并往返 Markdown', () => {
    const { kernel, container } = make('这是一段文字\n');
    const view = kernel.editor.view;
    // 选中「一段文字」（跳过段首块ID锚点占位）
    const start = view.state.doc.content.size - 5;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, start - 2, start + 1)),
    );
    const ok = kernel.editor.commands.setLink({ href: 'https://example.com' });
    expect(ok).toBe(true);
    const md = kernel.getMarkdown();
    // 无论选区切到哪，往返必须保留链接语法
    expect(md).toMatch(/\[[^\]]+\]\(https:\/\/example\.com\)/);
    expect(md).toContain('(https://example.com)');
    kernel.destroy();
    container.remove();
  });

  it('unsetLink 移除链接', () => {
    const { kernel, container } = make('见 [文档](https://example.com) 结尾\n');
    const view = kernel.editor.view;
    const from = view.state.doc.content.size - 3;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, from)),
    );
    expect(kernel.editor.commands.unsetLink()).toBe(true);
    expect(kernel.getMarkdown()).not.toContain('](https://example.com)');
    kernel.destroy();
    container.remove();
  });
});
