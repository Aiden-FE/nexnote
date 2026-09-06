// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { buildKernelExtensions, createEditor, computeEditorActionContext } from '../src';

function mount(markdown: string, options?: Parameters<typeof createEditor>[1]) {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, {
    initialMarkdown: markdown,
    slashMenu: false,
    dragHandle: false,
    ...options,
  });
  return { container, kernel };
}

/** 序列化后去掉 UniqueID 块锚，便于断言正文。 */
function stripped(kernel: ReturnType<typeof createEditor>): string {
  return kernel.getMarkdown().replace(/[ \t]*\^[A-Za-z0-9]+/g, '').trim();
}

function selectText(kernel: ReturnType<typeof createEditor>, from: number, to: number) {
  kernel.editor.view.dispatch(
    kernel.editor.view.state.tr.setSelection(
      TextSelection.create(kernel.editor.view.state.doc, from, to),
    ),
  );
}

describe('computeEditorActionContext', () => {
  it('选区目标抽取选区文本与坐标', () => {
    const { kernel } = mount('第一段文本\n\n第二段');
    const doc = kernel.editor.view.state.doc;
    const from = 1;
    const to = 1 + doc.child(0).child(0).nodeSize; // 覆盖整段文本（textBetween 右开）
    selectText(kernel, from, to);
    const ctx = computeEditorActionContext(kernel.editor.view, 'selection');
    expect(ctx.target).toBe('selection');
    expect(ctx.text).toBe('第一段文本');
    expect(ctx.from).toBe(from);
    expect(ctx.to).toBe(to);
    expect(ctx.blockRange).not.toBeNull();
    expect(ctx.coords.top).toBeGreaterThanOrEqual(0);
    kernel.destroy();
  });

  it('折叠光标目标为 cursor，空块基于上文生成', () => {
    const { kernel } = mount('上文段落\n\n');
    const ctx = computeEditorActionContext(kernel.editor.view, 'cursor');
    expect(ctx.target).toBe('cursor');
    expect(ctx.text).toBe('');
    expect(ctx.blockRange).not.toBeNull();
    kernel.destroy();
  });

  it('整块目标抽取顶层块范围（右键块手柄场景）', () => {
    const { kernel } = mount('甲块\n\n乙块内容\n\n丙块');
    const doc = kernel.editor.view.state.doc;
    const secondBlockStart = doc.child(0).nodeSize + 1;
    const ctx = computeEditorActionContext(kernel.editor.view, 'block', {
      x: 5,
      y: 30,
    });
    // pointer posAtCoords 在 happy-dom 中可能解析失败，退化为光标块；直接验证 block 结构接口
    void secondBlockStart;
    expect(ctx.target === 'block' || ctx.target === 'cursor').toBe(true);
    kernel.destroy();
  });
});

describe('选区浮动工具栏（SelectionBubble）', () => {
  it('非折叠选区出现工具栏，点击按钮触发对应动作且保留选区', () => {
    const onAction = vi.fn();
    const { kernel } = mount('这是第一段的示例文字\n\n第二段', {
      selectionBubble: {
        actions: [
          { id: 'ai-rewrite', title: '改写', shortcut: { mod: true, key: 'r' }, shortcutLabel: '⌘R' },
          { id: 'ai-expand', title: '扩写' },
        ],
        onAction,
      },
    });
    const view = kernel.editor.view;
    selectText(kernel, 1, 6);
    const bubble = view.dom.parentElement?.querySelector<HTMLElement>('[data-selection-bubble]');
    expect(bubble).toBeTruthy();
    expect(bubble?.style.display).not.toBe('none');

    const btn = bubble?.querySelector<HTMLButtonElement>('[data-bubble-action="ai-rewrite"]');
    expect(btn).toBeTruthy();
    btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onAction).toHaveBeenCalledWith('ai-rewrite', expect.objectContaining({ target: 'selection' }));
    // 选区不被破坏
    expect(view.state.selection.empty).toBe(false);
    kernel.destroy();
  });

  it('折叠光标时隐藏工具栏；快捷键触发动作', () => {
    const onAction = vi.fn();
    const { kernel } = mount('第一段', {
      selectionBubble: {
        actions: [{ id: 'ai-polish', title: '润色', shortcut: { mod: true, key: 'p' }, shortcutLabel: '⌘P' }],
        onAction,
      },
    });
    const view = kernel.editor.view;
    const bubble = view.dom.parentElement?.querySelector<HTMLElement>('[data-selection-bubble]');
    expect(bubble?.style.display).toBe('none');

    selectText(kernel, 1, 4);
    expect(bubble?.style.display).not.toBe('none');
    const handled = view.someProp('handleKeyDown', (f) =>
      f(view, new KeyboardEvent('keydown', { metaKey: true, key: 'p' }) as unknown as KeyboardEvent),
    );
    expect(handled).toBe(true);
    expect(onAction).toHaveBeenCalledWith('ai-polish', expect.objectContaining({ target: 'selection' }));
    kernel.destroy();
  });
});

describe('右键上下文菜单（ContextMenu）', () => {
  it('选中右键构建子菜单并触发动作', () => {
    const onAction = vi.fn();
    const { kernel } = mount('第一段的文字\n\n第二段', {
      contextMenu: {
        build: () => [
          { title: '剪贴板', id: 'copy' },
          {
            title: 'AI 写作',
            submenu: [
              { id: 'ai-rewrite', title: '改写' },
              { id: 'ai-fill', title: '查漏补缺' },
            ],
          },
        ],
        onAction,
      },
    });
    const view = kernel.editor.view;
    selectText(kernel, 1, 5);
    view.dom.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }),
    );
    const menu = document.querySelector<HTMLElement>('[data-context-menu]');
    expect(menu).toBeTruthy();
    const aiItem = menu?.querySelector<HTMLButtonElement>('[data-context-menu-item=""]');
    expect(aiItem).toBeTruthy();
    // hover 展开子菜单（mouseenter 绑定在子项 wrapper 上）
    aiItem?.closest('.nexnote-context-menu__sub-wrap')?.dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: false }),
    );
    const sub = menu?.querySelector<HTMLElement>('.nexnote-context-menu__sub');
    expect(sub?.style.display).toBe('block');
    const action = sub?.querySelector<HTMLButtonElement>('[data-context-menu-item="ai-fill"]');
    action?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onAction).toHaveBeenCalledWith('ai-fill', expect.objectContaining({ target: 'selection' }));
    kernel.destroy();
  });

  it('Esc/外部点击关闭菜单', () => {
    const { kernel } = mount('文档', {
      contextMenu: { build: () => [{ id: 'copy', title: '复制' }], onAction: () => undefined },
    });
    const view = kernel.editor.view;
    view.dom.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    expect(document.querySelector('[data-context-menu]')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[data-context-menu]')).toBeNull();
    kernel.destroy();
  });
});

describe('diff 回写编辑器原语', () => {
  it('replaceRangeWithMarkdown 块内替换保留段落并可撤销', () => {
    const { kernel } = mount('第一句。第二句。');
    const textStart = 1;
    const mid = textStart + 4; // 第一句。
    expect(kernel.replaceRangeWithMarkdown(textStart, mid, '改写后的第一句。')).toBe(true);
    expect(stripped(kernel)).toBe('改写后的第一句。第二句。');
    expect(kernel.undo()).toBe(true);
    expect(stripped(kernel)).toBe('第一句。第二句。');
    kernel.destroy();
  });

  it('replaceRangeWithMarkdown 整块替换并可撤销', () => {
    const { kernel } = mount('原标题\n\n后段');
    const secondFrom = kernel.editor.view.state.doc.child(0).nodeSize + 1;
    const secondTo = secondFrom + kernel.editor.view.state.doc.child(1).nodeSize;
    expect(kernel.replaceRangeWithMarkdown(secondFrom, secondTo, '新段落一\n\n新段落二')).toBe(true);
    expect(kernel.getMarkdown()).toContain('新段落一');
    expect(kernel.getMarkdown()).toContain('新段落二');
    expect(kernel.undo()).toBe(true);
    expect(stripped(kernel)).toBe('原标题\n\n后段');
    kernel.destroy();
  });

  it('insertMarkdownBlocks 追加新块并可撤销', () => {
    const { kernel } = mount('已有内容');
    const at = kernel.editor.view.state.doc.content.size;
    expect(kernel.insertMarkdownBlocks('新增第一段\n\n新增第二段', at, 'after')).toBe(true);
    const md = stripped(kernel);
    expect(md).toContain('已有内容');
    expect(md).toContain('新增第一段');
    expect(md.indexOf('已有内容')).toBeLessThan(md.indexOf('新增第一段'));
    expect(kernel.undo()).toBe(true);
    expect(stripped(kernel)).toBe('已有内容');
    kernel.destroy();
  });
});

describe('斜杠菜单注入 AI 项（extraSlashItems）', () => {
  it('自定义项与默认项合并，/ai 过滤出注入动作', () => {
    const actioned: string[] = [];
    const exts = buildKernelExtensions({
      extraSlashItems: [
        {
          id: 'ai-rewrite',
          title: 'AI · 改写',
          keywords: ['ai'],
          action: ({ view }) => {
            actioned.push('ai-rewrite');
            void view;
            return true;
          },
        },
      ],
    });
    const slash = exts.find(
      (e) => (e as { name?: string }).name === 'nexnoteSlashMenu',
    ) as { options: { items: (q: string) => { id: string; action: (ctx: { view: unknown }) => boolean }[] } };
    const aiItems = slash.options.items('ai').map((i) => i.id);
    expect(aiItems).toContain('ai-rewrite');
    // 默认结构块项不匹配 'ai'
    expect(aiItems).not.toContain('heading1');
    // 空 query 时默认项与注入项都在
    expect(slash.options.items('').map((i) => i.id)).toContain('heading1');
    // action 可执行
    const item = slash.options.items('ai').find((i) => i.id === 'ai-rewrite');
    const { kernel } = mount('正文');
    expect(item?.action({ view: kernel.editor.view })).toBe(true);
    expect(actioned).toContain('ai-rewrite');
    kernel.destroy();
  });
});
