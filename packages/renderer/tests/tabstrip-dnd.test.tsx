// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TabStrip } from '../src/tabs/TabStrip';
import { useTabStore } from '../src/stores/tab-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function mount(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<TabStrip />));
}

function tabEls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid="tab"]')];
}

/** happy-dom 元素矩形默认全 0；按序号排布假矩形供插入位置判定。 */
function fakeRects(width = 100): void {
  tabEls().forEach((el, index) => {
    const left = index * width;
    el.getBoundingClientRect = () =>
      ({ left, right: left + width, top: 0, bottom: 28, width, height: 28 }) as DOMRect;
  });
}

function fire(el: Element, type: string, init: Record<string, unknown> = {}): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}

/** 从 fromIndex 拖到 toIndex 的前半（before）或后半（after）。 */
function dragFromTo(fromIndex: number, toIndex: number, side: 'before' | 'after'): void {
  const tabs = tabEls();
  act(() => {
    tabs[fromIndex]?.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
  });
  fakeRects();
  const target = tabEls()[toIndex];
  const left = toIndex * 100 + (side === 'before' ? 10 : 90);
  act(() => {
    fire(target ?? tabs[toIndex], 'dragover', { clientX: left, clientY: 14 });
  });
  act(() => {
    fire(target ?? tabs[toIndex], 'drop', { clientX: left, clientY: 14 });
  });
  act(() => {
    tabs[fromIndex]?.dispatchEvent(new Event('dragend', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null });
  const store = useTabStore.getState();
  store.openTab({ kind: 'welcome', title: '欢迎' });
  store.openTab({ kind: 'page', title: 'A', pagePath: 'a.md' });
  store.openTab({ kind: 'page', title: 'B', pagePath: 'b.md' });
  // 右键菜单“复制路径”等分支依赖 navigator.clipboard
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  useTabStore.setState({ tabs: [], activeTabId: null });
  document.body.innerHTML = '';
});

describe('TabStrip HTML5 拖拽排序（DEV-022）', () => {
  it('tab 栈渲染为 tablist，tab 可拖拽（draggable）', () => {
    mount();
    const strip = document.querySelector('[data-testid="tabstrip"]');
    expect(strip?.getAttribute('role')).toBe('tablist');
    expect(tabEls().length).toBe(3);
    for (const el of tabEls()) {
      expect(el.getAttribute('draggable')).toBe('true');
      expect(el.getAttribute('role')).toBe('tab');
    }
  });

  it('拖动首个 tab 到末尾 tab 之后：顺序立即更新', () => {
    mount();
    const [w, a, b] = useTabStore.getState().tabs;
    dragFromTo(0, 2, 'after');
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([a.id, b.id, w.id]);
  });

  it('拖动末尾 tab 到首个 tab 之前：插入到目标下标', () => {
    mount();
    const [w, a, b] = useTabStore.getState().tabs;
    dragFromTo(2, 0, 'before');
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([b.id, w.id, a.id]);
  });

  it('dragover 悬停显示插入位置反馈，drop 后清除', () => {
    mount();
    const tabs = tabEls();
    act(() => {
      tabs[0]?.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    });
    fakeRects();
    act(() => {
      fire(tabEls()[1], 'dragover', { clientX: 190, clientY: 14 });
    });
    expect(tabEls()[1]?.getAttribute('data-drop-indicator')).toBe('after');
    expect(tabEls()[0]?.getAttribute('data-drop-indicator')).toBeNull();
    act(() => {
      fire(tabEls()[1], 'drop', { clientX: 190, clientY: 14 });
    });
    expect(tabEls().every((el) => el.getAttribute('data-drop-indicator') === null)).toBe(true);
  });

  it('dragover 未 preventDefault 时浏览器不会派发 drop：页签拖拽源必须 preventDefault', () => {
    mount();
    act(() => {
      tabEls()[0]?.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    });
    fakeRects();
    let event: Event | null = null;
    act(() => {
      event = fire(tabEls()[2], 'dragover', { clientX: 290, clientY: 14 });
    });
    expect((event as Event | null)?.defaultPrevented).toBe(true);
  });

  it('原位 drop（拖到自身）不改变顺序', () => {
    mount();
    const before = useTabStore.getState().tabs.map((t) => t.id);
    dragFromTo(1, 1, 'after');
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before);
  });

  it('无页签拖拽源（外部拖入）不触发重排', () => {
    mount();
    const before = useTabStore.getState().tabs.map((t) => t.id);
    fakeRects();
    act(() => {
      fire(tabEls()[2], 'dragover', { clientX: 290, clientY: 14 });
    });
    act(() => {
      fire(tabEls()[2], 'drop', { clientX: 290, clientY: 14 });
    });
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before);
  });

  it('既有交互不回归：单击激活 / 中键关闭 / 右键菜单 / + 新建', () => {
    mount();
    const store = useTabStore.getState();
    // 单击激活
    const aId = useTabStore.getState().tabs[1]?.id;
    act(() => {
      tabEls()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(useTabStore.getState().activeTabId).toBe(aId);
    // 中键关闭
    const countBefore = useTabStore.getState().tabs.length;
    act(() => {
      tabEls()[1]?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 }),
      );
    });
    expect(useTabStore.getState().tabs.length).toBe(countBefore - 1);
    // 右键菜单
    act(() => {
      tabEls()[0]?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    expect(document.querySelector('[data-testid="tab-context-menu"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    // + 新建
    const beforeNew = useTabStore.getState().tabs.length;
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="new-tab"]')?.click();
    });
    expect(useTabStore.getState().tabs.length).toBe(beforeNew + 1);
    void store;
  });
});
