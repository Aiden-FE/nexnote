// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { EditorKernelInstance } from '@nexnote/kernel';

/**
 * DEV-109：预览解析失败横幅的重试交互。
 *
 * LivePreview 的交互契约：渲染失败 → 横幅出现（含重试按钮）→ 点重试
 * 用最新文本重走渲染 → 成功则横幅消失。内核管线对已知触发形态已在
 * parseMarkdown 层修复（list-item-content-normalize.test.ts），这里在
 * kernel 模块边界注入「可控失败」的 setMarkdown，锁定 UI 交互闭环本身。
 */

const setMarkdownBehavior = vi.hoisted(() => ({
  /** 抛出的错误；null = 正常成功。 */
  throwMessage: null as string | null,
  /** 记录每次 setMarkdown 收到的文本（重试应使用最新文本）。 */
  calls: [] as string[],
}));

vi.mock('@nexnote/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nexnote/kernel')>();
  return {
    ...actual,
    createEditor: (...args: Parameters<typeof actual.createEditor>) => {
      const kernel = actual.createEditor(...args);
      const real = kernel.setMarkdown.bind(kernel);
      const stub: EditorKernelInstance = Object.assign({}, kernel, {
        setMarkdown: (markdown: string, options?: { preserveSelection?: boolean }) => {
          setMarkdownBehavior.calls.push(markdown);
          if (setMarkdownBehavior.throwMessage !== null) {
            throw new Error(setMarkdownBehavior.throwMessage);
          }
          return real(markdown, options);
        },
      }) as EditorKernelInstance;
      return stub;
    },
  };
});

const { LivePreview } = await import('../src/editor/source/LivePreview');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const container = document.createElement('div');
document.body.append(container);

beforeAll(() => {
  Object.defineProperty(document, 'compatMode', { configurable: true, value: 'CSS1Compat' });
});

beforeEach(() => {
  setMarkdownBehavior.throwMessage = null;
  setMarkdownBehavior.calls = [];
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

const GOOD = '# 恢复后的标题\n\n恢复后的正文\n';

describe('DEV-109 · 预览错误横幅重试', () => {
  it('渲染失败出现横幅与重试按钮；恢复后自动渲染清横幅', async () => {
    vi.useFakeTimers();
    setMarkdownBehavior.throwMessage = 'Invalid content for node type listItem';
    mount(GOOD);
    // 挂载失败的 setRenderError 经 queueMicrotask 派发，冲掉微任务队列
    await act(async () => {
      await Promise.resolve();
    });
    // 挂载即渲染失败（内核抛错）
    expect(container.querySelector('[data-testid="preview-error"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="preview-stale"]')?.textContent,
    ).toContain('Invalid content for node type listItem');
    expect(container.querySelector('[data-testid="preview-retry"]')).toBeTruthy();

    // 内容恢复：内核不再抛错，下一次防抖渲染自动清横幅（既有语义保留）
    setMarkdownBehavior.throwMessage = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    act(() => {
      root!.render(
        <LivePreview
          markdown={GOOD}
          sourcePath="预览页.md"
          onNavigate={() => undefined}
          scrollRef={{ current: null }}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.querySelector('[data-testid="preview-error"]')).toBeNull();
  });

  it('点击重试用最新文本重走渲染：仍失败则横幅保持，成功后横幅消失', async () => {
    vi.useFakeTimers();
    setMarkdownBehavior.throwMessage = 'boom';
    mount('# 初始\n');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.querySelector('[data-testid="preview-error"]')).toBeTruthy();
    const callsAfterMount = setMarkdownBehavior.calls.length;

    // 内容更新为新文本（渲染仍失败）
    act(() => {
      root!.render(
        <LivePreview
          markdown={'# 更新后的文本\n'}
          sourcePath="预览页.md"
          onNavigate={() => undefined}
          scrollRef={{ current: null }}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.querySelector('[data-testid="preview-error"]')).toBeTruthy();

    // 点击重试：用最新文本（# 更新后的文本）再走一次，仍失败 → 横幅保持
    const retry = container.querySelector('[data-testid="preview-retry"]') as HTMLButtonElement;
    expect(() => act(() => retry.click())).not.toThrow();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(setMarkdownBehavior.calls[callsAfterMount]).toBe('# 更新后的文本\n');
    expect(container.querySelector('[data-testid="preview-error"]')).toBeTruthy();

    // 内核恢复成功后点重试 → 渲染成功、横幅消失
    setMarkdownBehavior.throwMessage = null;
    act(() => retry.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.querySelector('[data-testid="preview-error"]')).toBeNull();
    expect(container.querySelector('.ProseMirror')?.textContent).toContain('更新后的文本');
  });

  it('重试按钮使用 zh-CN 文案（i18n 词条齐全）', async () => {
    vi.useFakeTimers();
    setMarkdownBehavior.throwMessage = 'boom';
    mount(GOOD);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      container.querySelector('[data-testid="preview-retry"]')?.textContent,
    ).toBe('重试');
  });
});
