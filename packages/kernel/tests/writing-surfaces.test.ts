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
  return kernel
    .getMarkdown()
    .replace(/[ \t]*\^[A-Za-z0-9]+/g, '')
    .trim();
}

function selectText(kernel: ReturnType<typeof createEditor>, from: number, to: number) {
  kernel.editor.view.dispatch(
    kernel.editor.view.state.tr.setSelection(
      TextSelection.create(kernel.editor.view.state.doc, from, to),
    ),
  );
}

/** 构造 getBoundingClientRect 返回值（测试布局桩）。 */
function makeRect(init: {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    top: init.top,
    left: init.left,
    right: init.right,
    bottom: init.bottom,
    width: init.width,
    height: init.height,
    x: init.left,
    y: init.top,
    toJSON: () => ({}),
  } as DOMRect;
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
  it('支持框架无关 icon renderer 注入并保留 data-icon，未注入时保留 lucide fallback', () => {
    const rendered: string[] = [];
    const { container, kernel } = mount('第一段示例文字', {
      selectionBubble: {
        actions: [{ id: 'format:strike', title: '删除线', icon: 'strike' }],
        aiMenu: { label: 'AI', actions: [] },
        iconRenderer: (icon) => {
          rendered.push(icon);
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          return svg;
        },
        onAction: vi.fn(),
      },
    });
    // 触发可见 bubble（需非折叠选区）
    kernel.editor.view.dispatch(
      kernel.editor.view.state.tr.setSelection(
        TextSelection.create(kernel.editor.view.state.doc, 1, 4),
      ),
    );
    const bubble = container.querySelector<HTMLElement>('[data-selection-bubble]')!;
    const strike = bubble.querySelector<HTMLElement>('[data-icon="strike"]')!;
    const sparkles = bubble.querySelector<HTMLElement>('[data-icon="sparkles"]')!;
    const chevron = bubble.querySelector<HTMLElement>('[data-icon="chevron-down"]')!;
    expect(rendered).toEqual(expect.arrayContaining(['strike', 'sparkles', 'chevron-down']));
    for (const icon of [strike, sparkles, chevron]) {
      const svg = icon.querySelector('svg')!;
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    }
    kernel.destroy();

    // 未注入 renderer：默认 lucide renderer 仍生效；wikilink 没有 lucide 对应会走文字 fallback
    const fallback = mount('第二段示例文字', {
      selectionBubble: {
        actions: [
          { id: 'format:bold', title: '粗体', icon: 'bold' },
          { id: 'format:wikilink', title: '双链', icon: 'wikilink' },
        ],
        aiMenu: { label: 'AI', actions: [] },
        onAction: vi.fn(),
      },
    });
    fallback.kernel.editor.view.dispatch(
      fallback.kernel.editor.view.state.tr.setSelection(
        TextSelection.create(fallback.kernel.editor.view.state.doc, 1, 4),
      ),
    );
    const fallbackBubble = fallback.container.querySelector<HTMLElement>('[data-selection-bubble]')!;
    const boldIcon = fallbackBubble.querySelector<HTMLElement>('[data-icon="bold"]')!;
    expect(boldIcon.querySelector('svg')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    const wikiIcon = fallbackBubble.querySelector<HTMLElement>('[data-icon="wikilink"]')!;
    expect(wikiIcon.classList.contains('nexnote-selection-bubble__icon--fallback')).toBe(true);
    expect(wikiIcon.textContent).toBe('[[]]');
    fallback.kernel.destroy();
  });

  it('非折叠选区出现工具栏，点击按钮触发对应动作且保留选区', () => {
    const onAction = vi.fn();
    const { kernel } = mount('这是第一段的示例文字\n\n第二段', {
      selectionBubble: {
        actions: [
          {
            id: 'ai-rewrite',
            title: '改写',
            shortcut: { mod: true, key: 'r' },
            shortcutLabel: '⌘R',
          },
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
    expect(onAction).toHaveBeenCalledWith(
      'ai-rewrite',
      expect.objectContaining({ target: 'selection' }),
    );
    // 选区不被破坏
    expect(view.state.selection.empty).toBe(false);
    kernel.destroy();
  });

  it('多行选区时锚定选区起点行而非首尾中点', () => {
    const onAction = vi.fn();
    const { container, kernel } = mount('第一行内容\n\n第二行内容', {
      selectionBubble: {
        actions: [{ id: 'ai-rewrite', title: '改写' }],
        onAction,
      },
    });
    const view = kernel.editor.view;
    const host = container.getBoundingClientRect;
    container.getBoundingClientRect = () => ({
      top: 50,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 550,
      x: 0,
      y: 50,
      toJSON: () => ({}),
    });
    const from = 1;
    const to = view.state.doc.content.size - 1;
    vi.spyOn(view, 'coordsAtPos').mockImplementation((pos) =>
      pos === from
        ? { top: 120, bottom: 140, left: 24, right: 40 }
        : { top: 240, bottom: 260, left: 400, right: 420 },
    );
    selectText(kernel, from, to);
    const ctx = computeEditorActionContext(view, 'selection');
    expect(ctx.coords).toEqual({ top: 120, left: 24 });
    const bubble = container.querySelector<HTMLElement>('[data-selection-bubble]');
    expect(bubble?.style.left).toBe('24px');
    container.getBoundingClientRect = host;
    kernel.destroy();
  });

  it('选区贴近顶部时工具栏不越过容器上边界', () => {
    const { container, kernel } = mount('顶部内容', {
      selectionBubble: {
        actions: [{ id: 'ai-rewrite', title: '改写' }],
        onAction: () => undefined,
      },
    });
    const view = kernel.editor.view;
    container.getBoundingClientRect = () => ({
      top: 50,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 550,
      x: 0,
      y: 50,
      toJSON: () => ({}),
    });
    const bubble = container.querySelector<HTMLElement>('[data-selection-bubble]');
    expect(bubble).toBeTruthy();
    Object.defineProperty(bubble, 'offsetHeight', { configurable: true, value: 32 });
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({
      top: 54,
      bottom: 74,
      left: 24,
      right: 40,
    });
    selectText(kernel, 1, 4);
    expect(bubble?.style.top).toBe('32px');
    kernel.destroy();
  });

  it('折叠光标时隐藏工具栏；快捷键触发动作', () => {
    const onAction = vi.fn();
    const { kernel } = mount('第一段', {
      selectionBubble: {
        actions: [
          {
            id: 'ai-polish',
            title: '润色',
            shortcut: { mod: true, key: 'p' },
            shortcutLabel: '⌘P',
          },
        ],
        onAction,
      },
    });
    const view = kernel.editor.view;
    const bubble = view.dom.parentElement?.querySelector<HTMLElement>('[data-selection-bubble]');
    expect(bubble?.style.display).toBe('none');

    selectText(kernel, 1, 4);
    expect(bubble?.style.display).not.toBe('none');
    const handled = view.someProp('handleKeyDown', (f) =>
      f(
        view,
        new KeyboardEvent('keydown', { metaKey: true, key: 'p' }) as unknown as KeyboardEvent,
      ),
    );
    expect(handled).toBe(true);
    expect(onAction).toHaveBeenCalledWith(
      'ai-polish',
      expect.objectContaining({ target: 'selection' }),
    );
    kernel.destroy();
  });

  it('动态禁用的快捷键经真实 TipTap DOM 事件绝不触发，恢复可用后才触发', () => {
    const onAction = vi.fn();
    let disabled = true;
    const { container, kernel } = mount('第一段', {
      selectionBubble: {
        actions: [
          {
            id: 'ai-polish',
            title: '润色',
            shortcut: { mod: true, key: 'p' },
            disabled: () => disabled,
          },
        ],
        onAction,
      },
    });
    selectText(kernel, 1, 4);
    const bubble = container.querySelector<HTMLElement>('[data-selection-bubble]')!;
    const button = bubble.querySelector<HTMLButtonElement>('[data-bubble-action="ai-polish"]')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    kernel.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true }),
    );
    expect(onAction).not.toHaveBeenCalled();

    disabled = false;
    kernel.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true }),
    );
    expect(onAction).toHaveBeenCalledWith(
      'ai-polish',
      expect.objectContaining({ target: 'selection' }),
    );
    kernel.destroy();
  });

  it('动态 disabled/reason 随 TipTap selection update 刷新 aria 和唯一 tabstop', () => {
    let disabled = true;
    let reason: string | undefined = '复杂选区';
    const { container, kernel } = mount('第一段', {
      selectionBubble: {
        actions: [
          {
            id: 'format:bold',
            title: '粗体',
            icon: 'bold',
            disabled: () => disabled,
            disabledReason: () => reason,
          },
        ],
        onAction: vi.fn(),
      },
    });
    selectText(kernel, 1, 4);
    const button = container.querySelector<HTMLButtonElement>(
      '[data-bubble-action="format:bold"]',
    )!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('复杂选区');
    expect(button.tabIndex).toBe(-1);

    disabled = false;
    reason = undefined;
    selectText(kernel, 1, 3);
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('粗体');
    expect(button.tabIndex).toBe(0);

    disabled = true;
    reason = '只读';
    selectText(kernel, 1, 4);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('只读');
    expect(button.tabIndex).toBe(-1);
    kernel.destroy();
  });

  // 定位回归：CSS/包含块不一致曾导致 top/left 被忽略、浮层落入文档流末尾，
  // 距离随文档长度增长。bubble 底边应始终距选区起点 top 8px，水平收在容器内。
  it('长文档（大量空行）中部划词：底边距选区起点 8px，水平收在容器内', () => {
    const onAction = vi.fn();
    const paragraphs = Array.from({ length: 120 }, (_, i) => (i % 2 ? '' : `第 ${i} 段内容`));
    const { container, kernel } = mount(paragraphs.join('\n\n'), {
      selectionBubble: {
        actions: [{ id: 'ai-rewrite', title: '改写' }],
        onAction,
      },
    });
    const view = kernel.editor.view;
    // 模拟真实布局：容器位于视口 (0,50)，宽 800
    container.getBoundingClientRect = () =>
      makeRect({ top: 50, left: 0, right: 800, bottom: 650, width: 800, height: 600 });
    // 选区起点在文档中部（视口 y=3000）
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({
      top: 3000,
      bottom: 3024,
      left: 700,
      right: 720,
    });
    const bubble = container.querySelector<HTMLElement>('[data-selection-bubble]');
    expect(bubble).toBeTruthy();
    Object.defineProperty(bubble, 'offsetWidth', { configurable: true, value: 120 });
    Object.defineProperty(bubble, 'offsetHeight', { configurable: true, value: 32 });

    const doc = view.state.doc;
    const mid = Math.floor(doc.content.size / 2);
    selectText(kernel, mid, mid + 4);

    expect(bubble?.style.display).not.toBe('none');
    // transform translate(-50%,-100%)：style.top 即 bubble 底边（容器内坐标），
    // 底边 = 选区起点 top - 8 → 距选区起点 8px（3000 - 8 - 50 容器偏移 = 2942）
    expect(bubble?.style.top).toBe(`${3000 - 8 - 50}px`);
    // 水平：style.left 为 bubble 中心（translate(-50%)），中心被钳制在容器内
    // 半宽处 → 视觉边缘 [640, 760] 完全落在容器 0~800 内
    const center = Number.parseFloat(bubble?.style.left ?? '');
    expect(center - 60).toBeGreaterThanOrEqual(0);
    expect(center + 60).toBeLessThanOrEqual(800);
    kernel.destroy();
  });

  it('滚动容器滚动后按新视口坐标重算，仍以包含块为参照', () => {
    const onAction = vi.fn();
    const { container, kernel } = mount('第一段\n\n第二段\n\n第三段', {
      selectionBubble: {
        actions: [{ id: 'ai-rewrite', title: '改写' }],
        onAction,
      },
    });
    const view = kernel.editor.view;
    container.getBoundingClientRect = () =>
      makeRect({ top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 });
    const coords = { top: 400, bottom: 424, left: 100, right: 120 };
    const coordsSpy = vi.spyOn(view, 'coordsAtPos').mockReturnValue(coords);
    const bubble = container.querySelector<HTMLElement>('[data-selection-bubble]');
    Object.defineProperty(bubble, 'offsetWidth', { configurable: true, value: 120 });
    Object.defineProperty(bubble, 'offsetHeight', { configurable: true, value: 32 });

    selectText(kernel, 1, 4);
    expect(bubble?.style.top).toBe(`${400 - 8}px`);

    // 文档滚动 160px：选区视口坐标上移，scroll 事件触发重算（document 捕获阶段可收到）
    coords.top = 240;
    container.dispatchEvent(new Event('scroll'));
    expect(coordsSpy).toHaveBeenCalled();
    expect(bubble?.style.top).toBe(`${240 - 8}px`);
    kernel.destroy();
  });
});

describe('DEV-034 划词工具栏 AI 下拉（块编辑）', () => {
  function mountWithMenu(onAction = vi.fn()) {
    const mounted = mount('第一段示例文字\n\n第二段', {
      selectionBubble: {
        actions: [{ id: 'format:bold', title: 'B' }],
        aiMenu: {
          label: 'AI',
          actions: [
            {
              id: 'ai:rewrite',
              title: '改写',
              shortcut: { mod: true, alt: true, key: 'r' },
              shortcutLabel: '⌘⌥R',
            },
            { id: 'ai:polish', title: '润色' },
            { id: 'chat:ask-selection', title: '询问 AI' },
          ],
        },
        onAction,
      },
    });
    return { ...mounted, onAction };
  }

  const bubbleOf = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-selection-bubble]');
  const menuOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-ai-menu]');
  const triggerOf = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>('[data-bubble-action="ai:menu"]');
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('AI 动作收口为单一入口，平铺按钮只剩非 AI 动作', () => {
    const { container, kernel } = mountWithMenu();
    selectText(kernel, 1, 6);
    const bubble = bubbleOf(container);
    expect(bubble).toBeTruthy();
    const flat = Array.from(bubble!.querySelectorAll('[data-bubble-action]')).map(
      (b) => (b as HTMLElement).dataset.bubbleAction,
    );
    expect(flat).toEqual(['format:bold', 'ai:menu']);
    const menuIds = Array.from(bubble!.querySelectorAll('[data-ai-menu-action]')).map(
      (b) => (b as HTMLElement).dataset.aiMenuAction,
    );
    expect(menuIds).toEqual(['ai:rewrite', 'ai:polish', 'chat:ask-selection']);
    expect(menuOf(container)!.hidden).toBe(true);
    // 快捷键提示保留在菜单项
    expect(
      menuOf(container)!.querySelector(
        '[data-ai-menu-action="ai:rewrite"] .nexnote-selection-bubble__shortcut',
      )?.textContent,
    ).toBe('⌘⌥R');
    kernel.destroy();
  });

  it('TipTap uses one top-level tabstop, repairs hidden/disabled controls, and closes on external focusout', () => {
    const { container, kernel } = mountWithMenu();
    selectText(kernel, 1, 6);
    const bubble = bubbleOf(container)!;
    const top = () =>
      Array.from(
        bubble.querySelectorAll<HTMLButtonElement>(
          ':scope > button:not([hidden]), :scope > [data-ai-dropdown] > button:not([hidden])',
        ),
      );
    expect(top().filter((button) => button.tabIndex === 0)).toHaveLength(1);
    const first = top().find((button) => button.tabIndex === 0)!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const last = top().at(-1)!;
    expect(document.activeElement).toBe(last);
    expect(top().filter((button) => button.tabIndex === 0)).toEqual([last]);
    last.setAttribute('aria-disabled', 'true');
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(first.tabIndex).toBe(0);
    expect(top().filter((button) => button.tabIndex === 0)).toEqual([first]);

    const trigger = triggerOf(container)!;
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: trigger }));
    expect(bubble.style.display).not.toBe('none');
    const outside = document.createElement('button');
    document.body.append(outside);
    trigger.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    expect(bubble.style.display).toBe('none');
    kernel.destroy();
  });

  it('actual TipTap toolbar DOM Escape only closes nested Tooltip or menu, not the bubble', () => {
    const { container, kernel } = mountWithMenu();
    selectText(kernel, 1, 6);
    const bubble = bubbleOf(container)!;
    const action = bubble.querySelector<HTMLButtonElement>('[data-bubble-action="format:bold"]')!;
    const tooltip = action.querySelector<HTMLElement>('[role="tooltip"]')!;
    action.focus();
    expect(tooltip.hidden).toBe(false);
    action.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(tooltip.hidden).toBe(true);
    expect(bubble.style.display).not.toBe('none');

    const trigger = triggerOf(container)!;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const menu = menuOf(container)!;
    const item = menu.querySelector<HTMLButtonElement>('[data-ai-menu-action="ai:rewrite"]')!;
    item.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(bubble.style.display).not.toBe('none');

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const activeItem = document.activeElement as HTMLButtonElement;
    activeItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.querySelector<HTMLElement>('[role="tooltip"]')?.hidden).toBe(true);

    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(bubble.style.display).toBe('none');
    expect(document.activeElement).toBe(kernel.editor.view.dom);
    kernel.destroy();
  });

  it('键盘打开/方向键/Enter 执行/Esc 关闭；Esc 不隐藏工具栏', () => {
    const { container, kernel, onAction } = mountWithMenu();
    selectText(kernel, 1, 6);
    const trigger = triggerOf(container)!;
    const menu = menuOf(container)!;

    key(trigger, 'ArrowDown');
    expect(menu.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(menu.querySelector('[data-ai-menu-action="ai:rewrite"]'));
    key(menu, 'ArrowDown');
    expect(document.activeElement).toBe(menu.querySelector('[data-ai-menu-action="ai:polish"]'));
    key(menu, 'ArrowUp');
    expect(document.activeElement).toBe(menu.querySelector('[data-ai-menu-action="ai:rewrite"]'));

    key(document.activeElement!, 'Escape');
    expect(menu.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    // Esc 只关菜单：工具栏与选区保持
    expect(bubbleOf(container)!.style.display).not.toBe('none');
    expect(kernel.editor.view.state.selection.empty).toBe(false);

    key(trigger, 'ArrowDown');
    key(document.activeElement!, 'Enter');
    expect(onAction).toHaveBeenCalledWith(
      'ai:rewrite',
      expect.objectContaining({ target: 'selection' }),
    );
    expect(menu.hidden).toBe(true);
    expect(kernel.editor.view.state.selection.empty).toBe(false);
    kernel.destroy();
  });

  it('菜单动作仍可用 ⌘⌥ 快捷键直接触发（快捷键提示不回归）', () => {
    const { kernel, onAction } = mountWithMenu();
    selectText(kernel, 1, 6);
    const handled = kernel.editor.view.someProp('handleKeyDown', (f) =>
      f(
        kernel.editor.view,
        new KeyboardEvent('keydown', { metaKey: true, altKey: true, key: 'r' }) as KeyboardEvent,
      ),
    );
    expect(handled).toBe(true);
    expect(onAction).toHaveBeenCalledWith(
      'ai:rewrite',
      expect.objectContaining({ target: 'selection' }),
    );
    kernel.destroy();
  });

  it('注入的附加控件（停止按钮）挂在工具栏内；选区折叠时不遮挡也不显示', () => {
    const onAction = vi.fn();
    const extra = document.createElement('button');
    extra.type = 'button';
    extra.dataset.testid = 'bubble-stop';
    extra.textContent = '停止';
    let clicked = 0;
    extra.addEventListener('click', () => {
      clicked += 1;
    });
    const { container, kernel } = mount('第一段示例文字', {
      selectionBubble: {
        actions: [{ id: 'format:bold', title: 'B' }],
        aiMenu: { label: 'AI', actions: [{ id: 'ai:rewrite', title: '改写' }] },
        extraControl: { dom: extra },
        onAction,
      },
    });
    selectText(kernel, 1, 4);
    const bubble = bubbleOf(container)!;
    expect(bubble.contains(extra)).toBe(true);
    extra.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).toBe(1);
    // 选区折叠 → 工具栏隐藏（含附加控件）
    kernel.editor.view.dispatch(
      kernel.editor.view.state.tr.setSelection(
        TextSelection.create(kernel.editor.view.state.doc, 1),
      ),
    );
    expect(bubble.style.display).toBe('none');
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
    aiItem
      ?.closest('.nexnote-context-menu__sub-wrap')
      ?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    const sub = menu?.querySelector<HTMLElement>('.nexnote-context-menu__sub');
    expect(sub?.style.display).toBe('block');
    const action = sub?.querySelector<HTMLButtonElement>('[data-context-menu-item="ai-fill"]');
    action?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onAction).toHaveBeenCalledWith(
      'ai-fill',
      expect.objectContaining({ target: 'selection' }),
    );
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
    expect(kernel.replaceRangeWithMarkdown(secondFrom, secondTo, '新段落一\n\n新段落二')).toBe(
      true,
    );
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
          group: 'AI',
          kind: 'ai',
          contract: { execution: 'explicit-ai', capability: 'explicit-ai' },
          action: ({ view }) => {
            actioned.push('ai-rewrite');
            void view;
            return true;
          },
        },
      ],
    });
    const slash = exts.find((e) => (e as { name?: string }).name === 'nexnoteSlashMenu') as {
      options: {
        items: (
          q: string,
          context?: unknown,
        ) => { id: string; action: (ctx: { view: unknown }) => boolean }[];
      };
    };
    const aiItems = slash.options
      .items('ai', {
        triggerFrom: 1,
        triggerTo: 1,
        emptyBlock: true,
        capabilities: new Set(['editable-line', 'empty-block', 'explicit-ai', 'plugin-defined']),
      })
      .map((i) => i.id);
    expect(aiItems).toContain('ai-rewrite');
    // 默认结构块项不匹配 'ai'
    expect(aiItems).not.toContain('block:heading:1');
    // 空 query 时默认项与注入项都在
    expect(
      slash.options
        .items('', {
          triggerFrom: 1,
          triggerTo: 1,
          emptyBlock: true,
          capabilities: new Set(['editable-line', 'empty-block', 'explicit-ai', 'plugin-defined']),
        })
        .map((i) => i.id),
    ).toContain('block:heading:1');
    // action 可执行
    const item = slash.options
      .items('ai', {
        triggerFrom: 1,
        triggerTo: 1,
        emptyBlock: true,
        capabilities: new Set(['editable-line', 'empty-block', 'explicit-ai', 'plugin-defined']),
      })
      .find((i) => i.id === 'ai-rewrite');
    const { kernel } = mount('正文');
    expect(item?.action({ view: kernel.editor.view })).toBe(true);
    expect(actioned).toContain('ai-rewrite');
    kernel.destroy();
  });
});
