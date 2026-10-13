// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ColorMenu } from '../src/editor/toolbar/ColorMenu';
import { FORMAT_TEXT_COLOR, FORMAT_BACKGROUND_COLOR } from '../src/editor/interactions/format-ids';
import { applyColorAction } from '../src/editor/interactions/formatting';
import { createEditor } from '@nexnote/kernel';
import { setCurrentLanguage } from '@nexnote/shared';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return container;
}

describe('字体颜色 / 背景色（验收问题 1）', () => {
  it('工具栏渲染单触发器，初始不展开面板', () => {
    setCurrentLanguage('zh-CN');
    const container = mount(<ColorMenu onApply={vi.fn()} />);
    expect(container.querySelector('[data-testid="color-menu-trigger"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="color-menu-panel"]')).toBeNull();
  });

  it('点击触发器展开面板：字体/背景 tab + 色板 + 自定义/清除', () => {
    const container = mount(<ColorMenu onApply={vi.fn()} />);
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="color-menu-trigger"]')!.click();
    });
    expect(container.querySelector('[data-testid="color-menu-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="color-tab-text"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="color-tab-background"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="color-swatch-"]').length).toBe(8);
    expect(container.querySelector('[data-testid="color-custom-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="color-clear"]')?.textContent).toContain('清除');
  });

  it('默认字体 tab：点预设色 → onApply(text-color, #RRGGBB) 并关闭面板', () => {
    const onApply = vi.fn();
    const container = mount(<ColorMenu onApply={onApply} />);
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="color-menu-trigger"]')!.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="color-swatch-E06666"]')!.click();
    });
    expect(onApply).toHaveBeenCalledWith(FORMAT_TEXT_COLOR, '#E06666');
    expect(container.querySelector('[data-testid="color-menu-panel"]')).toBeNull();
  });

  it('切背景 tab → onApply(background-color, #RRGGBB)', () => {
    const onApply = vi.fn();
    const container = mount(<ColorMenu onApply={onApply} />);
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="color-menu-trigger"]')!.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="color-tab-background"]')!.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="color-swatch-FFD966"]')!.click();
    });
    expect(onApply).toHaveBeenCalledWith(FORMAT_BACKGROUND_COLOR, '#FFD966');
  });

  it('清除颜色 → onApply(id, null)', () => {
    const onApply = vi.fn();
    const container = mount(<ColorMenu onApply={onApply} />);
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="color-menu-trigger"]')!.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="color-clear"]')!.click();
    });
    expect(onApply).toHaveBeenCalledWith(FORMAT_TEXT_COLOR, null);
  });

  it('触发器显示当前色条', () => {
    const container = mount(
      <ColorMenu currentTextColor="#E06666" currentBackgroundColor="#FFD966" onApply={vi.fn()} />,
    );
    const text = container.querySelector<HTMLElement>('[data-testid="color-indicator-text"]');
    const bg = container.querySelector<HTMLElement>('[data-testid="color-indicator-background"]');
    expect(text?.style.backgroundColor).toBe('#E06666');
    expect(bg?.style.backgroundColor).toBe('#FFD966');
  });

  it('非法色值与非颜色动作 id 被拒绝', () => {
    const kernel = createEditor(document.createElement('div'), { initialMarkdown: '文本' });
    expect(applyColorAction(FORMAT_TEXT_COLOR, 'red', kernel)).toBe(false);
    expect(applyColorAction('format:bold', '#ff0000', kernel)).toBe(false);
    expect(applyColorAction(FORMAT_TEXT_COLOR, '#ff0000', null)).toBe(false);
  });

  it('applyColorAction 真实应用颜色到内核并可清除', () => {
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: '一段彩色文字。',
    });
    const pos = kernel.editor.state.doc.textContent.indexOf('彩色');
    act(() => {
      kernel.editor
        .chain()
        .focus()
        .setTextSelection({ from: pos + 1, to: pos + 3 })
        .run();
    });
    expect(applyColorAction(FORMAT_TEXT_COLOR, '#ff0000', kernel)).toBe(true);
    expect(kernel.getMarkdown()).toContain('color: #ff0000');

    expect(applyColorAction(FORMAT_BACKGROUND_COLOR, '#fff2cc', kernel)).toBe(true);
    expect(kernel.getMarkdown()).toContain('background-color: #fff2cc');

    expect(applyColorAction(FORMAT_TEXT_COLOR, null, kernel)).toBe(true);
    const md = kernel.getMarkdown();
    expect(md).not.toContain('color: #ff0000');
    expect(kernel.editor.getText()).toContain('彩色');
  });
});
