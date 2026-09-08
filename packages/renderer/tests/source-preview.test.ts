import { describe, expect, it, vi } from 'vitest';
import { createPreviewScheduler } from '../src/editor/source/preview-scheduler';
import { syncScrollRatio } from '../src/editor/source/scroll-sync';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Live Preview 调度', () => {
  it('约 200ms debounce，连续输入只渲染最新内容', async () => {
    vi.useFakeTimers();
    const render = vi.fn(async () => undefined);
    const scheduler = createPreviewScheduler({ delayMs: 200, render });

    scheduler.schedule('a');
    scheduler.schedule('ab');
    scheduler.schedule('abc');
    await vi.advanceTimersByTimeAsync(199);
    expect(render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith('abc', expect.any(Function));
    scheduler.destroy();
    vi.useRealTimers();
  });

  it('异步旧版本完成时不得覆盖新版本', async () => {
    const applied: string[] = [];
    const scheduler = createPreviewScheduler({
      delayMs: 0,
      render: async (text, isCurrent) => {
        await sleep(text === 'old' ? 30 : 1);
        if (isCurrent()) applied.push(text);
      },
    });

    scheduler.schedule('old');
    await sleep(2);
    scheduler.schedule('new');
    await sleep(45);
    expect(applied).toEqual(['new']);
    scheduler.destroy();
  });

  it('destroy 后不再执行待渲染任务', async () => {
    vi.useFakeTimers();
    const render = vi.fn(async () => undefined);
    const scheduler = createPreviewScheduler({ delayMs: 200, render });
    scheduler.schedule('later');
    scheduler.destroy();
    await vi.advanceTimersByTimeAsync(300);
    expect(render).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('源码到预览单向滚动', () => {
  it('按可滚动距离比例同步', () => {
    expect(
      syncScrollRatio(
        { scrollTop: 50, scrollHeight: 200, clientHeight: 100 },
        { scrollHeight: 500, clientHeight: 100 },
      ),
    ).toBe(200);
  });

  it('无可滚动距离时归零', () => {
    expect(
      syncScrollRatio(
        { scrollTop: 10, scrollHeight: 100, clientHeight: 100 },
        { scrollHeight: 500, clientHeight: 100 },
      ),
    ).toBe(0);
  });
});
