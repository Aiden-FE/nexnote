// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultInfo } from '@nexnote/shared';
import { Sidebar } from '../src/shell/Sidebar';
import { VaultContext } from '../src/shell/vault-context';
import { useSettingsNav } from '../src/lib/open-settings';
import { useTabStore } from '../src/stores/tab-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault: VaultInfo = {
  root: '/tmp/sidebar-settings-vault',
  name: 'sidebar-settings-vault',
  configPath: '/tmp/sidebar-settings-vault/.nexnote/config.json',
};

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  useSettingsNav.setState({ activeId: null });
  useTabStore.setState({
    tabs: [{ id: 'welcome', kind: 'welcome', title: '欢迎', createdAt: 1 }],
    activeTabId: 'welcome',
  });
  act(() => {
    root = createRoot(container);
    root.render(
      <VaultContext.Provider value={vault}>
        <Sidebar />
      </VaultContext.Provider>,
    );
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe('左下角设置入口', () => {
  it('打开并激活统一设置页，而不是侧栏内嵌 Git 设置', () => {
    const button = container.querySelector<HTMLButtonElement>('[data-tour="settings"]');
    expect(button).not.toBeNull();

    act(() => button!.click());

    expect(useSettingsNav.getState().activeId).toBeNull();
    const activeTab = useTabStore
      .getState()
      .tabs.find((tab) => tab.id === useTabStore.getState().activeTabId);
    expect(activeTab?.kind).toBe('settings');
    expect(container.querySelector('[data-testid="git-settings"]')).toBeNull();
  });
});
