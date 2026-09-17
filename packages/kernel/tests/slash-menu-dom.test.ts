// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createEditor } from '../src/editor';

const kernels: ReturnType<typeof createEditor>[] = [];
afterEach(() => {
  while (kernels.length) kernels.pop()?.destroy();
  document.body.innerHTML = '';
});
function mount(
  markdown: string,
  extraSlashItems?: NonNullable<Parameters<typeof createEditor>[1]>['extraSlashItems'],
) {
  const host = document.createElement('div');
  document.body.append(host);
  const kernel = createEditor(host, {
    initialMarkdown: markdown,
    dragHandle: false,
    extraSlashItems,
  });
  kernels.push(kernel);
  return { kernel, dom: kernel.editor.view.dom, host };
}
/** happy-dom 无 contenteditable 默认编辑：keydown → DOM/selection mutation → InputEvent → DOMObserver。 */
async function type(kernel: ReturnType<typeof createEditor>, text: string): Promise<void> {
  const dom = kernel.editor.view.dom;
  dom.focus();
  for (const character of text) {
    dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: character, bubbles: true, cancelable: true }),
    );
    const at = kernel.editor.view.domAtPos(kernel.editor.state.selection.from);
    const textNode =
      at.node.nodeType === Node.TEXT_NODE ? (at.node as Text) : document.createTextNode('');
    if (at.node.nodeType === Node.TEXT_NODE) textNode.insertData(at.offset, character);
    else {
      at.node.insertBefore(textNode, at.node.childNodes[at.offset] ?? null);
      textNode.appendData(character);
    }
    const offset =
      at.node.nodeType === Node.TEXT_NODE ? at.offset + character.length : character.length;
    const range = document.createRange();
    range.setStart(textNode, offset);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    dom.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
const press = (dom: HTMLElement, key: string) =>
  dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
async function backspace(kernel: ReturnType<typeof createEditor>): Promise<void> {
  const dom = kernel.editor.view.dom;
  press(dom, 'Backspace');
  const pos = kernel.editor.state.selection.from;
  const at = kernel.editor.view.domAtPos(pos);
  if (at.node.nodeType === Node.TEXT_NODE && at.offset > 0) {
    (at.node as Text).deleteData(at.offset - 1, 1);
    const range = document.createRange();
    range.setStart(at.node, at.offset - 1);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    dom.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
function selectAt(kernel: ReturnType<typeof createEditor>, pos: number): void {
  kernel.editor.view.dispatch(
    kernel.editor.state.tr.setSelection(TextSelection.create(kernel.editor.state.doc, pos)),
  );
  kernel.editor.view.focus();
}
function firstNodeEnd(kernel: ReturnType<typeof createEditor>, name: string): number {
  let result = -1;
  kernel.editor.state.doc.descendants((node, pos) => {
    if (result < 0 && node.type.name === name) result = pos + node.nodeSize - 1;
  });
  expect(result).toBeGreaterThan(0);
  return result;
}

describe('斜杠快捷输入真实 TipTap DOM 链路（DEV-052）', () => {
  it.each([
    ['段落', '段落 ', 'paragraph'],
    ['标题', '# 标题', 'heading'],
    ['列表项', '- 列表', 'paragraph'],
    ['引用', '> 引用 ', 'paragraph'],
  ] as const)('在%s的行首或空白后打开，光标位于真实目标节点', async (_name, markdown, parent) => {
    const { kernel, host } = mount(markdown);
    selectAt(kernel, firstNodeEnd(kernel, parent));
    expect(kernel.editor.state.selection.$from.parent.type.name).toBe(parent);
    await type(kernel, ' /');
    expect(host.querySelector('[data-slash-menu]')?.getAttribute('style')).not.toContain(
      'display: none',
    );
  });
  it.each([
    ['代码块', '```ts\ncode\n```\n'],
    ['行内代码', '`code`\n'],
    ['URL', 'https://host\n'],
    ['路径', '/Users/path\n'],
    ['已闭合数学', '$x$\n'],
    ['未闭合数学', '$x\n'],
    ['单词内部', 'word\n'],
  ])('在%s中普通 / 不触发', async (_name, markdown) => {
    const { kernel, host } = mount(markdown);
    selectAt(kernel, kernel.editor.state.doc.content.size - 1);
    await type(kernel, '/');
    expect(host.querySelector('[data-slash-menu]')?.getAttribute('style')).toContain(
      'display: none',
    );
    expect(kernel.getMarkdown()).toContain('/');
  });
  it('中文/英文/记号过滤与 ArrowUp/Down、Enter/Tab', async () => {
    const first = mount('\u00a0');
    selectAt(first.kernel, first.kernel.editor.state.doc.content.size - 1);
    await type(first.kernel, '/h2');
    expect(first.host.querySelector('[data-slash-item]')?.getAttribute('data-slash-item')).toBe(
      'block:heading:2',
    );
    press(first.dom, 'ArrowDown');
    press(first.dom, 'ArrowUp');
    press(first.dom, 'Tab');
    expect(first.kernel.editor.state.selection.$from.parent.attrs.level).toBe(2);
    expect(first.kernel.getMarkdown()).not.toContain('/h2');
    expect(first.kernel.getMarkdown()).not.toContain('h2');
    expect(first.kernel.undo()).toBe(true);
    expect(first.kernel.editor.state.selection.$from.parent.type.name).not.toBe('heading');
    expect(first.kernel.redo()).toBe(true);
    expect(
      first.kernel
        .getJSON()
        .content?.some((node) => node.type === 'heading' && node.attrs?.level === 2),
    ).toBe(true);
    const second = mount('\u00a0');
    selectAt(second.kernel, second.kernel.editor.state.doc.content.size - 1);
    await type(second.kernel, '/二级标题');
    press(second.dom, 'Enter');
    expect(second.kernel.editor.state.selection.$from.parent.attrs.level).toBe(2);
  });
  it('trigger 前后任一有效正文均隐藏转换且不删除后文', async () => {
    const { kernel, host } = mount('前文 后文');
    selectAt(kernel, 4);
    await type(kernel, '/ul');
    expect(
      [...host.querySelectorAll('[data-slash-item]')].map((node) =>
        node.getAttribute('data-slash-item'),
      ),
    ).not.toContain('block:bullet-list');
    expect(kernel.getMarkdown()).toContain('后文');
  });
  it('结构在安全块边界插入，双链仍在光标行内', async () => {
    const structure = mount('正文 ');
    selectAt(structure.kernel, structure.kernel.editor.state.doc.content.size - 1);
    await type(structure.kernel, '/表格');
    press(structure.dom, 'Enter');
    const structureText = structure.kernel.getMarkdown();
    expect(structureText).toContain('正文');
    expect(structureText).not.toContain('/表格');
    expect(structure.kernel.getJSON().content?.some((node) => node.type === 'table')).toBe(true);
    expect(structure.kernel.undo()).toBe(true);
    expect(structure.kernel.getMarkdown()).toContain('正文');
    expect(structure.kernel.redo()).toBe(true);
    expect(structure.kernel.getMarkdown()).not.toContain('/表格');
    const inline = mount('\u00a0');
    selectAt(inline.kernel, inline.kernel.editor.state.doc.content.size - 1);
    await type(inline.kernel, '/双链');
    press(inline.dom, 'Enter');
    expect(inline.kernel.getMarkdown()).toContain('\\[\\[');
  });

  it('裸 / 精确消费且单步 undo/redo；换块后旧菜单立即关闭且 Enter 无效', async () => {
    const naked = mount('\u00a0');
    selectAt(naked.kernel, naked.kernel.editor.state.doc.content.size - 1);
    await type(naked.kernel, '/');
    press(naked.dom, 'ArrowDown');
    press(naked.dom, 'Enter');
    expect(naked.kernel.getMarkdown()).not.toContain('/');
    expect(naked.kernel.undo()).toBe(true);
    expect(naked.kernel.editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(naked.kernel.redo()).toBe(true);

    const moved = mount('第一段 \n\n第二段');
    selectAt(moved.kernel, firstNodeEnd(moved.kernel, 'paragraph'));
    await type(moved.kernel, '/h2');
    const secondPos = moved.kernel.editor.state.doc.content.size - 1;
    selectAt(moved.kernel, secondPos);
    expect(moved.host.querySelector('[data-slash-menu]')?.getAttribute('style')).toContain(
      'display: none',
    );
    const before = moved.kernel.getMarkdown().trimEnd();
    press(moved.dom, 'Enter');
    expect(moved.kernel.getMarkdown().trimEnd()).toBe(before);
    expect(moved.kernel.getMarkdown()).toContain('第二段');
  });
  it('Escape/Backspace/空态及插件能力过滤', async () => {
    const { kernel, dom, host } = mount('\u00a0', () => [
      {
        id: 'plugin:hidden',
        title: '隐藏插件动作',
        group: '插件',
        kind: 'plugin',
        contract: { execution: 'insert-at-cursor', capability: 'plugin-defined' },
        available: () => false,
        action: () => {
          throw new Error('must not run');
        },
      },
    ]);
    selectAt(kernel, kernel.editor.state.doc.content.size - 1);
    await type(kernel, '/隐藏');
    expect(host.querySelector('[data-slash-empty]')).not.toBeNull();
    const before = kernel.getMarkdown();
    press(dom, 'Enter');
    expect(kernel.getMarkdown()).toBe(before);
    for (let index = 0; index <= '隐藏'.length; index += 1) await backspace(kernel);
    expect(host.querySelector('[data-slash-menu]')?.getAttribute('style')).toContain(
      'display: none',
    );
    await type(kernel, '/二级标题');
    press(dom, 'Escape');
    expect(kernel.getMarkdown()).toContain('/二级标题');
  });
});
