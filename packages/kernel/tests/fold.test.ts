// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createEditor } from '../src/editor';

/**
 * DEV-017 标题折叠：块菜单「折叠/展开」的内核实现。
 * 折叠 = 视图层装饰状态（不写 Markdown），隐藏至下一个同级/更高级标题。
 */
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

/** 按文档序取顶层块的 blockId（依赖 ^id 解析）。 */
function topBlockIds(kernel: ReturnType<typeof make>['kernel']): string[] {
  const ids: string[] = [];
  kernel.editor.state.doc.forEach((n) => {
    const id = (n.attrs as { blockId?: string }).blockId;
    if (id) ids.push(id);
  });
  return ids;
}

describe('标题折叠（DEV-017）', () => {
  const MD = '# 甲 ^h1\n\n甲一 ^p1\n\n## 甲子 ^h2\n\n甲子一 ^p2\n\n# 乙 ^h3\n\n乙一 ^p3\n';

  it('canFoldBlock：标题可折叠，段落不可', () => {
    const { kernel, container } = make(MD);
    const [h1, p1] = topBlockIds(kernel);
    expect(kernel.canFoldBlock(h1!)).toBe(true);
    expect(kernel.canFoldBlock(p1!)).toBe(false);
    expect(kernel.canFoldBlock('不存在')).toBe(false);
    kernel.destroy();
    container.remove();
  });

  it('折叠 H1 隐藏到下一个 H1 之前的全部顶层块，Markdown 不变', () => {
    const { kernel, container } = make(MD);
    const [h1] = topBlockIds(kernel);
    const before = kernel.getMarkdown();
    expect(kernel.toggleBlockFold(h1!)).toBe(true);
    expect(kernel.isBlockFolded(h1!)).toBe(true);
    // 隐藏：甲一/甲子/甲子一（3 块）；乙 标题及之后不受影响
    const hidden = container.querySelectorAll('.nexnote-fold-hidden');
    expect(hidden.length).toBe(3);
    expect(container.querySelector('.nexnote-folded')).toBeTruthy();
    expect(container.querySelector('.nexnote-fold-toggle')).toBeTruthy();
    expect(kernel.getMarkdown()).toBe(before);
    kernel.destroy();
    container.remove();
  });

  it('再次折叠动作展开（toggle 往返），隐藏块恢复', () => {
    const { kernel, container } = make(MD);
    const [h1] = topBlockIds(kernel);
    kernel.toggleBlockFold(h1!);
    expect(container.querySelectorAll('.nexnote-fold-hidden').length).toBe(3);
    expect(kernel.toggleBlockFold(h1!)).toBe(true);
    expect(kernel.isBlockFolded(h1!)).toBe(false);
    expect(container.querySelectorAll('.nexnote-fold-hidden').length).toBe(0);
    kernel.destroy();
    container.remove();
  });

  it('H2 折叠只隐藏到下一个同级/更高级标题（H2 收，H1 不收）', () => {
    const { kernel, container } = make(MD);
    const [, , h2] = topBlockIds(kernel);
    kernel.toggleBlockFold(h2!);
    const hidden = container.querySelectorAll('.nexnote-fold-hidden');
    expect(hidden.length).toBe(1); // 仅「甲子一」
    kernel.destroy();
    container.remove();
  });

  it('删除被折叠标题后折叠状态被清理', () => {
    const { kernel, container } = make(MD);
    const [h1] = topBlockIds(kernel);
    kernel.toggleBlockFold(h1!);
    // 删除整个 H1 块
    const view = kernel.editor.view;
    let from = -1;
    let to = -1;
    view.state.doc.forEach((n, off) => {
      if ((n.attrs as { blockId?: string }).blockId === h1) {
        from = off;
        to = off + n.nodeSize;
      }
    });
    view.dispatch(view.state.tr.delete(from, to));
    expect(kernel.isBlockFolded(h1!)).toBe(false);
    kernel.destroy();
    container.remove();
  });
});
