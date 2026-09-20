// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { buildKernelExtensions, createEditor } from '../src';
import {
  isSandwichedEmptyListItem,
  ListDev069,
} from '../src/extensions/list-dev069';

function makeEditor(markdown: string) {
  return createEditor(document.createElement('div'), {
    initialMarkdown: markdown,
    slashMenu: false,
    dragHandle: false,
  });
}

function findTextPos(doc: Node, target: string): number {
  let pos = -1;
  doc.descendants((node, p) => {
    if (pos === -1 && node.type.name === 'text' && node.text === target) pos = p;
    return true;
  });
  return pos;
}

function emptyListItemWithText(kernel: ReturnType<typeof makeEditor>, target: string) {
  const doc = kernel.editor.state.doc;
  const pos = findTextPos(doc, target);
  expect(pos).toBeGreaterThan(0);
  const { state, view } = kernel.editor;
  let textLen = 0;
  state.doc.descendants((node, p) => {
    if (p === pos && node.type.name === 'text' && node.text) textLen = node.text.length;
    return true;
  });
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos, pos + textLen)));
  kernel.editor.commands.deleteSelection();
  // 重新把光标设到空段落起始
  let emptyParaPos = -1;
  kernel.editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'paragraph' && node.childCount === 0 && emptyParaPos === -1) {
      emptyParaPos = p + 1;
    }
    return true;
  });
  if (emptyParaPos >= 0) {
    view.dispatch(
      kernel.editor.state.tr.setSelection(TextSelection.create(kernel.editor.state.doc, emptyParaPos)),
    );
  }
}

function pressBackspace(kernel: ReturnType<typeof makeEditor>) {
  const { view } = kernel.editor;
  const evt = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
  view.dom.dispatchEvent(evt);
}

describe('DEV-069 · isSandwichedEmptyListItem 探测', () => {
  it('空列表项夹在甲/丙之间时返回 true', () => {
    const kernel = makeEditor('- 甲\n- 乙\n- 丙\n');
    emptyListItemWithText(kernel, '乙');
    expect(isSandwichedEmptyListItem(kernel.editor.state)).toBe(true);
  });

  it('空列表项位于首/尾时返回 false（让默认 lift）', () => {
    const kernel = makeEditor('- 甲\n- 乙\n- 丙\n');
    emptyListItemWithText(kernel, '甲');
    expect(isSandwichedEmptyListItem(kernel.editor.state)).toBe(false);
  });

  it('非空列表项返回 false', () => {
    const kernel = makeEditor('- 甲\n- 乙\n- 丙\n');
    // 光标留在 "乙" 的 paragraph 内
    const pos = findTextPos(kernel.editor.state.doc, '乙');
    const { state, view } = kernel.editor;
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    expect(isSandwichedEmptyListItem(kernel.editor.state)).toBe(false);
  });
});

describe('DEV-069 · Backspace 删除行为', () => {
  it('3 行无序列表删中间行：不产生空白换行，剩 2 行', () => {
    const kernel = makeEditor('- 甲\n- 乙\n- 丙\n');
    emptyListItemWithText(kernel, '乙');
    pressBackspace(kernel);

    const markdown = kernel.getMarkdown();
    const nonEmpty = markdown.split('\n').filter((l) => l.trim().length > 0);
    expect(nonEmpty).toEqual(['- 甲', '- 丙']);
    expect(markdown).not.toMatch(/\n{2,}/);
  });

  it('5 行有序列表删第 3 行：编号保持连续（剩余 4 项 1..4）', () => {
    const kernel = makeEditor('1. 一\n2. 二\n3. 三\n4. 四\n5. 五\n');
    emptyListItemWithText(kernel, '三');
    pressBackspace(kernel);

    const markdown = kernel.getMarkdown();
    const lines = markdown.split('\n').filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^1\.\s*一/);
    expect(lines[1]).toMatch(/^2\.\s*二/);
    expect(lines[2]).toMatch(/^3\.\s*四/);
    expect(lines[3]).toMatch(/^4\.\s*五/);
    expect(lines.join('\n')).not.toContain('三');
  });

  it('OrderedList keepAttributes：起始编号被解析为 start 属性', () => {
    const kernel = makeEditor('3. 一\n4. 二\n');
    // 找到有序列表节点（可能嵌在列表项中或作为顶级 block）
    const doc = kernel.editor.state.doc;
    let orderedList: { type: { name: string }; attrs?: { start?: number } } | null = null;
    doc.descendants((node) => {
      if (!orderedList && node.type.name === 'orderedList') orderedList = node;
      return true;
    });
    expect(orderedList).not.toBeNull();
    expect(orderedList!.attrs?.start).toBe(3);
  });

  it('ListDev069 扩展名稳定且不污染 StarterKit 默认配置', () => {
    expect(ListDev069.name).toBe('nexnoteListDev069');
  });
});

describe('DEV-069 · 与 buildKernelExtensions 集成', () => {
  it('extensions 中包含 ListDev069', () => {
    const exts = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const names = exts.map((e: { name: string }) => e.name);
    expect(names).toContain('nexnoteListDev069');
  });
});
