// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createEditor } from '../src/editor';
import type { EditorKernelInstance } from '../src/editor';
import type { SuggestionItem } from '../src/extensions/suggestion-menu';

function typeText(view: Parameters<never>[0] | never, text: string): void {
  // 逐字符驱动 handleTextInput（与真实输入同路径），未处理则默认插入。
  for (const ch of text) {
    const from = view.state.selection.from;
    let handled = false;
    view.someProp(
      'handleTextInput',
      (f: (v: typeof view, a: number, b: number, t: string) => boolean) => {
        handled = f(view, from, from, ch) === true;
        return false;
      },
    );
    if (!handled) {
      view.dispatch(view.state.tr.insertText(ch, from, from));
    }
  }
}

function pressKey(view: never, key: string): boolean {
  let result = false;
  view.someProp(
    'handleKeyDown',
    (f: (v: typeof view, e: KeyboardEvent) => boolean) => {
      result = f(view, new KeyboardEvent('keydown', { key, bubbles: true }));
      return false;
    },
  );
  return result;
}

/** 把光标放到文档末尾（新编辑器默认选区在 doc 根 depth 0，直接插字落不进段落）。 */
function placeCursorAtEnd(kernel: EditorKernelInstance): void {
  const view = kernel.editor.view;
  const pos = view.state.doc.content.size;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))),
  );
}

function make() {
  const container = document.createElement('div');
  document.body.append(container);
  const pages = [
    { id: '项目计划', title: '项目计划', hint: '项目/项目计划.md' },
    { id: '会议纪要', title: '会议纪要', hint: '项目/会议纪要.md' },
    { id: '项目总结', title: '计划', hint: '项目/项目总结.md' }, // 别名=「计划」，验证 [[项目总结|计划]]
    { id: '其他页面', title: '其他页面', hint: '其他页面.md', meta: 'uncreated' as const },
  ];
  const tags = [
    { id: '项目/进行中', title: '项目/进行中', hint: '嵌套' },
    { id: '项目/已完成', title: '项目/已完成', hint: '嵌套' },
    { id: 'inbox', title: 'inbox' },
  ];
  const kernel = createEditor(container, {
    initialMarkdown: '占位\n',
    slashMenu: false,
    dragHandle: false,
    wikilinkSuggestions: (q) =>
      pages
        .filter((p) => p.title.includes(q) || p.id.includes(q))
        .map((p) => ({ id: p.id, title: p.title, hint: p.hint, ...(p.meta ? { meta: p.meta } : {}) })),
    hashtagSuggestions: (q) => tags.filter((t) => t.title.includes(q)).map((t) => ({ ...t })),
  });
  placeCursorAtEnd(kernel);
  return { container, kernel };
}

/** 自定义 wikilink 候选（含 insert 载荷）的编辑器。 */
function make2(wikilinkItems: SuggestionItem[]) {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, {
    initialMarkdown: '占位\n',
    slashMenu: false,
    dragHandle: false,
    wikilinkSuggestions: () => wikilinkItems,
  });
  placeCursorAtEnd(kernel);
  return { container, kernel };
}

describe('wikilink 补全（DEV-017）', () => {
  it('输入 [[ 弹出候选，Enter 插入 wikilink 节点', () => {
    const { kernel, container } = make();
    typeText(kernel.editor.view as never, '[[');
    const menu = container.parentElement?.querySelector('.nexnote-suggestion--wikilink') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.display).not.toBe('none');
    const rows = () => [...menu.querySelectorAll('[data-suggestion-item]')];
    expect(rows().length).toBe(4);
    // 红链标记 uncreated
    expect(rows()[3]?.getAttribute('data-uncreated')).toBe('true');

    // 输入「项目」过滤（title 或 id 命中）
    typeText(kernel.editor.view as never, '项目');
    expect(rows().length).toBe(2); // 项目计划 / 项目总结

    // Enter 选第一项
    pressKey(kernel.editor.view as never, 'Enter');
    const links = kernel
      .getJSON()
      .content!.flatMap((n) => n.content ?? [])
      .filter((n) => n.type === 'wikilink');
    expect(links.length).toBe(1);
    expect(links[0]?.attrs?.target).toBe('项目计划');
    // 磁盘往返为 [[项目计划]]
    expect(kernel.getMarkdown()).toContain('[[项目计划]]');
    kernel.destroy();
    container.remove();
  });

  it('选中带别名的候选 → [[target|alias]] 往返', () => {
    const { kernel, container } = make();
    typeText(kernel.editor.view as never, '[[');
    // 输入「总结」只命中 项目总结（其显示标题是别名「计划」）
    typeText(kernel.editor.view as never, '总结');
    const menu = container.parentElement?.querySelector('.nexnote-suggestion--wikilink') as HTMLElement;
    const rows = [...menu.querySelectorAll<HTMLElement>('[data-suggestion-item]')];
    expect(rows.length).toBe(1);
    expect(rows[0]?.dataset.suggestionItem).toBe('项目总结');
    pressKey(kernel.editor.view as never, 'Enter');
    expect(kernel.getMarkdown()).toContain('[[项目总结|计划]]');
    kernel.destroy();
    container.remove();
  });

  it('Esc 关闭补全，不插入节点', () => {
    const { kernel, container } = make();
    typeText(kernel.editor.view as never, '[[');
    expect((container.parentElement?.querySelector('.nexnote-suggestion--wikilink') as HTMLElement).style.display).not.toBe('none');
    pressKey(kernel.editor.view as never, 'Escape');
    const menu = container.parentElement?.querySelector('.nexnote-suggestion--wikilink') as HTMLElement;
    expect(menu.style.display).toBe('none');
    kernel.destroy();
    container.remove();
  });

  it('insert 载荷：带别名选择插入 [[target|alias]]，带锚点插入 [[target#heading]]', () => {
    const { kernel, container } = make2([
      { id: '项目计划', title: '项目计划', insert: { target: '项目计划', alias: '别名' } },
      { id: '锚点页', title: '锚点页', insert: { target: '锚点页#章节一' } },
    ]);
    typeText(kernel.editor.view as never, '[[');
    pressKey(kernel.editor.view as never, 'Enter'); // 第一项：别名
    expect(kernel.getMarkdown()).toContain('[[项目计划|别名]]');
    // 第二次：锚点（候选不过滤，↓ 选中第二项）
    placeCursorAtEnd(kernel);
    typeText(kernel.editor.view as never, '[[');
    pressKey(kernel.editor.view as never, 'ArrowDown');
    pressKey(kernel.editor.view as never, 'Enter');
    expect(kernel.getMarkdown()).toContain('[[锚点页#章节一]]');
    kernel.destroy();
    container.remove();
  });

  it('插入是单事务：一次 undo 还原触发串文本', async () => {
    const { kernel, container } = make();
    typeText(kernel.editor.view as never, '[[');
    typeText(kernel.editor.view as never, '项目');
    // 越过 undo 分组窗口（newGroupDelay 400ms），让选择动作成为独立撤销组
    await new Promise((r) => setTimeout(r, 450));
    pressKey(kernel.editor.view as never, 'Enter');
    expect(kernel.getMarkdown()).toContain('[[项目计划]]');
    kernel.undo();
    const json = kernel.getJSON();
    const links = json.content!.flatMap((n) => n.content ?? []).filter((n) => n.type === 'wikilink');
    expect(links.length).toBe(0); // wikilink 节点被撤销
    // 触发串与查询词随单事务一并还原（序列化时 [[ 会被转义，故断言 JSON 文本）
    const text = json.content!.map((n) => (n.content ?? []).map((c) => c.text ?? '').join('')).join('\n');
    expect(text).toContain('[[项目');
    kernel.destroy();
    container.remove();
  });

  it('onPick 回调在红链项插入后触发（渲染层借此建页）', () => {
    const picked: string[] = [];
    const container = document.createElement('div');
    document.body.append(container);
    const kernel = createEditor(container, {
      initialMarkdown: '占位\n',
      slashMenu: false,
      dragHandle: false,
      wikilinkSuggestions: () => [
        { id: '新页面', title: '新页面', hint: '创建新页面', meta: 'uncreated' },
      ],
      onWikilinkSuggestionPick: (item) => picked.push(item.id),
    });
    placeCursorAtEnd(kernel);
    typeText(kernel.editor.view as never, '[[');
    pressKey(kernel.editor.view as never, 'Enter');
    expect(picked).toEqual(['新页面']);
    expect(kernel.getMarkdown()).toContain('[[新页面]]');
    kernel.destroy();
    container.remove();
  });
});

describe('hashtag 补全（DEV-017）', () => {
  it('空白后输入 # 弹出标签候选，Enter 插入 hashtag 节点', () => {
    const { kernel, container } = make();
    typeText(kernel.editor.view as never, '笔记 ');
    typeText(kernel.editor.view as never, '#');
    const menu = container.parentElement?.querySelector('.nexnote-suggestion--hashtag') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.display).not.toBe('none');
    typeText(kernel.editor.view as never, '项目');
    const rows = () => [...menu.querySelectorAll('[data-suggestion-item]')];
    expect(rows().length).toBe(2); // 项目/进行中 / 项目/已完成
    pressKey(kernel.editor.view as never, 'Enter');
    const tags = kernel
      .getJSON()
      .content!.flatMap((n) => n.content ?? [])
      .filter((n) => n.type === 'hashtag');
    expect(tags.length).toBe(1);
    expect(tags[0]?.attrs?.tag).toBe('项目/进行中');
    expect(kernel.getMarkdown()).toContain('#项目/进行中');
    kernel.destroy();
    container.remove();
  });

  it('mid-word 的 # 不触发（避免数字/锚点误触）', () => {
    const { kernel, container } = make();
    typeText(kernel.editor.view as never, 'C#');
    const menu = container.parentElement?.querySelector('.nexnote-suggestion--hashtag') as HTMLElement;
    expect(menu.style.display).toBe('none');
    kernel.destroy();
    container.remove();
  });
});
