// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, translate } from '@nexnote/shared';
import { createEditor } from '@nexnote/kernel';
import { setLanguage } from '../src/lib/i18n';
import { buildBuiltinViewExtensions } from '../src/features/plugins/builtin/builtin-extensions';
import * as renderLib from '../src/features/plugins/builtin/render-lib';

/**
 * NodeView 的 loading / error 状态在**挂载后**切换界面语言时也必须重算。
 * 这里 mock 渲染库，把异步状态固定在 pending / rejected，避免依赖真实
 * Mermaid / KaTeX 的输出时序。
 */
vi.mock('../src/features/plugins/builtin/render-lib', () => ({
  renderMermaidSvg: vi.fn(),
  renderKatexInto: vi.fn(),
}));

function makeEditor(initialMarkdown: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, {
    initialMarkdown,
    slashMenu: false,
    dragHandle: false,
    extraExtensions: buildBuiltinViewExtensions({ mermaid: true, katex: true }),
  });
  return { container, kernel };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
const text = (language: 'zh-CN' | 'en-US', key: string, message?: string): string =>
  translate(CATALOGS[language], key, language, message ? { message } : undefined);

afterEach(() => setLanguage('zh-CN'));

describe('内置块 NodeView 异步状态的双语重算（ADR-0023）', () => {
  it('Mermaid 渲染中占位随语言切换重算，完成后替换为 SVG', async () => {
    const pending = deferred<string>();
    vi.mocked(renderLib.renderMermaidSvg).mockReturnValueOnce(pending.promise);
    const { kernel, container } = makeEditor('段落\n\n');

    kernel.editor.commands.insertMermaidBlock({ source: 'graph TD\n  A --> B' });
    const preview = container.querySelector<HTMLElement>('.nexnote-mermaid-preview')!;
    expect(preview.textContent).toBe(text('zh-CN', 'builtinBlock.mermaid.rendering'));

    setLanguage('en-US');
    expect(preview.textContent).toBe(text('en-US', 'builtinBlock.mermaid.rendering'));
    expect(preview.textContent).not.toMatch(/[\u4e00-\u9fff]/);

    pending.resolve('<svg data-testid="rendered"></svg>');
    await flush();
    expect(preview.querySelector('[data-testid="rendered"]')).not.toBeNull();
    kernel.destroy();
    container.remove();
  });

  it('Mermaid 语法错误随语言切换重算，保留上游错误原文', async () => {
    vi.mocked(renderLib.renderMermaidSvg).mockRejectedValueOnce(new Error('Parse error on line 2'));
    const { kernel, container } = makeEditor('段落\n\n');

    kernel.editor.commands.insertMermaidBlock({ source: 'graph TD\n  A -->' });
    await flush();
    const preview = container.querySelector<HTMLElement>('.nexnote-mermaid-preview')!;
    expect(preview.textContent).toBe(
      text('zh-CN', 'builtinBlock.mermaid.error', 'Parse error on line 2'),
    );

    setLanguage('en-US');
    expect(preview.textContent).toBe(
      text('en-US', 'builtinBlock.mermaid.error', 'Parse error on line 2'),
    );
    kernel.destroy();
    container.remove();
  });

  it('Mermaid 销毁后已发出的异步渲染不得再写入 DOM', async () => {
    const pending = deferred<string>();
    vi.mocked(renderLib.renderMermaidSvg).mockReturnValueOnce(pending.promise);
    const { kernel, container } = makeEditor('段落\n\n');

    kernel.editor.commands.insertMermaidBlock({ source: 'graph TD\n  A --> B' });
    const preview = container.querySelector<HTMLElement>('.nexnote-mermaid-preview')!;
    expect(preview.querySelector('[data-testid="late-svg"]')).toBeNull();

    kernel.destroy();
    container.remove();
    pending.resolve('<svg data-testid="late-svg"></svg>');
    await flush();

    // preview 引用仍是 detached DOM；destroy 已使本次渲染失效。
    expect(preview.querySelector('[data-testid="late-svg"]')).toBeNull();
  });

  it('LaTeX 渲染中占位随语言切换重算', () => {
    const pending = deferred<void>();
    vi.mocked(renderLib.renderKatexInto).mockResolvedValue(undefined);
    vi.mocked(renderLib.renderKatexInto).mockReturnValueOnce(pending.promise);
    const { kernel, container } = makeEditor('$$\nE = mc^2\n$$\n');

    const preview = container.querySelector<HTMLElement>('.nexnote-math-preview')!;
    expect(preview.textContent).toBe(text('zh-CN', 'builtinBlock.math.rendering'));

    setLanguage('en-US');
    expect(preview.textContent).toBe(text('en-US', 'builtinBlock.math.rendering'));
    expect(preview.textContent).not.toMatch(/[\u4e00-\u9fff]/);
    pending.resolve();
    kernel.destroy();
    container.remove();
  });
});
