// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorToolbar, TOOLBAR_MORE_ID } from '../src/editor/toolbar/EditorToolbar';
import type { ToolbarEntrySpec } from '../src/editor/toolbar/entries';
import { resolveToolbarLayout } from '../src/editor/toolbar/overflow';

/**
 * DEV-035：编辑器单行工具栏的溢出折叠与键盘可达性。
 * 几何尺寸由 getBoundingClientRect 替身给定，避免依赖真实布局引擎。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROW_TESTID = 'editor-toolbar-actions';
const WIDTHS: Record<string, number> = {
  bold: 24,
  italic: 24,
  strike: 24,
  ai: 28,
  [TOOLBAR_MORE_ID]: 24,
};

let rowWidth = 1000;
let rectSpy: ReturnType<typeof vi.spyOn>;
let container: HTMLDivElement;
let root: Root | null = null;
let ran: string[] = [];

function makeEntries(overrides: { disabledStrike?: boolean } = {}): ToolbarEntrySpec[] {
  const action = (id: string, width: number): ToolbarEntrySpec => ({
    kind: 'action',
    id,
    label: `动作 ${id} ${'名'.repeat(width)}`,
    icon: <span>{id}</span>,
    disabled: id === 'strike' && overrides.disabledStrike,
  });
  return [
    action('bold', WIDTHS.bold),
    action('italic', WIDTHS.italic),
    action('strike', WIDTHS.strike),
    {
      kind: 'menu',
      id: 'ai',
      label: 'AI',
      icon: <span>AI</span>,
      items: [
        { id: 'ai:ask', label: '询问 AI' },
        { id: 'ai:rewrite', label: 'AI 改写', shortcut: '⌘⌥R' },
      ],
    },
  ];
}

function mount(entries: ToolbarEntrySpec[]): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <EditorToolbar
        label="编辑器工具栏"
        entries={entries}
        onCommand={(id) => ran.push(id)}
        status={<span data-testid="save-status">已保存</span>}
      />,
    );
  });
}

const row = (): HTMLElement | null => document.querySelector(`[data-testid="${ROW_TESTID}"]`);
const byTestId = (id: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
const press = (el: Element, key: string): void => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

const click = (el: Element | null): void => {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  ran = [];
  rowWidth = 1000;
  rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const itemId = this.dataset.itemId;
    const width =
      this.dataset.testid === ROW_TESTID ? rowWidth : itemId ? (WIDTHS[itemId] ?? 0) : 0;
    return {
      width,
      height: 24,
      top: 0,
      left: 0,
      right: width,
      bottom: 24,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.body.innerHTML = '';
  rectSpy.mockRestore();
});

describe('工具栏 Priority+ 布局（resolveToolbarLayout）', () => {
  it('全部放得下时不保留「更多」占位', () => {
    const layout = resolveToolbarLayout(
      [
        { id: 'a', width: 24 },
        { id: 'b', width: 24 },
      ],
      100,
      24,
    );
    expect(layout).toEqual({ visibleIds: ['a', 'b'], overflowIds: [] });
  });

  it('放不下时为「更多」预留宽度，其余按顺序溢出', () => {
    const entries = [
      { id: 'a', width: 20 },
      { id: 'b', width: 20 },
      { id: 'c', width: 20 },
      { id: 'd', width: 20 },
    ];
    // 总宽 92 > 80 → 溢出；为「更多」(24) 与间距预留后只剩 a、b。
    expect(resolveToolbarLayout(entries, 80, 24)).toEqual({
      visibleIds: ['a', 'b'],
      overflowIds: ['c', 'd'],
    });
  });

  it('空间不足优先溢出低频组，常驻集合含 AI 得到保留', () => {
    const entries = [
      { id: 'undo', width: 20, priority: 'persistent' as const },
      { id: 'format', width: 20, priority: 'secondary' as const },
      { id: 'insert', width: 20, priority: 'secondary' as const },
      { id: 'ai', width: 20, priority: 'persistent' as const },
    ];
    expect(resolveToolbarLayout(entries, 72, 24)).toEqual({
      visibleIds: ['undo', 'ai'],
      overflowIds: ['format', 'insert'],
    });
  });

  it('同一响应式动作组不会被拆散', () => {
    const entries = [
      { id: 'edit', width: 20 },
      { id: 'source', width: 20, overflowGroup: 'views' },
      { id: 'split', width: 20, overflowGroup: 'views' },
      { id: 'preview', width: 20, overflowGroup: 'views' },
    ];
    // edit 放得下，但三态视图作为整体放不下，因此三项一起进入更多。
    expect(resolveToolbarLayout(entries, 72, 24)).toEqual({
      visibleIds: ['edit'],
      overflowIds: ['source', 'split', 'preview'],
    });
  });

  it('宽度极小时全部进入「更多」', () => {
    const entries = [
      { id: 'a', width: 40 },
      { id: 'b', width: 40 },
    ];
    expect(resolveToolbarLayout(entries, 30, 24)).toEqual({
      visibleIds: [],
      overflowIds: ['a', 'b'],
    });
  });

  it('无动作时既无「更多」也无溢出', () => {
    expect(resolveToolbarLayout([], 0, 24)).toEqual({ visibleIds: [], overflowIds: [] });
  });
});

describe('工具栏溢出的 DOM 行为（DEV-035）', () => {
  it('宽度充足：全部动作平铺，无「更多」入口', () => {
    mount(makeEntries());
    expect(document.querySelectorAll(`[data-testid^="toolbar-entry-"]`)).toHaveLength(4);
    expect(byTestId('toolbar-more')).toBeNull();
    expect(byTestId('save-status')?.textContent).toBe('已保存');
  });

  it('宽度不足：放不下的动作与 AI 入口整体进入「更多」，状态项仍可见', () => {
    rowWidth = 100;
    mount(makeEntries());
    expect(byTestId('toolbar-entry-bold')).not.toBeNull();
    expect(byTestId('toolbar-entry-italic')).not.toBeNull();
    expect(byTestId('toolbar-entry-strike')).toBeNull();
    // AI 入口整体折叠：触发器不出现，子动作不得部分留在工具栏上
    expect(byTestId('toolbar-entry-ai')).toBeNull();
    expect(byTestId('toolbar-more')).not.toBeNull();
    expect(byTestId('save-status')?.textContent).toBe('已保存');
  });

  it('溢出动作可从「更多」执行，AI 子动作保持分组且可执行', () => {
    rowWidth = 100;
    mount(makeEntries());
    click(byTestId('toolbar-more'));
    expect(byTestId('toolbar-more-menu')).not.toBeNull();
    expect(byTestId('toolbar-more-group-ai')?.textContent).toBe('AI');
    expect(byTestId('toolbar-menu-item-ai:ask')).not.toBeNull();
    expect(byTestId('toolbar-menu-item-ai:rewrite')).not.toBeNull();

    click(byTestId('toolbar-menu-item-strike'));
    expect(ran).toEqual(['strike']);
    // 执行后菜单关闭
    expect(byTestId('toolbar-more-menu')).toBeNull();
  });

  it('禁用的动作在「更多」中保持禁用且不可执行', () => {
    rowWidth = 100;
    mount(makeEntries({ disabledStrike: true }));
    click(byTestId('toolbar-more'));
    const strike = byTestId('toolbar-menu-item-strike');
    expect(strike?.getAttribute('aria-disabled')).toBe('true');
    click(strike);
    expect(ran).toEqual([]);
  });

  it('测量不可用时退回全部平铺（不产生不可达动作）', () => {
    rectSpy.mockRestore();
    mount(makeEntries());
    expect(document.querySelectorAll(`[data-testid^="toolbar-entry-"]`)).toHaveLength(4);
    expect(byTestId('toolbar-more')).toBeNull();
  });
});

describe('Icon-first 与统一 Tooltip（DEV-050）', () => {
  it('顶层默认仅图标，AI 保留唯一可见文案且按钮无原生 title', () => {
    mount(makeEntries());
    expect(byTestId('toolbar-entry-bold')?.textContent).toBe('bold');
    expect(byTestId('toolbar-entry-bold')?.hasAttribute('title')).toBe(false);
    expect(byTestId('toolbar-entry-ai')?.textContent).toContain('AI');
  });

  it('AI 下拉每一项都有图标与可读文案', () => {
    mount(makeEntries());
    press(byTestId('toolbar-entry-ai')!, 'ArrowDown');
    for (const item of document.querySelectorAll('[data-testid^="toolbar-menu-item-ai:"]')) {
      expect(item.textContent?.trim()).not.toBe('');
      expect(item.querySelector('span svg, span')).not.toBeNull();
    }
  });

  it('hover 与 keyboard focus 打开 Tooltip，Escape 关闭', async () => {
    mount(makeEntries());
    const bold = byTestId('toolbar-entry-bold')!;
    // DEV-067: tooltip 通过 portal 渲染到 document.body；React 由 pointerover/out
    // 合成 onPointerEnter/Leave，happy-dom 下派发冒泡的 over/out 事件。
    const tip = () => document.body.querySelector<HTMLElement>('[data-testid="toolbar-tooltip"]');
    act(() => bold.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    await tick(0);
    expect(tip()?.textContent).toContain('动作 bold');
    act(() => bold.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })));
    await tick(0);
    expect(tip()).toBeNull();
    act(() => bold.focus());
    await tick(0);
    expect(tip()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await tick(0);
    expect(tip()).toBeNull();
  });
});

describe('工具栏键盘可达性（DEV-035）', () => {
  it('工具栏为 roving tabindex：任一时刻只有一个可 Tab 进入的按钮', () => {
    mount(makeEntries());
    const items = [...(row()?.querySelectorAll('button[data-toolbar-item="true"]') ?? [])];
    expect(items).toHaveLength(4);
    expect(items.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(document.querySelector('[data-testid="editor-toolbar"]')?.getAttribute('role')).toBe(
      'toolbar',
    );
  });

  it('←/→ 与 Home/End 在工具栏内移动焦点', () => {
    mount(makeEntries());
    byTestId('toolbar-entry-bold')?.focus();
    press(row()!, 'ArrowRight');
    expect(document.activeElement).toBe(byTestId('toolbar-entry-italic'));
    press(row()!, 'End');
    expect(document.activeElement).toBe(byTestId('toolbar-entry-ai'));
    press(row()!, 'Home');
    expect(document.activeElement).toBe(byTestId('toolbar-entry-bold'));
    press(row()!, 'ArrowLeft');
    expect(document.activeElement).toBe(byTestId('toolbar-entry-ai'));
  });

  it('↓ 打开 AI 菜单并聚焦首项，↑/↓ 移动，Esc 关闭并回到触发器', () => {
    mount(makeEntries());
    const ai = byTestId('toolbar-entry-ai');
    press(ai!, 'ArrowDown');
    expect(byTestId('toolbar-menu')).not.toBeNull();
    expect(ai?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(byTestId('toolbar-menu-item-ai:ask'));

    press(byTestId('toolbar-menu')!, 'ArrowDown');
    expect(document.activeElement).toBe(byTestId('toolbar-menu-item-ai:rewrite'));
    press(byTestId('toolbar-menu')!, 'ArrowUp');
    expect(document.activeElement).toBe(byTestId('toolbar-menu-item-ai:ask'));

    press(byTestId('toolbar-menu')!, 'Escape');
    expect(byTestId('toolbar-menu')).toBeNull();
    expect(document.activeElement).toBe(ai);
  });

  it('窄窗下「更多」及其溢出项可全程键盘到达', () => {
    rowWidth = 100;
    mount(makeEntries());
    const more = byTestId('toolbar-more');
    more?.focus();
    press(more!, 'ArrowDown');
    // 溢出项顺序：被折叠的编辑动作 → AI 分组标题后的全部 AI 子动作
    expect(document.activeElement).toBe(byTestId('toolbar-menu-item-strike'));
    const menu = byTestId('toolbar-more-menu')!;
    press(menu, 'End');
    expect(document.activeElement).toBe(byTestId('toolbar-menu-item-ai:rewrite'));
    press(menu, 'Home');
    expect(document.activeElement).toBe(byTestId('toolbar-menu-item-strike'));
    press(menu, 'Escape');
    expect(document.activeElement).toBe(more);
  });
});
