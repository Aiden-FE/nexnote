// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor } from '../src/editor';
import {
  TABLE_OF_CONTENTS_MARKER,
  TABLE_OF_CONTENTS_NAME,
} from '../src/extensions/table-of-contents';

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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('正文目录块', () => {
  it('真实 createEditor 初始渲染目录标题及所有标题条目，不把派生条目写入节点', () => {
    const { kernel, container } = make(
      `# 一级标题\n\n${TABLE_OF_CONTENTS_MARKER}\n\n### 三级标题\n`,
    );
    const block = kernel.getJSON().content?.find((node) => node.type === TABLE_OF_CONTENTS_NAME);
    const toc = container.querySelector('[data-table-of-contents]');
    const items = [...container.querySelectorAll<HTMLElement>('[data-table-of-contents-item]')];

    expect(block).toEqual({ type: TABLE_OF_CONTENTS_NAME });
    expect(kernel.editor.schema.nodes[TABLE_OF_CONTENTS_NAME].spec.atom).toBe(true);
    expect(kernel.editor.schema.nodes[TABLE_OF_CONTENTS_NAME].spec.selectable).toBe(true);
    expect(toc?.querySelector('.nexnote-table-of-contents-title')?.textContent).toBe('目录');
    expect(items.map((item) => item.textContent)).toEqual(['一级标题', '三级标题']);
    expect(items.map((item) => item.dataset.level)).toEqual(['1', '3']);
    expect(items.every((item) => Number.isFinite(Number(item.dataset.pos)))).toBe(true);

    kernel.destroy();
    container.remove();
  });

  it('editor update 后自动刷新派生条目', () => {
    const { kernel, container } = make(`# 旧标题\n\n${TABLE_OF_CONTENTS_MARKER}\n`);
    const heading = kernel.editor.state.doc.firstChild!;

    kernel.editor.view.dispatch(
      kernel.editor.state.tr.insertText('新标题', 1, 1 + heading.content.size),
    );

    expect(
      [...container.querySelectorAll<HTMLElement>('[data-table-of-contents-item]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['新标题']);

    kernel.destroy();
    container.remove();
  });

  it('无标题时显示空态', () => {
    const { kernel, container } = make(`${TABLE_OF_CONTENTS_MARKER}\n\n正文\n`);

    expect(container.querySelector('[data-table-of-contents-empty]')?.textContent).toBe('暂无标题');
    expect(container.querySelectorAll('[data-table-of-contents-item]')).toHaveLength(0);

    kernel.destroy();
    container.remove();
  });

  it('点击条目滚动到标题，editable 时聚焦并选中标题', () => {
    const { kernel, container } = make(`# 可跳转\n\n${TABLE_OF_CONTENTS_MARKER}\n`);
    const headingElement = container.querySelector('h1') as HTMLElement;
    let scrolled = false;
    headingElement.scrollIntoView = () => {
      scrolled = true;
    };

    container.querySelector<HTMLElement>('[data-table-of-contents-item]')!.click();

    expect(scrolled).toBe(true);
    expect(kernel.editor.state.selection.from).toBe(1);
    expect(kernel.editor.state.selection.to).toBe('可跳转'.length + 1);
    expect(kernel.editor.view.hasFocus()).toBe(true);

    kernel.destroy();
    container.remove();
  });

  it('destroy 清理 editor transaction listener', () => {
    const { kernel, container } = make(`# 标题\n\n${TABLE_OF_CONTENTS_MARKER}\n`);
    const off = vi.spyOn(kernel.editor, 'off');

    kernel.destroy();

    expect(off).toHaveBeenCalledWith('transaction', expect.any(Function));
    container.remove();
  });

  it('Markdown round-trip 只含协议标记，不含派生条目', () => {
    const markdown = `# 不应固化\n\n${TABLE_OF_CONTENTS_MARKER}\n`;
    const first = make(markdown);
    const serialized = first.kernel.getMarkdown();
    const second = make(serialized);

    expect(serialized).toBe(`# 不应固化\n\n${TABLE_OF_CONTENTS_MARKER}`);
    expect(serialized).not.toContain('- 不应固化');
    expect(second.kernel.getMarkdown()).toBe(serialized);
    expect(second.container.querySelector('[data-table-of-contents-item]')?.textContent).toBe(
      '不应固化',
    );

    first.kernel.destroy();
    first.container.remove();
    second.kernel.destroy();
    second.container.remove();
  });

  it('insertTableOfContents 命令插入目录意图块', () => {
    const { kernel, container } = make('正文\n');

    expect(kernel.editor.commands.insertTableOfContents()).toBe(true);
    expect(
      kernel.getJSON().content?.filter((node) => node.type === TABLE_OF_CONTENTS_NAME),
    ).toHaveLength(1);
    expect(kernel.getMarkdown()).toContain(TABLE_OF_CONTENTS_MARKER);

    kernel.destroy();
    container.remove();
  });

  it('保留多个重复目录标记', () => {
    const markdown = `${TABLE_OF_CONTENTS_MARKER}\n\n正文\n\n${TABLE_OF_CONTENTS_MARKER}\n`;
    const { kernel, container } = make(markdown);

    expect(
      kernel.getJSON().content?.filter((node) => node.type === TABLE_OF_CONTENTS_NAME),
    ).toHaveLength(2);
    expect(kernel.getMarkdown().match(/<!-- nexnote:toc -->/g)).toHaveLength(2);

    kernel.destroy();
    container.remove();
  });

  it('不误判行内标记、普通 HTML 注释或代码块中的标记', () => {
    const markdown = [
      `前缀 ${TABLE_OF_CONTENTS_MARKER} 后缀`,
      '',
      '<!-- nexnote:toc --> extra',
      '',
      '<div><!-- nexnote:toc --></div>',
      '',
      '<pre>',
      TABLE_OF_CONTENTS_MARKER,
      '</pre>',
      '',
      `    ${TABLE_OF_CONTENTS_MARKER}`,
      '',
      '```html',
      TABLE_OF_CONTENTS_MARKER,
      '```',
      '',
    ].join('\n');
    const { kernel, container } = make(markdown);

    expect(kernel.getJSON().content?.some((node) => node.type === TABLE_OF_CONTENTS_NAME)).toBe(
      false,
    );

    kernel.destroy();
    container.remove();
  });

  it('接受 CRLF 独立行并在连续 round-trip 后稳定', () => {
    const markdown = `# 标题\r\n\r\n${TABLE_OF_CONTENTS_MARKER}\r\n\r\n正文\r\n`;
    const first = make(markdown);
    const once = first.kernel.getMarkdown();
    const second = make(once);

    expect(
      first.kernel.getJSON().content?.some((node) => node.type === TABLE_OF_CONTENTS_NAME),
    ).toBe(true);
    expect(second.kernel.getMarkdown()).toBe(once);
    expect(once).toContain(TABLE_OF_CONTENTS_MARKER);

    first.kernel.destroy();
    first.container.remove();
    second.kernel.destroy();
    second.container.remove();
  });
});
