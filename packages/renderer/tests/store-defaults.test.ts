import { describe, expect, it } from 'vitest';
import { defaultVaultLayout } from '@nexnote/shared';
import { useTabStore } from '../src/stores/tab-store';
import { useUiStore } from '../src/stores/ui-store';

/**
 * GUI 验收回归（DEV-019 follow-up / DEV-020 单栈）：
 * 首次打开（无持久化 layout）应为「侧栏 + 单栏主区」，
 * AI Dock 不默认打开，主区只有一个 tab 栈。
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

  it('tab-store 只有单 tab 栈，无 split 字段残留', () => {
    const tabs = useTabStore.getState() as unknown as Record<string, unknown>;

    expect(tabs.panes).toBeUndefined();
    expect(tabs.activePaneId).toBeUndefined();
    expect(tabs.splitEnabled).toBeUndefined();
    expect(tabs.splitRatio).toBeUndefined();
    expect(tabs.toggleSplit).toBeUndefined();
    expect(tabs.setSplitRatio).toBeUndefined();
  });

  it('初始只有一个欢迎 tab 且激活', () => {
    const { tabs, activeTabId } = useTabStore.getState();

    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.kind).toBe('welcome');
    expect(activeTabId).toBe(tabs[0]?.id);
  });

  it('vault layout 默认值不含 split 字段', () => {
    const layout = defaultVaultLayout() as unknown as Record<string, unknown>;
    expect(layout.splitEnabled).toBeUndefined();
    expect(layout.splitRatio).toBeUndefined();
  });
});
