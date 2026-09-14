// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createEditor, type EditorKernelInstance } from '@nexnote/kernel';
import { TextSelection } from '@tiptap/pm/state';
import {
  FORMAT_LINK,
  FORMAT_WIKILINK,
  runFormatAction,
} from '../src/editor/interactions/formatting';

/**
 * DEV-023 块编辑划词工具栏「双链」动作（真实内核 TipTap）：
 * - 有选区：经内核 wikilink 节点插入（insertWikilink），序列化 `[[选区]]`，可 undo
 * - 无选区：插入 `[[` 触发内核 [[ 补全菜单（可确认）
 * - 双链不弹外链 URL 输入；外链仍走 setLink
 */

function mountKernel(markdown: string): { kernel: EditorKernelInstance; host: HTMLDivElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const kernel = createEditor(host, {
    initialMarkdown: markdown,
    slashMenu: false,
    dragHandle: false,
    wikilinkSuggestions: () => [{ id: '计划', title: '计划' }],
  });
  return { kernel, host };
}

/** 选中文本片段（首个文本块内）。 */
function selectRange(kernel: EditorKernelInstance, from: number, to: number) {
  kernel.editor.view.dispatch(
    kernel.editor.view.state.tr.setSelection(
      TextSelection.create(kernel.editor.view.state.doc, from, to),
    ),
  );
}

const stripAnchors = (md: string) => md.replace(/[ \t]*\^[A-Za-z0-9]+/g, '').trim();

describe('DEV-023 块编辑双链按钮（runFormatAction）', () => {
  it('有选区：经内核 wikilink 节点插入 [[选区]]，单次 undo 还原', () => {
    const { kernel } = mountKernel('参见 计划 结束');
    // 段落文本从 1 起：'参见 ' 占 3
    selectRange(kernel, 4, 6);
    expect(runFormatAction(FORMAT_WIKILINK, kernel, '计划')).toBe(true);
    const markdown = stripAnchors(kernel.getMarkdown());
    expect(markdown).toBe('参见 [[计划]] 结束');
    expect(JSON.stringify(kernel.getJSON())).toContain('"type":"wikilink"');
    expect(kernel.undo()).toBe(true);
    expect(stripAnchors(kernel.getMarkdown())).toBe('参见 计划 结束');
    kernel.destroy();
  });

  it('无选区：插入 [[ 骨架并触发内核 [[ 补全菜单', () => {
    const { kernel, host } = mountKernel('参见 结束');
    // 光标置于段落中部
    selectRange(kernel, 3, 3);
    expect(runFormatAction(FORMAT_WIKILINK, kernel, '')).toBe(true);
    // 文档文本含 [[ 触发串（序列化转义字面 '[' 为既有行为，与手动键入一致）
    const docText = kernel.editor.state.doc.textBetween(0, kernel.editor.state.doc.content.size);
    expect(docText).toBe('参见[[ 结束');
    const menu = host.querySelector<HTMLElement>('.nexnote-suggestion');
    expect(menu).toBeTruthy();
    expect(menu?.style.display).not.toBe('none');
    expect(menu?.textContent).toContain('计划');
    kernel.destroy();
  });

  it('双链不触发外链 URL 输入；外链动作仍弹 prompt 并 setLink', () => {
    const prompts: string[] = [];
    window.prompt = ((message?: string) => {
      prompts.push(message ?? '');
      return null;
    }) as typeof window.prompt;
    const { kernel } = mountKernel('参见 计划 结束');
    selectRange(kernel, 4, 6);

    // 双链：不弹 URL
    expect(runFormatAction(FORMAT_WIKILINK, kernel, '计划')).toBe(true);
    expect(stripAnchors(kernel.getMarkdown())).toBe('参见 [[计划]] 结束');
    expect(prompts).toHaveLength(0);

    // 外链：沿用 prompt 交互（取消则不改文档）——选中 wikilink 节点后再触发
    selectRange(kernel, 4, 5);
    expect(runFormatAction(FORMAT_LINK, kernel, '计划')).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(stripAnchors(kernel.getMarkdown())).toBe('参见 [[计划]] 结束');
    kernel.destroy();
  });
});
