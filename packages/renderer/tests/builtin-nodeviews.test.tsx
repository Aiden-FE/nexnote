// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { createEditor } from '@nexnote/kernel';
import {
  buildBuiltinSlashItems,
  buildBuiltinViewExtensions,
} from '../src/features/plugins/builtin/builtin-extensions';

function makeEditor(initialMarkdown: string, active: { mermaid: boolean; katex: boolean }) {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, {
    initialMarkdown,
    slashMenu: false,
    dragHandle: false,
    extraExtensions: buildBuiltinViewExtensions(active),
  });
  return { container, kernel };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

beforeAll(() => {
  // happy-dom 默认 quirks mode，KaTeX 拒绝渲染；注入标准模式标记。
  Object.defineProperty(document, 'compatMode', { configurable: true, value: 'CSS1Compat' });
});

describe('内置块 NodeView（DEV-015）', () => {
  it('Mermaid 块挂载预览容器；双击进入编辑，失焦提交新源码', async () => {
    const { kernel, container } = makeEditor('段落\n\n', { mermaid: true, katex: false });
    kernel.editor.commands.insertMermaidBlock({ source: 'graph TD\n  A --> B' });
    await flush();

    const view = container.querySelector('[data-mermaid-view]');
    expect(view).toBeTruthy();
    expect(container.querySelector('.nexnote-mermaid-preview')).toBeTruthy();
    expect(container.querySelector('.nexnote-mermaid-editor')).toBeNull();

    // 双击进入编辑态。
    view!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const textarea = container.querySelector<HTMLTextAreaElement>('.nexnote-mermaid-editor');
    expect(textarea).toBeTruthy();
    expect(textarea!.value).toContain('graph TD');

    // 改源码并失焦提交。
    textarea!.value = 'sequenceDiagram\n  X->>Y: hi';
    textarea!.dispatchEvent(new Event('blur'));
    await flush();

    const md = kernel.getMarkdown();
    expect(md).toContain('```mermaid');
    expect(md).toContain('sequenceDiagram');
    expect(md).not.toContain('graph TD');
    expect(container.querySelector('.nexnote-mermaid-editor')).toBeNull();
    kernel.destroy();
    container.remove();
  });

  it('KaTeX 块级公式渲染为 KaTeX HTML；双击可改源码', async () => {
    const { kernel, container } = makeEditor('$$\nE = mc^2\n$$\n', { mermaid: false, katex: true });
    await flush();
    await flush();

    const view = container.querySelector('[data-math-view="block"]');
    expect(view).toBeTruthy();
    const preview = view!.querySelector('.nexnote-math-preview');
    expect(preview).toBeTruthy();
    // KaTeX 渲染产物包含 .katex 容器。
    expect(view!.querySelector('.katex')).toBeTruthy();
    expect(preview!.textContent).not.toContain('渲染中');

    view!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const textarea = container.querySelector<HTMLTextAreaElement>('.nexnote-math-editor');
    expect(textarea).toBeTruthy();
    textarea!.value = 'x^2 + y^2';
    textarea!.dispatchEvent(new Event('blur'));
    await flush();
    await flush();

    const md = kernel.getMarkdown();
    expect(md).toContain('x^2 + y^2');
    expect(md).not.toContain('E = mc^2');
    kernel.destroy();
    container.remove();
  });

  it('插件禁用时回退为源码视图（无 NodeView 覆盖），往返仍可用', async () => {
    const { kernel, container } = makeEditor('行内 $a+b$ 公式\n', { mermaid: false, katex: false });
    await flush();
    expect(container.querySelector('[data-math-view]')).toBeNull();
    const fallback = container.querySelector('.nexnote-math-inline');
    expect(fallback).toBeTruthy();
    expect(fallback!.textContent).toBe('$a+b$');
    expect(kernel.getMarkdown()).toContain('$a+b$');
    kernel.destroy();
    container.remove();
  });

  it('斜杠菜单动作插入内置块节点（mermaid/mathBlock/mathInline）', () => {
    const { kernel, container } = makeEditor('内容\n\n', { mermaid: true, katex: true });
    const items = buildBuiltinSlashItems({ mermaid: true, katex: true });
    const byId = (id: string) => items.find((i) => i.id === id)!;
    const fakeCtx = { view: kernel.editor.view };

    expect(byId('insert:mermaid-flowchart').action(fakeCtx as never)).toBe(true);
    const md = kernel.getMarkdown();
    expect(md).toContain('```mermaid\nflowchart TD');
    expect(md).toContain('A[开始]');

    expect(byId('insert:mermaid-gantt').action(fakeCtx as never)).toBe(true);
    expect(kernel.getMarkdown()).toContain('```mermaid\ngantt\n');
    expect(kernel.getJSON().content?.some((n) => n.type === 'mermaidBlock')).toBe(true);

    expect(byId('builtin:math-block').action(fakeCtx as never)).toBe(true);
    expect(kernel.getJSON().content?.some((n) => n.type === 'mathBlock')).toBe(true);

    expect(byId('builtin:math-inline').action(fakeCtx as never)).toBe(true);
    expect(kernel.editor.view.dom.querySelector('.nexnote-math-inline-view')).toBeTruthy();
    kernel.destroy();
    container.remove();
  });

  it('Mermaid 插件关闭时流程图/甘特图围栏仍可解析与往返（无 NodeView 覆盖）', () => {
    const md = '```mermaid\nflowchart TD\n  A[开始] --> B{是否继续}\n```\n';
    const { kernel, container } = makeEditor(md, { mermaid: false, katex: false });
    expect(container.querySelector('[data-mermaid-view]')).toBeNull();
    expect(container.querySelector('.nexnote-mermaid-block .nexnote-mermaid-source')).toBeTruthy();
    expect(kernel.getMarkdown()).toBe('```mermaid\nflowchart TD\n  A[开始] --> B{是否继续}\n```');

    const gantt = makeEditor('```mermaid\ngantt\n  title 项目计划\n```\n', {
      mermaid: false,
      katex: false,
    });
    expect(gantt.kernel.getMarkdown()).toBe('```mermaid\ngantt\n  title 项目计划\n```');
    kernel.destroy();
    container.remove();
    gantt.kernel.destroy();
    gantt.container.remove();
  });
});
