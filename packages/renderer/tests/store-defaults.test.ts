import { describe, expect, it } from 'vitest';
import { defaultVaultLayout } from '@nexnote/shared';
import { useTabStore } from '../src/stores/tab-store';
import { useUiStore } from '../src/stores/ui-store';

/**
 * GUI 验收回归（DEV-019 follow-up）：
 * 首次打开（无持久化 layout）应为「侧栏 + 单栏主区」，
 * AI Dock 与分屏都不默认打开，右侧空 pane 不占位。
 */
describe('工作区初始布局默认值', () => {
  it('ui-store 默认关闭 Dock，宽度与 shared 默认一致', () => {
    const ui = useUiStore.getState();
    const shared = defaultVaultLayout();

    expect(ui.dockVisible).toBe(false);
    expect(ui.dockWidth).toBe(shared.dockWidth);
    expect(ui.sidebarWidth).toBe(shared.sidebarWidth);
    expect(ui.sidebarCollapsed).toBe(shared.sidebarCollapsed);
  });

  it('tab-store 默认不分屏，右侧 pane 为空不渲染', () => {
    const tabs = useTabStore.getState();

    expect(tabs.splitEnabled).toBe(false);
    expect(tabs.panes.right.tabs).toHaveLength(0);
    expect(tabs.panes.right.activeTabId).toBeNull();
  });

  it('左侧 pane 初始只有一个欢迎 tab 且激活', () => {
    const left = useTabStore.getState().panes.left;

    expect(left.tabs).toHaveLength(1);
    expect(left.tabs[0].kind).toBe('welcome');
    expect(left.activeTabId).toBe(left.tabs[0].id);
  });

  it('splitEnabled 与 shared 默认一致', () => {
    expect(useTabStore.getState().splitEnabled).toBe(defaultVaultLayout().splitEnabled);
  });
});
