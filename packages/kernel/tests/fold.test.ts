// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createEditor } from '../src/editor';
import {
  clampMouseSelection,
  expandAllBlockFolds,
  revealBlockFoldAt,
} from '../src/extensions/fold';

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

function topBlocks(kernel: ReturnType<typeof make>['kernel']) {
  const blocks: Array<{
    from: number;
    to: number;
    blockId: string;
    text: string;
    level: number | null;
  }> = [];
  kernel.editor.state.doc.forEach((node, from) => {
    const blockId = (node.attrs as { blockId?: string }).blockId;
    if (!blockId) return;
    blocks.push({
      from,
      to: from + node.nodeSize,
      blockId,
      text: node.textContent,
      level: node.type.name === 'heading' ? Number(node.attrs.level) : null,
    });
  });
  return blocks;
}

function hiddenTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.nexnote-fold-hidden')].map((element) => {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const toggle of clone.querySelectorAll('.nexnote-fold-toggle')) toggle.remove();
    return clone.textContent ?? '';
  });
}

function toggleFor(container: HTMLElement, blockId: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    `.nexnote-fold-toggle[data-fold-id="${blockId}"]`,
  );
}

function keydown(
  kernel: ReturnType<typeof make>['kernel'],
  key: string,
  init: KeyboardEventInit = {},
): boolean {
  const view = kernel.editor.view;
  let handled = false;
  view.someProp('handleKeyDown', (handler) => {
    handled ||= handler(view, new KeyboardEvent('keydown', { key, cancelable: true, ...init }));
  });
  return handled;
}

function clamp(view: ReturnType<typeof make>['kernel']['editor']['view']): boolean {
  const before = view.state.selection.toJSON();
  clampMouseSelection(view);
  return JSON.stringify(view.state.selection.toJSON()) !== JSON.stringify(before);
}

function replaceBlockType(
  kernel: ReturnType<typeof make>['kernel'],
  blockId: string,
  kind: string,
): boolean {
  const block = topBlocks(kernel).find((candidate) => candidate.blockId === blockId);
  return block ? kernel.convertBlock(kind, block.from, block.to) : false;
}

const kernels: Array<ReturnType<typeof make>> = [];
function trackedMake(markdown: string) {
  const result = make(markdown);
  kernels.push(result);
  return result;
}

afterEach(() => {
  for (const { kernel, container } of kernels.splice(0)) {
    kernel.destroy();
    container.remove();
  }
  vi.restoreAllMocks();
});

describe('DEV-054 块文档标题章节折叠', () => {
  it('H1-H6 有章节内容时始终显示可发现、键盘可达且 accessible name 准确的 chevron', async () => {
    const markdown = [1, 2, 3, 4, 5, 6]
      .map((level) => `${'#'.repeat(level)} H${level} ^h${level}\n\n正文 ${level} ^p${level}`)
      .join('\n\n');
    const { container, kernel } = trackedMake(`${markdown}\n`);

    const headings = topBlocks(kernel).filter((block) => block.level != null);
    expect(headings.map((block) => block.level)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const heading of headings) {
      expect(kernel.canFoldBlock(heading.blockId)).toBe(true);
      const button = toggleFor(container, heading.blockId);
      expect(button?.tabIndex).toBe(0);
      expect(button?.getAttribute('aria-label')).toBe('折叠章节');
      expect(button?.getAttribute('aria-expanded')).toBe('true');
      expect(button?.getAttribute('data-fold-state')).toBe('expanded');
      expect(button?.querySelector('.nexnote-fold-toggle__icon')?.textContent).toBe('›');
    }

    const first = headings[0]!;
    const selectionBefore = kernel.editor.state.selection.toJSON();
    const markdownBefore = kernel.getMarkdown();
    const button = toggleFor(container, first.blockId)!;
    button.focus();
    expect(document.activeElement).toBe(button);
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(kernel.isBlockFolded(first.blockId)).toBe(true);
    expect(kernel.editor.state.selection.toJSON()).toEqual(selectionBefore);
    expect(kernel.getMarkdown()).toBe(markdownBefore);
    const collapsed = toggleFor(container, first.blockId);
    await vi.waitFor(() => expect(document.activeElement).toBe(collapsed));
    expect(document.activeElement).not.toBe(document.body);
    expect(collapsed?.matches(':focus')).toBe(true);
    expect(collapsed?.getAttribute('aria-label')).toBe('展开章节');
    expect(collapsed?.getAttribute('aria-expanded')).toBe('false');
    expect(collapsed?.getAttribute('data-fold-state')).toBe('collapsed');
    expect(collapsed?.textContent).toBe('›');

    // widget 重建后连续用 Space 操作，焦点仍承接到再次重建的新按钮。
    collapsed?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(kernel.isBlockFolded(first.blockId)).toBe(false);
    const expandedAgain = toggleFor(container, first.blockId);
    await vi.waitFor(() => expect(document.activeElement).toBe(expandedAgain));
    expect(expandedAgain).not.toBe(collapsed);
    expect(expandedAgain?.getAttribute('aria-expanded')).toBe('true');
    expect(kernel.editor.state.selection.toJSON()).toEqual(selectionBefore);
  });

  it('chevron 点击正常不移动光标；若光标将被隐藏则安全移回标题是必要例外', () => {
    const { container, kernel } = trackedMake(
      '# A ^a\n\n隐藏正文 ^hidden\n\n# B ^b\n\n可见尾部 ^tail\n',
    );
    const heading = topBlocks(kernel).find((block) => block.blockId === 'a')!;
    const hidden = topBlocks(kernel).find((block) => block.blockId === 'hidden')!;
    const tail = topBlocks(kernel).find((block) => block.blockId === 'tail')!;

    // 正常点击：当前光标在折叠区之外，mousedown/click 均不抢正文 selection。
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, tail.from + 1),
      ),
    );
    const stableSelection = kernel.editor.state.selection.toJSON();
    let button = toggleFor(container, 'a')!;
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(kernel.isBlockFolded('a')).toBe(true);
    expect(kernel.editor.state.selection.toJSON()).toEqual(stableSelection);

    // 展开后把光标放进即将隐藏的正文；再次点击折叠必须移回标题行，避免悬空光标。
    toggleFor(container, 'a')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
    );
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, hidden.from + 1),
      ),
    );
    button = toggleFor(container, 'a')!;
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(kernel.isBlockFolded('a')).toBe(true);
    expect(kernel.editor.state.selection.$from.parent.type.name).toBe('heading');
    expect(kernel.editor.state.selection.$from.parent.textContent).toBe('A');
    expect(kernel.editor.state.selection.head).toBe(heading.to - 1);
  });

  it('无章节内容的标题（含文档末尾标题）不提供 chevron，块菜单能力亦禁用', () => {
    const { container, kernel } = trackedMake('# 空章节 ^empty\n\n# 末尾 ^last\n');
    expect(kernel.canFoldBlock('empty')).toBe(false);
    expect(kernel.canFoldBlock('last')).toBe(false);
    expect(kernel.toggleBlockFold('empty')).toBe(false);
    expect(container.querySelectorAll('.nexnote-fold-toggle')).toHaveLength(0);
  });

  it('同级/高层级边界正确，低级标题与其内容属于父标题章节', () => {
    const { container, kernel } = trackedMake(
      '# A ^a\n\nA正文 ^ap\n\n## A.1 ^a1\n\nA.1正文 ^a1p\n\n### A.1.1 ^a11\n\n深层正文 ^deep\n\n## A.2 ^a2\n\nA.2正文 ^a2p\n\n# B ^b\n\nB正文 ^bp\n',
    );

    expect(kernel.toggleBlockFold('a1')).toBe(true);
    expect(hiddenTexts(container)).toEqual(['A.1正文', 'A.1.1', '深层正文']);
    expect(kernel.toggleBlockFold('a1')).toBe(true);

    expect(kernel.toggleBlockFold('a')).toBe(true);
    expect(hiddenTexts(container)).toEqual([
      'A正文',
      'A.1',
      'A.1正文',
      'A.1.1',
      '深层正文',
      'A.2',
      'A.2正文',
    ]);
    expect(hiddenTexts(container)).not.toContain('B');
  });

  it('父子章节状态独立：展开父章节后先前折叠的子章节仍折叠', () => {
    const { container, kernel } = trackedMake(
      '# 父 ^parent\n\n## 子 ^child\n\n子正文 ^childp\n\n# 后续 ^after\n\n末尾 ^tail\n',
    );
    kernel.toggleBlockFold('child');
    kernel.toggleBlockFold('parent');
    expect(kernel.isBlockFolded('child')).toBe(true);
    expect(kernel.isBlockFolded('parent')).toBe(true);

    kernel.toggleBlockFold('parent');
    expect(kernel.isBlockFolded('parent')).toBe(false);
    expect(kernel.isBlockFolded('child')).toBe(true);
    expect(hiddenTexts(container)).toEqual(['子正文']);
  });

  it('空标题、同名标题与改名标题按 blockId 独立保持折叠身份', () => {
    const { container, kernel } = trackedMake(
      '# 临时 ^empty\n\n空标题正文 ^ep\n\n# 同名 ^same1\n\n第一正文 ^p1\n\n# 同名 ^same2\n\n第二正文 ^p2\n\n# 后续 ^after\n\n尾部 ^tail\n',
    );
    const empty = topBlocks(kernel).find((block) => block.blockId === 'empty')!;
    kernel.editor.view.dispatch(kernel.editor.state.tr.delete(empty.from + 1, empty.to - 1));
    expect(topBlocks(kernel).find((block) => block.blockId === 'empty')?.text).toBe('');
    expect(kernel.toggleBlockFold('empty')).toBe(true);
    expect(kernel.toggleBlockFold('same2')).toBe(true);
    expect(kernel.isBlockFolded('same1')).toBe(false);
    expect(hiddenTexts(container)).toEqual(['空标题正文', '第二正文']);

    const same2 = topBlocks(kernel).find((block) => block.blockId === 'same2')!;
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.insertText('改名', same2.from + 1, same2.to - 1),
    );
    expect(kernel.isBlockFolded('same2')).toBe(true);
    expect(hiddenTexts(container)).toContain('第二正文');
  });

  it('删除或转为非标题立即丢弃状态，Undo 恢复标题后默认展开', () => {
    const deleted = trackedMake('# 标题 ^h\n\n正文 ^p\n\n# 后续 ^next\n\n尾部 ^tail\n');
    deleted.kernel.toggleBlockFold('h');
    expect(deleted.kernel.deleteBlockById('h')).toBe(true);
    expect(deleted.kernel.isBlockFolded('h')).toBe(false);
    deleted.kernel.undo();
    expect(deleted.kernel.canFoldBlock('h')).toBe(true);
    expect(deleted.kernel.isBlockFolded('h')).toBe(false);

    const converted = trackedMake('# 标题 ^h\n\n正文 ^p\n\n# 后续 ^next\n\n尾部 ^tail\n');
    converted.kernel.toggleBlockFold('h');
    expect(replaceBlockType(converted.kernel, 'h', 'paragraph')).toBe(true);
    expect(converted.kernel.isBlockFolded('h')).toBe(false);
    converted.kernel.undo();
    expect(converted.kernel.canFoldBlock('h')).toBe(true);
    expect(converted.kernel.isBlockFolded('h')).toBe(false);
  });

  it('可靠 blockId 升降级保留状态并按新层级重算边界', () => {
    const { container, kernel } = trackedMake(
      '## A ^a\n\nA正文 ^ap\n\n## B ^b\n\nB正文 ^bp\n\n# C ^c\n\nC正文 ^cp\n',
    );
    kernel.toggleBlockFold('a');
    expect(hiddenTexts(container)).toEqual(['A正文']);

    expect(replaceBlockType(kernel, 'a', 'h1')).toBe(true);
    expect(kernel.isBlockFolded('a')).toBe(true);
    expect(hiddenTexts(container)).toEqual(['A正文', 'B', 'B正文']);

    expect(replaceBlockType(kernel, 'a', 'h6')).toBe(true);
    expect(kernel.isBlockFolded('a')).toBe(true);
    expect(hiddenTexts(container)).toEqual(['A正文']);
  });

  it('重复 blockId 等无法可靠映射的文档变化安全展开，不折叠错误章节', () => {
    const { container, kernel } = trackedMake('# A ^a\n\nA正文 ^ap\n\n# B ^b\n\nB正文 ^bp\n');
    kernel.toggleBlockFold('a');
    const b = topBlocks(kernel).find((block) => block.blockId === 'b')!;
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setNodeMarkup(b.from, undefined, {
        ...kernel.editor.state.doc.nodeAt(b.from)!.attrs,
        blockId: 'a',
      }),
    );
    expect(kernel.isBlockFolded('a')).toBe(false);
    expect(hiddenTexts(container)).toEqual([]);
  });

  it('折叠前移回隐藏区选区；方向键跳过隐藏区；Mod+A 仍覆盖完整文档', () => {
    const { kernel } = trackedMake('# A ^a\n\n第一段 ^p1\n\n第二段 ^p2\n\n# B ^b\n\n尾部 ^tail\n');
    const first = topBlocks(kernel).find((block) => block.blockId === 'p1')!;
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, first.from + 1),
      ),
    );
    kernel.toggleBlockFold('a');
    expect(kernel.editor.state.selection.$from.parent.type.name).toBe('heading');

    expect(keydown(kernel, 'ArrowDown')).toBe(true);
    expect(kernel.editor.state.selection.$from.parent.textContent).toBe('B');

    kernel.editor.commands.selectAll();
    expect(kernel.editor.state.selection.from).toBe(0);
    expect(kernel.editor.state.selection.to).toBe(kernel.editor.state.doc.content.size);
  });

  it('方向键向上回到折叠标题行尾；鼠标拖选跨越隐藏区时在首个隐藏边界截断', () => {
    const { kernel } = trackedMake('# A ^a\n\n第一段 ^p1\n\n第二段 ^p2\n\n# B ^b\n\n尾部 ^tail\n');
    const heading = topBlocks(kernel).find((block) => block.blockId === 'a')!;
    const first = topBlocks(kernel).find((block) => block.blockId === 'p1')!;
    const second = topBlocks(kernel).find((block) => block.blockId === 'p2')!;
    const next = topBlocks(kernel).find((block) => block.blockId === 'b')!;
    kernel.toggleBlockFold('a');

    // 向上：从 B 标题行首跳回折叠标题 A 行尾（不进入隐藏正文）。
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, next.from + 1),
      ),
    );
    expect(keydown(kernel, 'ArrowUp')).toBe(true);
    expect(kernel.editor.state.selection.$from.parent.textContent).toBe('A');

    // 向下拖选（标题 A → B）：可见侧无正文，截断为标题行内的空选区，不选中隐藏正文。
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(
          kernel.editor.state.doc,
          heading.to - 1,
          Math.min(next.from + 1, kernel.editor.state.doc.content.size),
        ),
      ),
    );
    expect(clamp(kernel.editor.view)).toBe(true);
    expect(kernel.editor.state.selection.empty).toBe(true);
    expect(kernel.editor.state.selection.anchor).toBe(heading.to - 1);
    expect(kernel.editor.state.selection.to).toBeLessThan(first.from);

    // 向上拖选（B → 标题 A）：截断到 B 标题内空选区。
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, next.from + 1, heading.to - 1),
      ),
    );
    expect(clamp(kernel.editor.view)).toBe(true);
    expect(kernel.editor.state.selection.empty).toBe(true);
    expect(kernel.editor.state.selection.anchor).toBe(next.from + 1);
    expect(kernel.editor.state.selection.from).toBeGreaterThan(second.to);

    // 可见区内部选区不被改动。
    const tail = topBlocks(kernel).find((block) => block.blockId === 'tail')!;
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, tail.from + 1, tail.to - 1),
      ),
    );
    expect(clamp(kernel.editor.view)).toBe(false);
    expect(kernel.editor.state.selection.from).toBe(tail.from + 1);
    expect(kernel.editor.state.selection.to).toBe(tail.to - 1);
    expect(kernel.getMarkdown()).toContain('第二段');
  });

  it('Shift+Arrow 在折叠边界被消费，选区和复制文本均不进入隐藏正文', () => {
    const { kernel } = trackedMake(
      '# A ^a\n\n隐藏一 ^p1\n\n隐藏二 ^p2\n\n# B ^b\n\n可见尾部 ^tail\n',
    );
    const heading = topBlocks(kernel).find((block) => block.blockId === 'a')!;
    const next = topBlocks(kernel).find((block) => block.blockId === 'b')!;
    kernel.toggleBlockFold('a');

    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, heading.to - 1),
      ),
    );
    const beforeDown = kernel.editor.state.selection.toJSON();
    expect(keydown(kernel, 'ArrowDown', { shiftKey: true })).toBe(true);
    expect(kernel.editor.state.selection.toJSON()).toEqual(beforeDown);
    expect(
      kernel.editor.state.doc.textBetween(
        kernel.editor.state.selection.from,
        kernel.editor.state.selection.to,
        '\n',
      ),
    ).not.toContain('隐藏');

    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, next.from + 1),
      ),
    );
    const beforeUp = kernel.editor.state.selection.toJSON();
    expect(keydown(kernel, 'ArrowUp', { shiftKey: true })).toBe(true);
    expect(kernel.editor.state.selection.toJSON()).toEqual(beforeUp);
    expect(
      kernel.editor.state.doc.textBetween(
        kernel.editor.state.selection.from,
        kernel.editor.state.selection.to,
        '\n',
      ),
    ).not.toContain('隐藏');
  });

  it('嵌套折叠反向拖选使用外层首个边界，并保留折叠区之后的可见正文选择', () => {
    const { kernel } = trackedMake(
      '# 父 ^parent\n\n## 子 ^child\n\n子正文 ^childBody\n\n父尾 ^parentTail\n\n# 后续 ^after\n\n可见正文 ^visible\n',
    );
    const parent = topBlocks(kernel).find((block) => block.blockId === 'parent')!;
    const child = topBlocks(kernel).find((block) => block.blockId === 'child')!;
    const after = topBlocks(kernel).find((block) => block.blockId === 'after')!;
    const visible = topBlocks(kernel).find((block) => block.blockId === 'visible')!;
    kernel.toggleBlockFold('child');
    kernel.toggleBlockFold('parent');

    // anchor 在折叠区之后的可见正文，反向 head 越过父/子嵌套折叠区。
    const anchor = visible.from + 1;
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, anchor, parent.to - 1),
      ),
    );
    clampMouseSelection(kernel.editor.view);

    expect(kernel.editor.state.selection.empty).toBe(false);
    expect(kernel.editor.state.selection.anchor).toBe(anchor);
    expect(kernel.editor.state.selection.$head.parent.textContent).toBe('后续');
    expect(kernel.editor.state.selection.head).toBe(after.from + 1);
    expect(kernel.editor.state.selection.head).toBeGreaterThan(child.to);
    const selected = kernel.editor.state.doc.textBetween(
      kernel.editor.state.selection.from,
      kernel.editor.state.selection.to,
      '\n',
    );
    expect(selected.trimEnd()).toBe('后续');
    expect(selected).not.toContain('子正文');
    expect(selected).not.toContain('父尾');
  });

  it('正向拖选保留折叠区之前的可见正文尾部，不吞入隐藏段', () => {
    const { kernel } = trackedMake(
      '# 顶部 ^top\n\n前言段 ^intro\n\n# A ^a\n\n隐藏段 ^hidden\n\n# B ^b\n',
    );
    const intro = topBlocks(kernel).find((block) => block.blockId === 'intro')!;
    const next = topBlocks(kernel).find((block) => block.blockId === 'b')!;
    kernel.toggleBlockFold('a');

    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, intro.from + 1, next.from + 1),
      ),
    );
    clampMouseSelection(kernel.editor.view);
    const { selection } = kernel.editor.state;
    expect(selection.empty).toBe(false);
    expect(selection.from).toBe(intro.from + 1);
    expect(selection.to).toBeLessThanOrEqual(
      topBlocks(kernel).find((block) => block.blockId === 'hidden')!.from,
    );
    const selected = kernel.editor.state.doc.textBetween(selection.from, selection.to, '\n');
    expect(selected).toContain('前言段');
    expect(selected).toContain('A');
    expect(selected).not.toContain('隐藏段');
  });

  it('目录/查找只展开多层必要祖先，目标自身与无关分支保持，重复定位稳定且零正文写入', () => {
    const { container, kernel } = trackedMake(
      '# 父 ^parent\n\n## 中层 ^middle\n\n### 目标 ^target\n\n隐藏命中 ^body\n\n# 无关 ^other\n\n无关正文 ^otherBody\n\n# 后续 ^after\n\n尾部 ^tail\n',
    );
    for (const id of ['target', 'middle', 'parent', 'other']) kernel.toggleBlockFold(id);
    const target = topBlocks(kernel).find((block) => block.blockId === 'target')!;
    const hiddenMatch = topBlocks(kernel).find((block) => block.blockId === 'body')!;
    const before = kernel.getMarkdown();
    const beforeRevision = kernel.getRevision();

    revealBlockFoldAt(kernel.editor.view, target.from + 1);
    expect(kernel.isBlockFolded('parent')).toBe(false);
    expect(kernel.isBlockFolded('middle')).toBe(false);
    expect(kernel.isBlockFolded('target')).toBe(true);
    expect(kernel.isBlockFolded('other')).toBe(true);
    revealBlockFoldAt(kernel.editor.view, target.from + 1);
    expect(kernel.isBlockFolded('target')).toBe(true);
    expect(kernel.isBlockFolded('other')).toBe(true);

    // 查找命中的目标正文还被目标标题本身遮蔽，只需再展开这一层。
    revealBlockFoldAt(kernel.editor.view, hiddenMatch.from + 1);
    expect(kernel.isBlockFolded('target')).toBe(false);
    expect(kernel.isBlockFolded('other')).toBe(true);
    expect(hiddenTexts(container)).toEqual(['无关正文']);
    expect(kernel.getMarkdown()).toBe(before);
    expect(kernel.getRevision()).toBe(beforeRevision);
    expect(kernel.hasPendingSave()).toBe(false);
  });

  it('普通 selectionSet 和插件选择变化不显式 reveal 隐藏章节', () => {
    const { kernel } = trackedMake(
      '# parent ^parent\n\n## child ^child\n\nhidden body ^body\n\n# other ^other\n\nother body ^otherBody\n',
    );
    kernel.toggleBlockFold('parent');
    kernel.toggleBlockFold('child');
    kernel.toggleBlockFold('other');
    const hidden = topBlocks(kernel).find((block) => block.blockId === 'body')!;
    const before = kernel.getMarkdown();

    // API/plugin selection movements are not user requests to reveal hidden content.
    kernel.editor.view.dispatch(
      kernel.editor.state.tr.setSelection(
        TextSelection.create(kernel.editor.state.doc, hidden.from + 1),
      ),
    );
    kernel.editor.view.dispatch(kernel.editor.state.tr.setMeta('plugin-selection', true));
    expect(kernel.isBlockFolded('parent')).toBe(true);
    expect(kernel.isBlockFolded('child')).toBe(true);
    expect(kernel.isBlockFolded('other')).toBe(true);

    // Only the explicit outline/find action may reveal the necessary ancestors.
    revealBlockFoldAt(kernel.editor.view, hidden.from + 1);
    expect(kernel.isBlockFolded('parent')).toBe(false);
    expect(kernel.isBlockFolded('child')).toBe(false);
    expect(kernel.isBlockFolded('other')).toBe(true);
    expect(kernel.getMarkdown()).toBe(before);
  });

  it('全部展开只清空当前块编辑视图折叠状态且不写正文', () => {
    const current = trackedMake('# A ^a\n\nA正文 ^ap\n\n# B ^b\n\nB正文 ^bp\n');
    const background = trackedMake('# C ^c\n\nC正文 ^cp\n');
    current.kernel.toggleBlockFold('a');
    current.kernel.toggleBlockFold('b');
    background.kernel.toggleBlockFold('c');
    const before = current.kernel.getMarkdown();

    expect(expandAllBlockFolds(current.kernel.editor.view)).toBe(2);
    expect(current.kernel.isBlockFolded('a')).toBe(false);
    expect(current.kernel.isBlockFolded('b')).toBe(false);
    expect(background.kernel.isBlockFolded('c')).toBe(true);
    expect(current.kernel.getMarkdown()).toBe(before);
    expect(current.kernel.hasPendingSave()).toBe(false);
    expect(expandAllBlockFolds(current.kernel.editor.view)).toBe(0);
  });

  it('折叠、展开、保存与全文读取不改变 Markdown/JSON/revision，重载页面全部展开', async () => {
    const saved: string[] = [];
    const docChanges: unknown[] = [];
    const container = document.createElement('div');
    document.body.append(container);
    const markdown = '# A ^a\n\n正文 ^p\n\n# B ^b\n\n尾部 ^tail\n';
    const kernel = createEditor(container, {
      initialMarkdown: markdown,
      slashMenu: false,
      dragHandle: false,
      saveDelayMs: 0,
      onContentChange: (value) => saved.push(value),
      onDocChange: (json) => docChanges.push(json),
    });
    kernels.push({ container, kernel });
    const beforeMarkdown = kernel.getMarkdown();
    const beforeBytes = new TextEncoder().encode(beforeMarkdown);
    const beforeJson = kernel.getJSON();
    const beforeBlockIds = topBlocks(kernel).map((block) => block.blockId);
    const beforeRevision = kernel.getRevision();

    kernel.toggleBlockFold('a');
    expect(kernel.getMarkdown()).toBe(beforeMarkdown);
    expect(new TextEncoder().encode(kernel.getMarkdown())).toEqual(beforeBytes);
    expect(kernel.getJSON()).toEqual(beforeJson);
    expect(topBlocks(kernel).map((block) => block.blockId)).toEqual(beforeBlockIds);
    expect(kernel.getRevision()).toBe(beforeRevision);
    expect(kernel.hasPendingSave()).toBe(false);
    await kernel.flushPendingSave();
    expect(saved).toEqual([]);
    expect(docChanges).toEqual([]);

    kernel.toggleBlockFold('a');
    expect(kernel.getMarkdown()).toBe(beforeMarkdown);
    expect(new TextEncoder().encode(kernel.getMarkdown())).toEqual(beforeBytes);
    expect(kernel.getJSON()).toEqual(beforeJson);
    expect(topBlocks(kernel).map((block) => block.blockId)).toEqual(beforeBlockIds);
    expect(kernel.getRevision()).toBe(beforeRevision);
    expect(kernel.hasPendingSave()).toBe(false);
    await kernel.flushPendingSave();
    expect(saved).toEqual([]);
    expect(docChanges).toEqual([]);

    kernel.setMarkdown(beforeMarkdown);
    expect(kernel.isBlockFolded('a')).toBe(false);
    expect(kernel.getMarkdown()).toBe(beforeMarkdown);
  });
});
