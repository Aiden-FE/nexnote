// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
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

/** 顶层块 [from,to]（临时存当前块范围）。 */
function blockRangeAtEnd(kernel: ReturnType<typeof make>['kernel']): { from: number; to: number } {
  const { doc } = kernel.editor.state;
  const end = doc.content.size;
  return { from: end - 1, to: end };
}

describe('块菜单内核操作（DEV-017）', () => {
  it('删除块可撤销', () => {
    const { kernel, container } = make('甲\n\n乙\n');
    const view = kernel.editor.view;
    // 找到含「乙」的顶层块范围
    let from = -1;
    let to = -1;
    view.state.doc.forEach((n, off) => {
      const start = off;
      const end = start + n.nodeSize;
      if (n.textContent === '乙' && from < 0) {
        from = start;
        to = end;
      }
    });
    expect(from).toBeGreaterThanOrEqual(0);
    view.dispatch(view.state.tr.delete(from, to));
    expect(kernel.getMarkdown()).not.toContain('乙');
    kernel.undo();
    expect(kernel.getMarkdown()).toContain('乙');
    kernel.destroy();
    container.remove();
  });

  it('moveBlock 上移一档，save 后顺序一致', () => {
    const { kernel, container } = make('甲 ^a1\n\n乙 ^b1\n\n丙 ^c1\n');
    // 解析的根层块 blockId 来自 ^id；先以 moveBlock 交换 c 到 b 前
    expect(kernel.moveBlock('c1', 'b1', 'before')).toBe(true);
    const md = kernel.getMarkdown();
    expect(md.indexOf('丙') < md.indexOf('乙')).toBe(true);
    expect(md.indexOf('乙') < md.indexOf('甲')).toBe(false); // 丙已在乙前
    expect(md).toContain('丙');
    kernel.destroy();
    container.remove();
  });

  it('convertBlock：任务列表包裹合法且往返', () => {
    const { kernel, container } = make('一行内容\n');
    const view = kernel.editor.view;
    const r = blockRangeAtEnd(kernel);
    const { taskList, taskItem } = kernel.editor.state.schema.nodes;
    const slice = kernel.editor.state.doc.slice(r.from, r.to);
    const item = taskItem!.create(null, slice.content);
    view.dispatch(view.state.tr.replaceRangeWith(r.from, r.to, taskList!.create(null, [item])));
    const json = kernel.getJSON();
    expect(json.content?.some((b) => b.type === 'taskList')).toBe(true);
    expect(kernel.getMarkdown()).toContain('- [ ]');
    kernel.destroy();
    container.remove();
  });
});
