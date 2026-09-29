// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MindmapDrawer } from '../src/binary-host/mindmap-drawer';
import { MindmapToolbar } from '../src/binary-host/mindmap-toolbar';
import { MINDMAP_MARKERS } from '../src/binary-host/mindmap-icons';
import { MINDMAP_THEME_PRESETS, deepMergeTheme, themePresetById } from '../src/binary-host/mindmap-themes';

/** DEV-099：xmind 操作界面组件结构（无 mindMap 实例时的禁用态与分组）。 */

let container: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return container;
}

describe('MindmapToolbar（DEV-099）', () => {
  it('左上撤销/重做/保存状态/立即保存，右上缩放/适应/复位/主题', () => {
    const view = mount(
      createElement(MindmapToolbar, {
        mindMap: null,
        scale: 1,
        themeId: 'classic',
        saveStatus: '已保存',
        onThemeChange: () => undefined,
        onSaveNow: () => undefined,
      }),
    );
    const labels = [...view.querySelectorAll('button')].map((b) => b.getAttribute('title'));
    expect(labels).toEqual(
      expect.arrayContaining([
        '撤销 (Ctrl+Z)',
        '重做 (Ctrl+Shift+Z)',
        '立即保存 (Ctrl+S)',
        '缩小',
        '放大',
        '适应画布',
        '复位 100%',
        '主题',
      ]),
    );
    expect(view.querySelector('[data-testid="mindmap-save-status"]')?.textContent).toBe('已保存');
    expect(view.querySelector('[data-testid="mindmap-zoom-percent"]')?.textContent).toBe('100%');
    // 无实例时画布操作禁用
    const zoomIn = [...view.querySelectorAll('button')].find((b) => b.getAttribute('title') === '放大');
    expect(zoomIn?.disabled).toBe(true);
  });

  it('主题下拉列出 5 套预设并可回调', () => {
    let picked: string | null = null;
    const view = mount(
      createElement(MindmapToolbar, {
        mindMap: null,
        scale: 0.5,
        themeId: 'classic',
        saveStatus: null,
        onThemeChange: (id: string) => {
          picked = id;
        },
        onSaveNow: () => undefined,
      }),
    );
    const palette = [...view.querySelectorAll('button')].find((b) => b.getAttribute('title') === '主题');
    act(() => palette?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const menu = view.querySelector('[data-testid="mindmap-theme-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(MINDMAP_THEME_PRESETS.length);
    const dark = view.querySelector('[data-testid="mindmap-theme-dark"]');
    act(() => (dark as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(picked).toBe('dark');
  });
});

describe('MindmapDrawer（DEV-099）', () => {
  it('未选中节点时三节齐全且操作禁用；选中后启用', () => {
    const view = mount(
      createElement(MindmapDrawer, {
        mindMap: null,
        activeNodes: [],
        open: true,
        onClose: () => undefined,
      }),
    );
    const drawer = view.querySelector('[data-testid="mindmap-drawer"]');
    expect(drawer).not.toBeNull();
    expect(drawer?.textContent).toContain('节点');
    expect(drawer?.textContent).toContain('形状');
    expect(drawer?.textContent).toContain('颜色');
    expect(drawer?.textContent).toContain('标记');
    expect(drawer?.textContent).toContain('备注');
    expect(drawer?.textContent).toContain('超链接');
    const addChild = [...(drawer?.querySelectorAll('button') ?? [])].find((b) =>
      b.getAttribute('title')?.includes('添加子节点'),
    );
    expect(addChild?.disabled).toBe(true);
  });

  it('open=false 不渲染', () => {
    const view = mount(
      createElement(MindmapDrawer, {
        mindMap: null,
        activeNodes: [],
        open: false,
        onClose: () => undefined,
      }),
    );
    expect(view.querySelector('[data-testid="mindmap-drawer"]')).toBeNull();
  });

  it('标记集合为 12 个 lucide 风格 SVG', () => {
    expect(MINDMAP_MARKERS).toHaveLength(12);
    for (const marker of MINDMAP_MARKERS) {
      expect(marker.svg).toContain('<svg');
      expect(marker.svg).toContain('viewBox="0 0 24 24"');
    }
  });

  it('主题预设 deepMerge 只覆盖声明键', () => {
    const base = { backgroundColor: '#fff', root: { fillColor: '#000', fontSize: 16 } };
    const merged = deepMergeTheme(base, { root: { fillColor: '#123456' } });
    expect(merged).toEqual({
      backgroundColor: '#fff',
      root: { fillColor: '#123456', fontSize: 16 },
    });
    expect(themePresetById('nope').id).toBe(MINDMAP_THEME_PRESETS[0]?.id);
  });
});
