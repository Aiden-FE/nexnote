// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import {
  matchPreviewHeading,
  normalizePreviewHeadingText,
} from '../src/editor/source/preview-outline';
import { parseMarkdownOutline } from '../src/editor/outline';
import type { TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cm = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('../src/editor/source/codemirror-host', () => ({
  createSourceEditor: (_parent: HTMLElement, options: { initialText: string }) => ({
    getText: () => options.initialText,
    setText: () => undefined,
    focus: () => undefined,
    destroy: () => undefined,
    view: {
      state: { doc: { toString: () => options.initialText } },
      dispatch: cm.dispatch,
    },
  }),
}));

describe('matchPreviewHeading（预览悬浮目录定位纯函数）', () => {
  const headings = [
    { textContent: '顶层标题' },
    { textContent: 'HTML 标题' },
    { textContent: '引用标题' },
  ];

  it('优先按空白归一化文本匹配，绕过使 ordinal 错位的引用/HTML 标题', () => {
    // 「引用标题」ordinal 为 1，但预览里第 2 个 heading 是无源码条目的 HTML 标题。
    expect(matchPreviewHeading(headings, { text: '引用标题', ordinal: 1 })).toBe(headings[2]);
    expect(matchPreviewHeading(headings, { text: '顶层标题', ordinal: 5 })).toBe(headings[0]);
  });

  it('空白归一化：换行（Setext 多行文本）与连续空白折叠后相等即命中', () => {
    expect(normalizePreviewHeadingText(' Intro\ncontinued\t标题 ')).toBe('Intro continued 标题');
    const rendered = [{ textContent: 'Intro  continued 标题' }, { textContent: '其他' }];
    expect(matchPreviewHeading(rendered, { text: 'Intro\ncontinued 标题', ordinal: 9 })).toBe(
      rendered[0],
    );
  });

  it('找不到相同文本时回退 ordinal；越界与空文本安全处理', () => {
    expect(matchPreviewHeading(headings, { text: '不存在', ordinal: 1 })).toBe(headings[1]);
    expect(matchPreviewHeading(headings, { text: '不存在', ordinal: 9 })).toBeNull();
    expect(matchPreviewHeading([], { text: '任意', ordinal: 0 })).toBeNull();
    // 空文本不参与文本匹配，直接回退 ordinal。
    expect(matchPreviewHeading(headings, { text: '  ', ordinal: 0 })).toBe(headings[0]);
    // textContent 为 null 的 heading 不参与文本匹配，回退 ordinal 命中自身。
    const nullText = [{ textContent: null }];
    expect(matchPreviewHeading(nullText, { text: 'x', ordinal: 0 })).toBe(nullText[0]);
  });

  it('重名标题：ordinal 位置文本一致时命中该位置，而非恒命中首个同名者', () => {
    const duplicated = [{ textContent: '同名' }, { textContent: '其他' }, { textContent: '同名' }];
    expect(matchPreviewHeading(duplicated, { text: '同名', ordinal: 2 })).toBe(duplicated[2]);
    // ordinal 位置文本失配（被引用/HTML 标题挤偏）时才全量扫描首个同名者。
    const shifted = [{ textContent: '别的' }, { textContent: '同名' }, { textContent: '同名' }];
    expect(matchPreviewHeading(shifted, { text: '同名', ordinal: 0 })).toBe(shifted[1]);
  });
});

/** 预览态页面：HTML 标题渲染为预览 heading 但没有源码目录条目，会打乱 ordinal 对应。 */
const PAGE_MARKDOWN = '# 顶层标题\n\n<h2>HTML 标题</h2>\n\n> # 引用标题\n';

const previewTab: TabDescriptor = {
  id: 'source-outline-preview-test',
  kind: 'page',
  title: '预览目录页',
  pagePath: '预览目录页.md',
  format: 'markdown',
  editorMode: 'source',
  markdownView: 'preview',
  createdAt: 1,
};

const splitTab: TabDescriptor = {
  id: 'source-outline-split-test',
  kind: 'page',
  title: '分栏目录页',
  pagePath: '分栏目录页.md',
  format: 'markdown',
  editorMode: 'source',
  markdownView: 'split',
  createdAt: 1,
};

function installBridge(content: string, pagePath: string): void {
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'fs:readTextFile') return { ok: true, data: content };
      if (channel === 'fs:stat') {
        return {
          ok: true,
          data: {
            path: pagePath,
            name: pagePath,
            kind: 'file',
            size: content.length,
            modifiedAt: 'v1',
          },
        };
      }
      if (channel === 'fs:exists') return { ok: true, data: false };
      return { ok: true, data: null };
    }),
    on: () => () => undefined,
  };
}

afterEach(() => {
  delete (window as unknown as { nexnote?: unknown }).nexnote;
  document.body.innerHTML = '';
});

describe('SourceModeView 预览态悬浮目录导航', () => {
  it('含引用与 HTML 标题的页面按文本匹配定位，不再被 ordinal 错位', async () => {
    installBridge(PAGE_MARKDOWN, previewTab.pagePath);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourceModeView tab={previewTab} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // 真实 LivePreview（kernel）渲染 3 个 heading：h1 顶层、h2 HTML、块引用内 h1 引用。
    await vi.waitFor(() => {
      expect(container.querySelectorAll('h1').length).toBe(2);
      expect(container.querySelectorAll('h2').length).toBe(1);
    });
    const topHeading = container.querySelector('h1')!;
    const htmlHeading = container.querySelector('h2')!;
    const quoteHeading = container.querySelectorAll('h1')[1]!;
    const topSpy = vi.spyOn(topHeading, 'scrollIntoView');
    const htmlSpy = vi.spyOn(htmlHeading, 'scrollIntoView');
    const quoteSpy = vi.spyOn(quoteHeading, 'scrollIntoView');

    // 打开悬浮目录并点击「引用标题」：若按 ordinal=1 索引会错位滚动到 HTML 标题。
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="toolbar-entry-view:outline"]')!
        .click(),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="outline-entry-引用标题"]')!.click();
      await Promise.resolve();
    });

    expect(quoteSpy).toHaveBeenCalledTimes(1);
    expect(quoteSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(topSpy).not.toHaveBeenCalled();
    expect(htmlSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('分栏视图点击目录：编辑器选区定位的同时预览直接滚到对应 heading（DEV-048）', async () => {
    installBridge(PAGE_MARKDOWN, splitTab.pagePath);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourceModeView tab={splitTab} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll('h1').length).toBe(2);
    });
    const quoteHeading = container.querySelectorAll('h1')[1]!;
    const quoteSpy = vi.spyOn(quoteHeading, 'scrollIntoView');
    cm.dispatch.mockClear();

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="toolbar-entry-view:outline"]')!
        .click(),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="outline-entry-引用标题"]')!.click();
      await Promise.resolve();
    });

    // 编辑器单事务重设选区到源码标题行（from 来自 parseMarkdownOutline）。
    const entry = parseMarkdownOutline(PAGE_MARKDOWN).find((e) => e.text === '引用标题')!;
    expect(cm.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: entry.from, head: entry.to },
        scrollIntoView: true,
      }),
    );
    // 预览同步直接滚到引用 heading，而不是依赖比例滚动同步。
    expect(quoteSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    await act(async () => {
      root.unmount();
    });
  });

  it('预览视图：预览内容列不再受 --editor-content-width 限制，编辑器窗格退出文档流（DEV-048）', async () => {
    installBridge(PAGE_MARKDOWN, previewTab.pagePath);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourceModeView tab={previewTab} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="live-preview-content"]')).not.toBeNull();
    });
    const contentColumn = container.querySelector('[data-testid="live-preview-content"]')!;
    expect(contentColumn.classList.contains('max-w-none')).toBe(true);
    const pane = container.querySelector('[data-testid="source-editor-pane"]')!;
    // Tailwind v4 里 .relative 生成顺序在 .absolute 之后，同时存在会互相覆盖；
    // 预览态只允许 absolute（配合 size-px 隐藏退出文档流）。
    expect(pane.classList.contains('absolute')).toBe(true);
    expect(pane.classList.contains('relative')).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
