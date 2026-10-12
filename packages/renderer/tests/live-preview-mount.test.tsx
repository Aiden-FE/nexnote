// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CATALOGS, translate } from '@nexnote/shared';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { LivePreview } from '../src/editor/source/LivePreview';
import { setLanguage } from '../src/lib/i18n';

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
  setLanguage('zh-CN');
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
    expect(toc?.querySelector('.nexnote-table-of-contents-title')?.textContent).toBe(
      translate(CATALOGS['zh-CN'], 'outline.bodyTocTitle', 'zh-CN'),
    );
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
        ...container.querySelectorAll('[data-testid="live-preview"] [data-table-of-contents-item]'),
      ].map((item) => item.textContent),
    ).toEqual(['更新后的一级标题', '更新后的二级标题']);
  });

  it('正文目录标题与空态在 en-US 下按词典成文（ADR-0023）', () => {
    setLanguage('en-US');
    mount('<!-- nexnote:toc -->\n');
    const toc = container.querySelector('[data-testid="live-preview"] [data-table-of-contents]');
    expect(toc?.querySelector('.nexnote-table-of-contents-title')?.textContent).toBe(
      translate(CATALOGS['en-US'], 'outline.bodyTocTitle', 'en-US'),
    );
    expect(toc?.querySelector('[data-table-of-contents-empty]')?.textContent).toBe(
      translate(CATALOGS['en-US'], 'outline.bodyTocEmpty', 'en-US'),
    );
  });
});

describe('DEV-109 · 触发形态挂载真实内核：不出现解析失败横幅', () => {
  // 票面验收第 3 条：构造触发文档挂载 LivePreview（真实 kernel，无 mock）→
  // 修复后不出现 preview-error。live-preview-retry.test.tsx 在 kernel 边界注入
  // 可控失败锁定重试交互闭环；这里锁定端到端「触发输入 → 正常渲染」。
  const TRIGGER_DOCS = [
    { label: '空正文有序项 + 缩进列表', markdown: '1. \n   - a\n', expectText: 'a' },
    // 孤立空项渲染为空列表占位，无可见正文——断言 ProseMirror 已挂载即可
    { label: '孤立空有序项', markdown: '1. \n', expectText: null },
  ];

  for (const { label, markdown, expectText } of TRIGGER_DOCS) {
    it(`${label}：挂载即渲染成功，无 preview-error`, () => {
      vi.useFakeTimers();
      mount(markdown);

      expect(container.querySelector('[data-testid="preview-error"]')).toBeNull();
      // 内容真实渲染（首帧同步）
      expect(container.querySelector('.ProseMirror')).not.toBeNull();
      if (expectText !== null) {
        expect(container.querySelector('.ProseMirror')?.textContent).toContain(expectText);
      }
    });
  }

  it('孤立空有序项切换文档后仍无横幅（防抖路径）', async () => {
    vi.useFakeTimers();
    mount('1. \n');
    act(() => {
      root!.render(
        <LivePreview
          markdown="1. \n2. 正文\n"
          sourcePath="预览页.md"
          onNavigate={() => undefined}
          scrollRef={{ current: null }}
        />,
      );
    });
    expect(container.querySelector('[data-testid="preview-error"]')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.querySelector('[data-testid="preview-error"]')).toBeNull();
    expect(container.querySelector('.ProseMirror')?.textContent).toContain('正文');
  });
});
