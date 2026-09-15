// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import {
  WritingAssistantLayer,
  useWritingStore,
  type WritingSession,
} from '../src/features/ai/writing';

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function renderLayer(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<WritingAssistantLayer />);
    await flush();
  });
  return container;
}

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

describe('WritingAssistantLayer diff 预览浮层', () => {
  it('替换类渲染删除/新增 diff，点击接受触发 accept', async () => {
    const accept = vi.fn();
    await act(async () => {
      useWritingStore.getState().openSession(baseSession({ accept }));
    });
    const container = await renderLayer();
    const card = container.querySelector('[data-testid="writing-assistant"]');
    expect(card).toBeTruthy();
    expect(card?.querySelector('[data-testid="writing-label"]')?.textContent).toContain('改写');
    const ops = Array.from(container.querySelectorAll('[data-diff-op]')).map((el) =>
      el.getAttribute('data-diff-op'),
    );
    expect(ops).toContain('del');
    expect(ops).toContain('add');

    const acceptBtn = container.querySelector(
      '[data-testid="writing-accept"]',
    ) as HTMLButtonElement;
    expect(acceptBtn).toBeTruthy();
    await act(async () => {
      acceptBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(accept).toHaveBeenCalledOnce();
  });

  it('拒绝触发 reject；流式态显示停止按钮（stop）与进行中状态', async () => {
    const reject = vi.fn();
    await act(async () => {
      useWritingStore.getState().openSession(baseSession({ reject, status: 'done' }));
    });
    const container = await renderLayer();
    const rejectBtn = container.querySelector(
      '[data-testid="writing-reject"]',
    ) as HTMLButtonElement;
    await act(async () => {
      rejectBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(reject).toHaveBeenCalledOnce();

    const stop = vi.fn();
    await act(async () => {
      useWritingStore
        .getState()
        .openSession(baseSession({ status: 'streaming', generated: '', stop }));
    });
    expect(
      document.querySelector('[data-testid="writing-assistant"]')?.getAttribute('data-status'),
    ).toBe('streaming');
    expect(document.querySelector('[data-testid="writing-progress"]')?.textContent).toContain(
      '生成中',
    );
    const stopBtn = document.querySelector('[data-testid="writing-cancel"]') as HTMLButtonElement;
    expect(stopBtn).toBeTruthy();
    expect(document.querySelector('[data-testid="writing-accept"]')).toBeNull();
    await act(async () => {
      stopBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('取消（cancelled）保留内容、标记未完成，Accept/Reject 仍可用', async () => {
    const accept = vi.fn();
    await act(async () => {
      useWritingStore
        .getState()
        .openSession(baseSession({ status: 'cancelled', generated: '半句改写', accept }));
    });
    await renderLayer();
    const card = document.querySelector('[data-testid="writing-assistant"]');
    expect(card?.getAttribute('data-status')).toBe('cancelled');
    expect(document.querySelector('[data-testid="writing-incomplete"]')?.textContent).toContain(
      '未完成',
    );
    expect(document.querySelector('[data-testid="writing-diff"]')?.textContent).toContain(
      '半句改写',
    );
    expect(document.querySelector('[data-testid="writing-cancel"]')).toBeNull();
    const acceptBtn = document.querySelector('[data-testid="writing-accept"]') as HTMLButtonElement;
    expect(acceptBtn.disabled).toBe(false);
    await act(async () => {
      acceptBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(accept).toHaveBeenCalledOnce();
  });

  it('失败（error）展示错误与未完成标记；已生成内容仍可接受', async () => {
    await act(async () => {
      useWritingStore
        .getState()
        .openSession(baseSession({ status: 'error', error: '网络失败', generated: '半句改写' }));
    });
    await renderLayer();
    expect(
      document.querySelector('[data-testid="writing-assistant"]')?.getAttribute('data-status'),
    ).toBe('error');
    expect(document.querySelector('[data-testid="writing-error"]')?.textContent).toContain(
      '网络失败',
    );
    expect(document.querySelector('[data-testid="writing-incomplete"]')?.textContent).toContain(
      '未完成',
    );
    const acceptBtn = document.querySelector('[data-testid="writing-accept"]') as HTMLButtonElement;
    expect(acceptBtn.disabled).toBe(false);

    // 无任何已生成内容时 Accept 不可用，但 Reject 可用（原文未变）
    await act(async () => {
      useWritingStore
        .getState()
        .openSession(baseSession({ status: 'error', error: '网络失败', generated: '' }));
    });
    const emptyAccept = document.querySelector(
      '[data-testid="writing-accept"]',
    ) as HTMLButtonElement;
    expect(emptyAccept.disabled).toBe(true);
    expect(
      (document.querySelector('[data-testid="writing-reject"]') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('截断时显示截断提示；关闭按钮走 reject（丢弃会话，不写回）', async () => {
    const reject = vi.fn();
    await act(async () => {
      useWritingStore
        .getState()
        .openSession(baseSession({ truncated: true, note: '上下文过长，已截断', reject }));
    });
    await renderLayer();
    expect(document.querySelector('[data-testid="writing-truncated"]')?.textContent).toContain(
      '上下文过长，已截断',
    );
    await act(async () => {
      (document.querySelector('[data-testid="writing-close"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await flush();
    });
    expect(reject).toHaveBeenCalledOnce();
  });
});
