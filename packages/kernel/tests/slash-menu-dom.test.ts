// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createEditor } from '../src/editor';

const kernels: ReturnType<typeof createEditor>[] = [];
afterEach(() => {
  while (kernels.length) kernels.pop()?.destroy();
  document.body.innerHTML = '';
});

function mount(markdown: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const kernel = createEditor(host, { initialMarkdown: markdown, dragHandle: false });
  kernels.push(kernel);
  return { kernel, dom: kernel.editor.view.dom, host };
}

/**
 * 真实 contenteditable 编辑：先由浏览器修改 DOM，再派发 InputEvent，交给
 * ProseMirror 的 DOMObserver 将输入还原为编辑事务。这里绝不调用 handleTextInput
 * 或 tr.insertText。
 */
async function type(kernel: ReturnType<typeof createEditor>, text: string): Promise<void> {
  const dom = kernel.editor.view.dom;
  dom.focus();
  for (const character of text) {
    dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: character, bubbles: true, cancelable: true }),
    );
    const at = kernel.editor.view.domAtPos(kernel.editor.state.selection.from);
    let textNode: Text;
    let offset: number;
    if (at.node.nodeType === Node.TEXT_NODE) {
      textNode = at.node as Text;
      textNode.insertData(at.offset, character);
      offset = at.offset + character.length;
    } else {
      textNode = document.createTextNode(character);
      at.node.insertBefore(textNode, at.node.childNodes[at.offset] ?? null);
      offset = character.length;
    }
    // 浏览器输入会同步移动 DOM selection；测试须同样提供这个真实 DOM 状态，
    // 让 ProseMirror DOMObserver 解析输入位置而非从旧选区反推。
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(textNode, offset);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    dom.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
function press(dom: HTMLElement, key: string): void {
  dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
function selectEnd(kernel: ReturnType<typeof createEditor>): void {
  const end = kernel.editor.state.doc.content.size;
  kernel.editor.view.dispatch(
    kernel.editor.state.tr.setSelection(TextSelection.near(kernel.editor.state.doc.resolve(end))),
  );
  kernel.editor.view.focus();
}

describe('斜杠快捷输入真实 TipTap DOM 链路（DEV-052）', () => {
  it.each([
    ['段落', '段落 '],
    ['标题', '# 标题\n\n'],
    ['列表项', '- \n'],
    ['引用', '> 引用 \n'],
  ])('在%s的行首或空白后由浏览器输入事件打开菜单', async (_name, markdown) => {
    const { kernel, host } = mount(markdown);
    selectEnd(kernel);
    await type(kernel, '/');
    expect(host.querySelector('[data-slash-menu]')).not.toBeNull();
    expect(host.querySelector('[data-slash-menu]')?.getAttribute('style')).not.toContain(
      'display: none',
    );
  });

  it.each([
    ['代码块', '```ts\n\n```\n'],
    ['行内代码', '`code`\n'],
    ['URL', 'https:\n'],
    ['路径', '/Users\n'],
    ['数学', '$x$\n'],
    ['单词内部', 'word\n'],
  ])('在%s中保留普通斜杠且不打开菜单', async (_name, markdown) => {
    const { kernel, host } = mount(markdown);
    selectEnd(kernel);
    await type(kernel, '/');
    expect(host.querySelector('[data-slash-menu]')?.getAttribute('style')).toContain(
      'display: none',
    );
    expect(kernel.getMarkdown()).toContain('/');
  });

  it('过滤、方向键、Tab 确认消费触发串，且操作可 undo/redo', async () => {
    const { kernel, dom, host } = mount('\u00a0');
    selectEnd(kernel);
    await type(kernel, '/');
    await type(kernel, 'h');
    await type(kernel, '2');
    expect(host.querySelector('[data-slash-menu]')?.textContent).toContain('标题 H2');
    expect(host.querySelectorAll('[data-slash-item]')).toHaveLength(1);
    expect(host.querySelector('[data-slash-item]')?.getAttribute('data-slash-item')).toBe(
      'heading2',
    );
    press(dom, 'ArrowDown');
    press(dom, 'Tab');
    expect(kernel.editor.state.selection.$from.parent.type.name).toBe('heading');
    expect(kernel.editor.state.selection.$from.parent.attrs.level).toBe(2);
    expect(kernel.getMarkdown()).not.toContain('/h2');
    expect(kernel.undo()).toBe(true);
    expect(kernel.editor.state.selection.$from.parent.type.name).not.toBe('heading');
    expect(kernel.redo()).toBe(true);
    expect(
      kernel.getJSON().content?.some((node) => node.type === 'heading' && node.attrs?.level === 2),
    ).toBe(true);
  });

  it('Escape 保留原文，Backspace 越过触发词关闭，空态绝不执行', async () => {
    const { kernel, dom, host } = mount('\u00a0');
    selectEnd(kernel);
    await type(kernel, '/二级标题');
    press(dom, 'Escape');
    expect(kernel.getMarkdown()).toContain('/二级标题');
    await type(kernel, ' /不存在');
    expect(host.querySelector('[data-slash-empty]')).not.toBeNull();
    const before = kernel.getMarkdown();
    press(dom, 'Enter');
    expect(kernel.getMarkdown()).toBe(before);
    for (let index = 0; index <= '不存在'.length; index += 1) press(dom, 'Backspace');
    expect(host.querySelector('[data-slash-menu]')?.getAttribute('style')).toContain(
      'display: none',
    );
  });
});
