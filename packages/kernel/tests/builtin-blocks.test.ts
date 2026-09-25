// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor } from '../src/editor';
import { buildKernelExtensions } from '../src/extensions';
import {
  MermaidBlock,
  MERMAID_BLOCK_NAME,
  MERMAID_DEFAULT_SOURCE,
  MERMAID_FLOWCHART_SOURCE,
  MERMAID_GANTT_SOURCE,
} from '../src/extensions/mermaid';
import { TextSelection } from '@tiptap/pm/state';

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

describe('Mermaid 块（DEV-015）', () => {
  it('渲染层 extra extension 覆盖同名内核节点而不重复注册 schema', () => {
    const override = MermaidBlock.extend({});
    const extensions = buildKernelExtensions({
      slashMenu: false,
      dragHandle: false,
      extraExtensions: [override],
    });
    const mermaidExtensions = extensions.filter(
      (extension) => extension.name === MERMAID_BLOCK_NAME,
    );
    expect(mermaidExtensions).toEqual([override]);
  });

  it('```mermaid 围栏解析为 mermaidBlock 并原样往返（Obsidian 兼容）', () => {
    const md = '```mermaid\ngraph TD\n  A --> B\n```\n';
    const { kernel, container } = make(md);
    const blocks = kernel.getJSON().content ?? [];
    const block = blocks.find((b) => b.type === 'mermaidBlock');
    expect(block).toBeTruthy();
    expect(block?.attrs?.source).toBe('graph TD\n  A --> B');
    // 围栏块作为末块时与既有 codeBlock 一致：不保留尾随空行。
    expect(kernel.getMarkdown()).toBe('```mermaid\ngraph TD\n  A --> B\n```');
    kernel.destroy();
    container.remove();
  });

  it('插入命令产出 mermaid 块并序列化为围栏', () => {
    const { kernel, container } = make('段落\n\n');
    kernel.editor.commands.insertMermaidBlock();
    const md = kernel.getMarkdown();
    expect(md).toContain('```mermaid');
    expect(md).toContain('graph TD');
    expect(kernel.getJSON().content?.some((b) => b.type === 'mermaidBlock')).toBe(true);
    kernel.destroy();
    container.remove();
  });

  it('缺省插入源码仍为 MERMAID_DEFAULT_SOURCE（兼容不变）', () => {
    const { kernel, container } = make('段落\n\n');
    kernel.editor.commands.insertMermaidBlock();
    const block = (kernel.getJSON().content ?? []).find((b) => b.type === 'mermaidBlock');
    expect(block?.attrs?.source).toBe(MERMAID_DEFAULT_SOURCE);
    expect(MERMAID_DEFAULT_SOURCE).toBe('graph TD\n  A --> B');
    kernel.destroy();
    container.remove();
  });

  it('insertMermaidFlowchart 插入流程图模板并序列化为标准 ```mermaid 围栏', () => {
    const { kernel, container } = make('段落\n\n');
    expect(kernel.editor.commands.insertMermaidFlowchart()).toBe(true);
    const block = (kernel.getJSON().content ?? []).find((b) => b.type === 'mermaidBlock');
    expect(block?.attrs?.source).toBe(MERMAID_FLOWCHART_SOURCE);
    expect(MERMAID_FLOWCHART_SOURCE).toContain('flowchart TD');
    const md = kernel.getMarkdown();
    expect(md.startsWith('```mermaid\nflowchart TD\n')).toBe(true);
    expect(md).toContain(`${MERMAID_FLOWCHART_SOURCE}\n\`\`\``);
    kernel.destroy();
    container.remove();
  });

  it('insertMermaidGantt 插入甘特图模板并序列化为标准 ```mermaid 围栏', () => {
    const { kernel, container } = make('段落\n\n');
    expect(kernel.editor.commands.insertMermaidGantt()).toBe(true);
    const block = (kernel.getJSON().content ?? []).find((b) => b.type === 'mermaidBlock');
    expect(block?.attrs?.source).toBe(MERMAID_GANTT_SOURCE);
    expect(MERMAID_GANTT_SOURCE).toContain('gantt\n');
    const md = kernel.getMarkdown();
    expect(md.startsWith('```mermaid\ngantt\n')).toBe(true);
    expect(md).toContain('dateFormat YYYY-MM-DD');
    expect(md).toContain(`${MERMAID_GANTT_SOURCE}\n\`\`\``);
    kernel.destroy();
    container.remove();
  });

  it('流程图/甘特图模板经围栏解析往返稳定（二次 round-trip 不变）', () => {
    for (const source of [MERMAID_FLOWCHART_SOURCE, MERMAID_GANTT_SOURCE]) {
      const serialized = '```mermaid\n' + source + '\n```';
      const first = make(`${serialized}\n`);
      const block = (first.kernel.getJSON().content ?? []).find((b) => b.type === 'mermaidBlock');
      expect(block?.attrs?.source).toBe(source);
      expect(first.kernel.getMarkdown()).toBe(serialized);
      const second = make(`${first.kernel.getMarkdown()}\n`);
      expect(second.kernel.getMarkdown()).toBe(serialized);
      first.kernel.destroy();
      first.container.remove();
      second.kernel.destroy();
      second.container.remove();
    }
  });

  it('~~~mermaid 波浪线围栏同样解析（CommonMark/Obsidian 合法），序列化归一为 ```', () => {
    const md = '~~~mermaid\ngraph TD\n  A --> B\n~~~\n';
    const { kernel, container } = make(md);
    const block = (kernel.getJSON().content ?? []).find((b) => b.type === 'mermaidBlock');
    expect(block?.attrs?.source).toBe('graph TD\n  A --> B');
    const serialized = kernel.getMarkdown();
    expect(serialized).toBe('```mermaid\ngraph TD\n  A --> B\n```');
    // 二次 round-trip 稳定。
    const again = make(serialized);
    expect(again.kernel.getMarkdown()).toBe(serialized);
    again.kernel.destroy();
    again.container.remove();
    kernel.destroy();
    container.remove();
  });

  it('围栏标记不得混用（```开 ~~~闭 视为普通代码块）', () => {
    const { kernel, container } = make('```mermaid\ngraph TD\n~~~\n');
    expect(kernel.getJSON().content?.some((b) => b.type === 'mermaidBlock')).toBe(false);
    kernel.destroy();
    container.remove();
  });

  it('非 mermaid 语言围栏不被误判', () => {
    const md = '```js\nconst a = 1;\n```\n';
    const { kernel, container } = make(md);
    expect(kernel.getJSON().content?.some((b) => b.type === 'mermaidBlock')).toBe(false);
    expect(kernel.getJSON().content?.some((b) => b.type === 'codeBlock')).toBe(true);
    kernel.destroy();
    container.remove();
  });
});

describe('KaTeX 块级公式（DEV-015）', () => {
  it('多行 $$…$$ 解析为 mathBlock 并往返', () => {
    const md = '$$\nE = mc^2\n$$\n';
    const { kernel, container } = make(md);
    const block = (kernel.getJSON().content ?? []).find((b) => b.type === 'mathBlock');
    expect(block).toBeTruthy();
    expect(block?.attrs?.source).toBe('E = mc^2');
    expect(kernel.getMarkdown()).toBe('$$\nE = mc^2\n$$');
    kernel.destroy();
    container.remove();
  });

  it('单行整段 $$…$$ 也解析为 mathBlock', () => {
    const md = '$$E = mc^2$$\n';
    const { kernel, container } = make(md);
    const blocks = kernel.getJSON().content ?? [];
    expect(blocks.some((b) => b.type === 'mathBlock')).toBe(true);
    expect(blocks.some((b) => b.type === 'mathInline')).toBe(false);
    kernel.destroy();
    container.remove();
  });

  it('插入命令产出 mathBlock', () => {
    const { kernel, container } = make('段落\n\n');
    kernel.editor.commands.insertMathBlock({ source: 'x^2' });
    const md = kernel.getMarkdown();
    expect(md).toContain('$$\nx^2\n$$');
    kernel.destroy();
    container.remove();
  });
});

describe('KaTeX 行内公式（DEV-015）', () => {
  it('段落内 $…$ 解析为 mathInline 并往返', () => {
    const md = '能量 $E = mc^2$ 守恒';
    const { kernel, container } = make(`${md}\n`);
    const para = (kernel.getJSON().content ?? []).find((b) => b.type === 'paragraph');
    const inline = para?.content?.find((n) => n.type === 'mathInline');
    expect(inline).toBeTruthy();
    expect(inline?.attrs?.source).toBe('E = mc^2');
    // 含原子内联节点的段落与既有 wikilink/hashtag 一致：末块不保留尾随换行。
    expect(kernel.getMarkdown()).toBe(md);
    kernel.destroy();
    container.remove();
  });

  it('货币 $100 与 $200 不被误判为公式', () => {
    const md = '价格 $100 到 $200 之间\n';
    const { kernel, container } = make(md);
    const para = (kernel.getJSON().content ?? []).find((b) => b.type === 'paragraph');
    expect(para?.content?.some((n) => n.type === 'mathInline')).toBe(false);
    kernel.destroy();
    container.remove();
  });

  it('段落中间的 $$x$$ 不被行内规则拆坏', () => {
    const md = '见 $$x$$ 此处';
    const { kernel, container } = make(`${md}\n`);
    const para = (kernel.getJSON().content ?? []).find((b) => b.type === 'paragraph');
    expect(para?.content?.some((n) => n.type === 'mathInline')).toBe(false);
    expect(kernel.getMarkdown()).toBe(md);
    kernel.destroy();
    container.remove();
  });

  it('插入命令产出 mathInline', () => {
    const { kernel, container } = make('内容\n');
    kernel.editor.commands.insertMathInline({ source: 'a/b' });
    expect(kernel.getMarkdown()).toContain('$a/b$');
    kernel.destroy();
    container.remove();
  });

  it('行内输入规则：键入 $…$ 自动转为 mathInline（可撤销路径）', () => {
    const { kernel, container } = make('你好 世界\n');
    const view = kernel.editor.view;
    const end = view.state.doc.content.size - 1;
    view.someProp('handleTextInput', (f) => f(view, end, end, '$a+b$'));
    const para = (kernel.getJSON().content ?? []).find((b) => b.type === 'paragraph');
    expect(para?.content?.some((n) => n.type === 'mathInline')).toBe(true);
    expect(kernel.getMarkdown()).toContain('$a+b$');
    kernel.destroy();
    container.remove();
  });

  it('块级输入规则：空段键入 $$…$$ 整段升级为 mathBlock', () => {
    const { kernel, container } = make('空段上方\n\n');
    const view = kernel.editor.view;
    const end = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end))));
    const from = view.state.selection.from;
    const ran = view.someProp('handleTextInput', (f) => f(view, from, from, '$$x^2$$'));
    expect(ran).toBe(true);
    expect(kernel.getJSON().content?.some((b) => b.type === 'mathBlock')).toBe(true);
    // 撤销后恢复段落原文。
    kernel.undo();
    expect(kernel.getJSON().content?.some((b) => b.type === 'mathBlock')).toBe(false);
    kernel.destroy();
    container.remove();
  });
});
