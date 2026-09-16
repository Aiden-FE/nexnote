// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { LivePreview } from '../src/editor/source/LivePreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const container = document.createElement('div');
document.body.append(container);

beforeAll(() => {
  Object.defineProperty(document, 'compatMode', { configurable: true, value: 'CSS1Compat' });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

function mount(markdown: string): void {
  root = createRoot(container);
  act(() => {
    root!.render(
      <LivePreview
        markdown={markdown}
        sourcePath="预览页.md"
        onNavigate={() => undefined}
        scrollRef={{ current: null }}
      />,
    );
  });
}

describe('Live Preview 首帧（DEV-020 GUI 反馈：初次进入右侧不得空白）', () => {
  it('挂载即同步渲染首帧，不等待 200ms 防抖', () => {
    vi.useFakeTimers();
    mount('# 首屏标题\n\n首屏正文段落\n');

    // 不推进任何计时器：内容必须已经渲染。
    expect(
      container.querySelector('[data-testid="live-preview"] .ProseMirror')?.textContent,
    ).toContain('首屏标题');
    expect(
      container.querySelector('[data-testid="live-preview"] .ProseMirror')?.textContent,
    ).toContain('首屏正文段落');
  });

  it('后续输入仍走防抖调度（挂载后变更在 200ms 前不可见）', async () => {
    vi.useFakeTimers();
    mount('# 首屏标题\n\n正文\n');
    act(() => {
      root!.render(
        <LivePreview
          markdown="# 首屏标题\n\n第二版正文\n"
          sourcePath="预览页.md"
          onNavigate={() => undefined}
          scrollRef={{ current: null }}
        />,
      );
    });
    expect(container.querySelector('.ProseMirror')?.textContent).not.toContain('第二版正文');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.querySelector('.ProseMirror')?.textContent).toContain('第二版正文');
  });

  it('渲染正文目录块并在 Markdown 标题变化后动态更新', async () => {
    vi.useFakeTimers();
    mount('# 一级标题\n\n<!-- nexnote:toc -->\n\n## 二级标题\n');

    const toc = container.querySelector('[data-testid="live-preview"] [data-table-of-contents]');
    expect(toc?.querySelector('.nexnote-table-of-contents-title')?.textContent).toBe('目录');
    expect(
      [...(toc?.querySelectorAll('[data-table-of-contents-item]') ?? [])].map(
        (item) => item.textContent,
      ),
    ).toEqual(['一级标题', '二级标题']);

    act(() => {
      root!.render(
        <LivePreview
          markdown={'# 更新后的一级标题\n\n<!-- nexnote:toc -->\n\n## 更新后的二级标题\n'}
          sourcePath="预览页.md"
          onNavigate={() => undefined}
          scrollRef={{ current: null }}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(
      [
        ...container.querySelectorAll(
          '[data-testid="live-preview"] [data-table-of-contents-item]',
        ),
      ].map((item) => item.textContent),
    ).toEqual(['更新后的一级标题', '更新后的二级标题']);
  });
});
