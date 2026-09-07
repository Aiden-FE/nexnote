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
  });
  return { container, kernel };
}

/** 找到文档中 textContent 匹配的顶层块的 [from, to, blockId]。 */
function findBlock(
  kernel: ReturnType<typeof make>['kernel'],
  text: string,
): { from: number; to: number; blockId: string } | null {
  let result: { from: number; to: number; blockId: string } | null = null;
  kernel.editor.state.doc.forEach((n, off) => {
    if (result) return;
    const bid = (n.attrs as { blockId?: string }).blockId;
    if (typeof bid === 'string' && bid && n.textContent === text) {
      result = { from: off, to: off + n.nodeSize, blockId: bid };
    }
  });
  return result;
}

describe('块菜单内核操作（DEV-017）', () => {
  it('删除块可撤销', () => {
    const { kernel, container } = make('甲 ^a1\n\n乙 ^b1\n');
    const b = findBlock(kernel, '乙');
    expect(b).not.toBeNull();
    expect(kernel.deleteBlockById(b!.blockId)).toBe(true);
    expect(kernel.getMarkdown()).not.toContain('乙');
    kernel.undo();
    expect(kernel.getMarkdown()).toContain('乙');
    kernel.destroy();
    container.remove();
  });

  it('moveBlock 上移一档，顺序一致', () => {
    const { kernel, container } = make('甲 ^a1\n\n乙 ^b1\n\n丙 ^c1\n');
    expect(kernel.moveBlock('c1', 'b1', 'before')).toBe(true);
    const md = kernel.getMarkdown();
    expect(md.indexOf('丙') < md.indexOf('乙')).toBe(true);
    kernel.destroy();
    container.remove();
  });

  it('convertBlock: paragraph → codeBlock 且内容保留', () => {
    const { kernel, container } = make('一行内容 ^p1\n');
    const b = findBlock(kernel, '一行内容');
    expect(b).not.toBeNull();
    expect(kernel.convertBlock('codeBlock', b!.from, b!.to)).toBe(true);
    const md = kernel.getMarkdown();
    expect(md).toContain('```');
    expect(md).toContain('一行内容');
    kernel.undo();
    expect(kernel.getMarkdown()).toContain('一行内容');
    kernel.destroy();
    container.remove();
  });

  it('convertBlock: heading → taskList 内容保留', () => {
    const { kernel, container } = make('## 任务一 ^h1\n');
    const b = findBlock(kernel, '任务一');
    expect(b).not.toBeNull();
    expect(kernel.convertBlock('taskList', b!.from, b!.to)).toBe(true);
    const md = kernel.getMarkdown();
    expect(md).toContain('- [ ] 任务一');
    kernel.destroy();
    container.remove();
  });

  it('convertBlock: 不支持的类型返回 false', () => {
    const { kernel, container } = make('一行 ^p1\n');
    const b = findBlock(kernel, '一行');
    expect(b).not.toBeNull();
    expect(kernel.convertBlock('nonexistent_kind' as never, b!.from, b!.to)).toBe(false);
    kernel.destroy();
    container.remove();
  });

  it('insertEmptyBlock: 在块后插入新段落并移入光标', () => {
    const { kernel, container } = make('首段 ^p1\n');
    const b = findBlock(kernel, '首段');
    expect(b).not.toBeNull();
    const ok = kernel.insertEmptyBlock(b!.to, 'after');
    expect(ok).toBe(true);
    let paraCount = 0;
    kernel.editor.state.doc.forEach((n) => {
      if (n.type.name === 'paragraph') paraCount++;
    });
    expect(paraCount).toBe(2);
    const { selection } = kernel.editor.state;
    expect(selection.empty).toBe(true);
    expect(selection.$from.parent.type.name).toBe('paragraph');
    kernel.destroy();
    container.remove();
  });

  it('deleteBlockById: 不存在返回 false', () => {
    const { kernel, container } = make('一行 ^p1\n');
    expect(kernel.deleteBlockById('nonexistent-id')).toBe(false);
    kernel.destroy();
    container.remove();
  });

  it('折叠时选区落在隐藏区间会被移回标题行', () => {
    const { kernel, container } = make('# 标题 ^h1\n\n正文第一段 ^p1\n\n正文第二段 ^p2\n\n## 下一级 ^h2\n');
    const p1 = findBlock(kernel, '正文第一段');
    expect(p1).not.toBeNull();
    const view = kernel.editor.view;
    // 选区落在 p1 内
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, p1!.from + 1),
      ),
    );
    expect(kernel.isBlockFolded('h1')).toBe(false);
    expect(kernel.toggleBlockFold('h1')).toBe(true);
    expect(kernel.isBlockFolded('h1')).toBe(true);
    const { $from } = kernel.editor.state.selection;
    expect($from.parent.type.name).toBe('heading');
    kernel.destroy();
    container.remove();
  });
});
