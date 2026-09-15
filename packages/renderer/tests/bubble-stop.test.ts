// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  useWritingStore,
  writingStopControl,
  type WritingSession,
} from '../src/features/ai/writing';

function baseSession(over: Partial<WritingSession> = {}): WritingSession {
  return {
    id: 's1',
    actionId: 'rewrite',
    label: '改写',
    kind: 'replace',
    status: 'done',
    original: '旧句子',
    generated: '新句子',
    truncated: false,
    note: null,
    error: null,
    coords: { top: 100, left: 200 },
    accept: vi.fn(),
    reject: vi.fn(),
    stop: vi.fn(),
    ...over,
  };
}

describe('DEV-034 划词工具栏停止控件', () => {
  it('仅流式生成中可见/可用；点击调用会话 stop（保留内容并标记未完成）', () => {
    const stop = vi.fn();
    const control = writingStopControl();
    document.body.append(control.dom);
    // 原生 button：可聚焦、Enter/Space 触发（键盘可达）
    expect(control.dom.tagName).toBe('BUTTON');
    expect(control.dom.tabIndex).toBe(0);
    expect(control.dom.getAttribute('aria-label')).toBe('停止生成');
    expect(control.dom.hidden).toBe(true);
    expect(control.dom.disabled).toBe(true);

    // 流式：可见可用
    useWritingStore.getState().openSession(baseSession({ status: 'streaming', stop }));
    expect(control.dom.hidden).toBe(false);
    expect(control.dom.disabled).toBe(false);
    control.dom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(stop).toHaveBeenCalledOnce();

    // 停止后（未完成终态，等待 Accept/Reject）：停止控件退回隐藏
    useWritingStore.getState().openSession(baseSession({ status: 'cancelled' }));
    expect(control.dom.hidden).toBe(true);
    expect(control.dom.disabled).toBe(true);

    // 生成完成同样隐藏
    useWritingStore.getState().openSession(baseSession({ status: 'done' }));
    expect(control.dom.hidden).toBe(true);
    expect(control.dom.disabled).toBe(true);

    useWritingStore.getState().closeSession();
    expect(control.dom.hidden).toBe(true);
    control.destroy();
  });

  it('destroy 退订 store 并移除 DOM（编辑器卸载不泄漏）', () => {
    useWritingStore.getState().closeSession();
    const control = writingStopControl();
    document.body.append(control.dom);
    control.destroy();
    expect(control.dom.isConnected).toBe(false);
    // 退订后 store 变化不再触碰已销毁实例
    expect(() =>
      useWritingStore.getState().openSession(baseSession({ status: 'streaming' })),
    ).not.toThrow();
    expect(control.dom.hidden).toBe(true);
    useWritingStore.getState().closeSession();
  });

  it('错误态不显示停止控件（会话已结束，交由预览层处理）', () => {
    const control = writingStopControl();
    document.body.append(control.dom);
    useWritingStore.getState().openSession(baseSession({ status: 'error', error: '网络失败' }));
    expect(control.dom.hidden).toBe(true);
    useWritingStore.getState().closeSession();
    control.destroy();
  });
});
