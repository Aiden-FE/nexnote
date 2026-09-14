// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { WelcomePage } from '../src/pages/WelcomePage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WelcomePage 产品能力文案', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('不展示过期票据文案并包含核心能力要点', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(<WelcomePage />));

    const copy = container.textContent ?? '';
    expect(copy).not.toContain('DEV-');
    expect(copy).not.toContain('后续票据');
    expect(copy).not.toContain('后续接入');
    expect(copy).toContain('块编辑与 Markdown 双格式文档');
    expect(copy).toContain('页面树、双向链接与图谱');
    expect(copy).toContain('内置 Git 版本历史');
    expect(copy).toContain('AI 对话与写作辅助');
  });

  it('用户可见文案不含 vault / Vault（术语统一「知识库」，DEV-021）', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(<WelcomePage />));

    const copy = container.textContent ?? '';
    expect(copy).not.toMatch(/vault/i);

    const buttons = [...container.querySelectorAll('button')].map(
      (b) => b.textContent?.trim() ?? '',
    );
    expect(buttons, buttons.join('|')).not.toContain('浏览 Vault 文件');
  });
});
