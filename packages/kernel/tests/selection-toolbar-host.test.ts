// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSelectionToolbarHost, type BubbleAction } from '../src/extensions/selection-toolbar-host';

function makeActions(): BubbleAction[] {
  return [
    { id: 'format:bold', title: '加粗', icon: 'bold' },
    { id: 'edit:copy', title: '复制' },
  ];
}

describe('划词工具栏宿主（DEV-ARCH-001）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('默认隐藏；sync(visible=true, coords) 后显示并定位到选区上方', () => {
    const onAction = vi.fn();
    const host = createSelectionToolbarHost({
      actions: makeActions(),
      className: 'nexnote-selection-bubble',
      datasetFlag: 'selectionBubble',
      onAction,
    });

    expect(host.dom.dataset.selectionBubble).toBe('');
    expect(host.dom.style.display).toBe('none');
    expect(document.body.contains(host.dom)).toBe(true);

    host.sync(true, { top: 200, left: 320 });
    expect(host.dom.style.display).toBe('flex');
    expect(host.dom.style.position).toBe('fixed');
    // translate(-50%, -100%) 保证显示在选区上方
    expect(host.dom.style.transform).toBe('translate(-50%, -100%)');

    // sync 同步完成定位（host 无 rAF；滚动/rAF 归编辑器侧）。
    expect(host.dom.style.top).not.toBe('');
    expect(host.dom.style.left).not.toBe('');

    host.destroy();
  });

  it('点击动作调用 onAction；非隐藏动作不收起工具栏', () => {
    const onAction = vi.fn();
    const host = createSelectionToolbarHost({
      actions: makeActions(),
      className: 'nexnote-selection-bubble',
      datasetFlag: 'selectionBubble',
      onAction,
      hideOnAction: () => false,
    });

    host.sync(true, { top: 100, left: 100 });
    const buttons = host.dom.querySelectorAll<HTMLButtonElement>('[data-bubble-action]');
    const copyBtn = Array.from(buttons).find((b) => b.dataset.bubbleAction === 'edit:copy')!;
    copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onAction).toHaveBeenCalledWith('edit:copy');
    expect(host.dom.style.display).toBe('flex');

    host.destroy();
  });

  it('hideOnAction 返回 true 的动作触发后收起工具栏', () => {
    const onAction = vi.fn();
    const host = createSelectionToolbarHost({
      actions: makeActions(),
      className: 'nexnote-selection-bubble',
      datasetFlag: 'selectionBubble',
      onAction,
      hideOnAction: (id) => id === 'format:bold',
    });

    host.sync(true, { top: 50, left: 50 });
    const boldBtn = host.dom.querySelector<HTMLButtonElement>(
      '[data-bubble-action="format:bold"]',
    )!;
    boldBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onAction).toHaveBeenCalledWith('format:bold');
    expect(host.dom.style.display).toBe('none');

    host.destroy();
  });

  it('dismiss 后 sync(visible=true) 不复活（直到 resetDismiss）', () => {
    const onAction = vi.fn();
    const host = createSelectionToolbarHost({
      actions: makeActions(),
      className: 'nexnote-selection-bubble',
      datasetFlag: 'selectionBubble',
      onAction,
    });

    host.sync(true, { top: 100, left: 100 });
    expect(host.dom.style.display).toBe('flex');
    host.dismiss();
    expect(host.dom.style.display).toBe('none');

    host.sync(true, { top: 100, left: 100 });
    expect(host.dom.style.display).toBe('none');

    host.resetDismiss();
    host.sync(true, { top: 100, left: 100 });
    expect(host.dom.style.display).toBe('flex');

    host.destroy();
  });

  it('sync(visible=false) 隐藏且下次 sync(visible=true) 可正常复活', () => {
    const host = createSelectionToolbarHost({
      actions: makeActions(),
      className: 'nexnote-selection-bubble',
      datasetFlag: 'selectionBubble',
      onAction: () => undefined,
    });
    host.sync(true, { top: 100, left: 100 });
    expect(host.dom.style.display).toBe('flex');
    host.sync(false, null);
    expect(host.dom.style.display).toBe('none');
    host.sync(true, { top: 100, left: 100 });
    expect(host.dom.style.display).toBe('flex');
    host.destroy();
  });

  it('销毁后不再可被 sync 显示；DOM 移除', () => {
    const host = createSelectionToolbarHost({
      actions: makeActions(),
      className: 'nexnote-selection-bubble',
      datasetFlag: 'selectionBubble',
      onAction: () => undefined,
    });
    const node = host.dom;
    expect(document.body.contains(node)).toBe(true);
    host.destroy();
    expect(document.body.contains(node)).toBe(false);
    host.sync(true, { top: 100, left: 100 });
    expect(node.style.display).toBe('none');
  });

  it('AI 下拉存在并接收 shared actions；关闭后不报 onAction', () => {
    const onAction = vi.fn();
    const host = createSelectionToolbarHost({
      actions: [{ id: 'format:bold', title: '加粗' }],
      className: 'nexnote-selection-bubble',
      datasetFlag: 'selectionBubble',
      aiMenu: {
        actions: [{ id: 'ai:translate', title: '翻译' }],
      },
      onAction,
    });
    const trigger = host.dom.querySelector<HTMLButtonElement>('[data-bubble-action="ai:menu"]');
    expect(trigger).not.toBeNull();
    host.destroy();
  });

  it('水平视口钳制：坐标超出右边界时被钳到视口右端', () => {
    const host = createSelectionToolbarHost({
      actions: makeActions(),
      className: 'nexnote-selection-bubble',
      datasetFlag: 'selectionBubble',
      onAction: () => undefined,
    });
    // 假装工具栏宽 100，高 30
    Object.defineProperty(host.dom, 'offsetWidth', { value: 100, configurable: true });
    Object.defineProperty(host.dom, 'offsetHeight', { value: 30, configurable: true });

    host.sync(true, { top: 400, left: 9999 });
    // 钳到视口内：left + width/2 应 <= window.innerWidth - width/2 (translate(-50%) 半宽钳制)
    const leftPx = parseFloat(host.dom.style.left);
    expect(leftPx + 50).toBeLessThanOrEqual(window.innerWidth);
    host.destroy();
  });
});
