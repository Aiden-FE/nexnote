// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createEditor } from '../src/editor';
import type { BlockMenuContext } from '../src/extensions/block-menu';
import { blockMenuPluginKey } from '../src/extensions/block-menu';

function make(blocksMarkdown: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const actions: Array<{ id: string; text: string }> = [];
  const kernel = createEditor(container, {
    initialMarkdown: blocksMarkdown,
    slashMenu: false,
    dragHandle: false,
    blockMenu: {
      build: (_ctx: BlockMenuContext) => [
        { id: 'delete', title: '删除', disabled: false },
        { id: 'move-up', title: '上移' },
        { title: 'AI 子菜单', submenu: [{ id: 'ai-continue', title: '继续写作' }] },
        { separator: true },
        { id: 'copy-id', title: '复制块 ID' },
      ],
      onAction: (id, ctx) => {
        actions.push({ id, text: ctx.text });
        if (id === 'delete') {
          const tr = ctx.view.state.tr.delete(ctx.from, ctx.to);
          ctx.view.dispatch(tr);
        }
      },
    },
  });
  return { container, kernel, actions };
}

function state(kernel: ReturnType<typeof make>['kernel']) {
  return blockMenuPluginKey.getState(kernel.editor.state) as {
    open: boolean;
    showAt(v: unknown, x: number, y: number, blockId: string): void;
    close(): void;
  };
}

describe('块菜单（DEV-017）', () => {
  it('showAt 在指针处弹出菜单，动作回调收到整块上下文', () => {
    const { kernel, container, actions } = make('第一块\n\n第二块\n\n');
    const s = state(kernel);
    expect(s).toBeTruthy();
    // 初始解析的块 root-level 由 parse 产生 blockId=null；用插入命令拿到带 id 的块
    const view = kernel.editor.view as never;
    kernel.editor.commands.insertContent({
      type: 'paragraph',
      attrs: { blockId: 'test-a1' },
      content: [{ type: 'text', text: '插入块' }],
    });
    const blockId = 'test-a1';
    const end = view.state.doc.content.size;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end))));
    s.showAt(view, 10, 20, blockId);
    expect(s.open).toBe(true);
    const menu = document.body.querySelector('.nexnote-block-menu');
    expect(menu).toBeTruthy();

    const row = [...menu!.querySelectorAll<HTMLElement>('[data-context-menu-item]')].find(
      (r) => r.dataset.contextMenuItem === 'delete',
    );
    expect(row).toBeTruthy();
    row!.click();
    expect(actions).toContainEqual({ id: 'delete', text: '插入块' });
    // 删除动作在渲染层构建里 dispatch
    expect(kernel.getMarkdown()).not.toContain('插入块');

    // 重新插入块后再次打开再 close
    kernel.editor.commands.insertContent({
      type: 'paragraph',
      attrs: { blockId: 'test-a2' },
      content: [{ type: 'text', text: '又一块' }],
    });
    s.showAt(view, 10, 20, 'test-a2');
    expect(s.open).toBe(true);
    s.close();
    expect(s.open).toBe(false);
    kernel.destroy();
    container.remove();
  });

  it('getBlockMarkdown 取顶层块 Markdown（含 ^id 锚点）', () => {
    const { kernel, container } = make('甲块 ^abc1\n\n乙块\n\n');
    const json = kernel.getJSON();
    const first = json.content!.find((b) => b.type === 'paragraph');
    const idx = json.content!.indexOf(first!);
    const start = (() => {
      let pos = 0;
      for (let i = 0; i < idx; i++) {
        pos += json.content![i].type === 'paragraph' ? 2 + (json.content![i].content?.length ?? 0) : 2;
      }
      return pos;
    })();
    const block = first!;
    const text = (block.content ?? []).map((c) => (c as { text?: string }).text ?? '').join('');
    const md = kernel.getBlockMarkdown(start, start + 2 + text.length);
    expect(md).toContain('甲块');
    kernel.destroy();
    container.remove();
  });
});
