// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultGlobalSettings, type SettingSearchEntry } from '@nexnote/shared';
import '../src/features/settings';
import { SettingsPage } from '../src/pages/SettingsPage';
import { subscribeSettingsChanges, useSettingsStore } from '../src/stores/settings-store';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function installBridge(mock?: Record<string, unknown>) {
  const listeners: Record<string, Set<(p: unknown) => void>> = {};
  const invokeSpy = vi.fn((channel: string, payload?: unknown) => {
    const handler = mock?.[channel];
    if (typeof handler === 'function') return handler(payload);
    if (channel in (mock ?? {}))
      return Promise.resolve({
        ok: true,
        data: (mock as Record<string, unknown>)[channel],
      } as const);
    // 默认响应
    if (channel === 'settings:getAll')
      return Promise.resolve({ ok: true, data: defaultGlobalSettings() } as const);
    if (channel === 'settings:search')
      return Promise.resolve({ ok: true, data: [] as SettingSearchEntry[] } as const);
    if (channel === 'settings:setShortcuts') {
      const payload = payload as { shortcuts: unknown };
      return Promise.resolve({ ok: true, data: payload.shortcuts } as const);
    }
    if (channel === 'app:getInfo') {
      return Promise.resolve({
        ok: true,
        data: {
          version: '0.0.0-test',
          platform: 'test',
          arch: 'arm64',
          isPackaged: false,
          electronVersion: '30.0.0',
        },
      } as const);
    }
    return Promise.resolve({ ok: true, data: null } as const);
  });
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: invokeSpy,
    on: (channel: string, cb: (payload: unknown) => void) => {
      const set = listeners[channel] ?? new Set();
      set.add(cb);
      listeners[channel] = set;
      return () => set.delete(cb);
    },
  };
  const emit = (channel: string, payload: unknown) =>
    listeners[channel]?.forEach((cb) => cb(payload));
  return { invokeSpy, emit };
}

beforeEach(() => {
  useSettingsStore.setState({ global: null, vault: null, loading: false, error: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function mountAndLoad(): Promise<void> {
  await act(async () => {
    root.render(<SettingsPage />);
    await tick(50);
  });
}

describe('SettingsPage 搜索', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('渲染搜索输入框（可访问）', async () => {
    installBridge();
    await act(async () => {
      root.render(<SettingsPage />);
      await vi.advanceTimersByTimeAsync(100);
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-search-input"]',
    );
    expect(input).toBeTruthy();
    expect(input?.getAttribute('aria-label')).toBe('搜索设置');
    expect(input?.type).toBe('search');
  });

  it('输入查询后调用 settings:search 并展示结果', async () => {
    const entries: SettingSearchEntry[] = [
      {
        id: 'appearance.theme',
        sectionId: 'general',
        title: '主题',
        keywords: ['theme'],
        scope: 'global',
      },
      {
        id: 'shortcuts.list',
        sectionId: 'shortcuts',
        title: '快捷键',
        keywords: ['shortcut'],
        scope: 'global',
      },
    ];
    const { invokeSpy } = installBridge({ 'settings:search': entries });
    await act(async () => {
      root.render(<SettingsPage />);
      await vi.advanceTimersByTimeAsync(100);
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-search-input"]',
    )!;
    // 直接设置 React 状态的代理：触发输入事件 + 推进时间
    await act(async () => {
      typeInto(input, '主题');
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(invokeSpy).toHaveBeenCalledWith('settings:search', { query: '主题' });
    const results = container.querySelector('[data-testid="settings-search-results"]');
    expect(results).toBeTruthy();
    expect(results?.textContent).toContain('主题');
    expect(results?.textContent).toContain('快捷键');
  });

  it('空查询不展示结果区；无结果时展示空状态', async () => {
    installBridge();
    await act(async () => {
      root.render(<SettingsPage />);
      await vi.advanceTimersByTimeAsync(100);
    });
    // 初始空查询不展示结果区
    expect(container.querySelector('[data-testid="settings-search-results"]')).toBeFalsy();
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-search-input"]',
    )!;
    await act(async () => {
      typeInto(input, 'zzzznoresult');
      await vi.advanceTimersByTimeAsync(200);
    });
    const results = container.querySelector('[data-testid="settings-search-results"]');
    expect(results?.textContent).toContain('没有找到');
  });

  it('搜索失败时展示错误提示', async () => {
    installBridge({
      'settings:search': () => Promise.reject(new Error('boom')),
    });
    await act(async () => {
      root.render(<SettingsPage />);
      await vi.advanceTimersByTimeAsync(100);
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-search-input"]',
    )!;
    await act(async () => {
      typeInto(input, 'x');
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('点击搜索结果跳转到对应分区', async () => {
    const entries: SettingSearchEntry[] = [
      {
        id: 'shortcuts.list',
        sectionId: 'shortcuts',
        title: '快捷键',
        keywords: ['shortcut'],
        scope: 'global',
      },
    ];
    installBridge({ 'settings:search': entries });
    await act(async () => {
      root.render(<SettingsPage />);
      await vi.advanceTimersByTimeAsync(100);
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-search-input"]',
    )!;
    await act(async () => {
      typeInto(input, 'shortcut');
      await vi.advanceTimersByTimeAsync(200);
    });
    const result = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-search-result-shortcuts.list"]',
    );
    expect(result).toBeTruthy();
    await act(async () => {
      result!.click();
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(container.querySelector('[data-testid="settings-section-shortcuts"]')).toBeTruthy();
  });
});

describe('快捷键设置可编辑', () => {
  async function openShortcuts(): Promise<void> {
    await mountAndLoad();
    const navBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-nav-shortcuts"]',
    )!;
    await act(async () => {
      navBtn.click();
      await tick(20);
    });
  }

  it('每个快捷键行都有输入框和启停切换开关', async () => {
    installBridge();
    await openShortcuts();
    const inputs = container.querySelectorAll('[id^="shortcut-"]');
    expect(inputs.length).toBeGreaterThan(0);
    const toggles = container.querySelectorAll('[role="switch"]');
    expect(toggles.length).toBe(inputs.length);
  });

  it('点击开关切换禁用状态并通过 settings:setShortcuts 保存', async () => {
    const { invokeSpy } = installBridge();
    await openShortcuts();
    const firstToggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => {
      firstToggle.click();
      await tick(20);
    });
    expect(invokeSpy).toHaveBeenCalledWith(
      'settings:setShortcuts',
      expect.objectContaining({
        shortcuts: expect.arrayContaining([
          expect.objectContaining({ commandId: 'app.palette', disabled: true }),
        ]),
      }),
    );
  });

  it('保留导入/导出按钮', async () => {
    installBridge();
    await openShortcuts();
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent?.trim() ?? '',
    );
    expect(buttons.some((t) => t.includes('导入'))).toBe(true);
    expect(buttons.some((t) => t.includes('导出'))).toBe(true);
  });

  it('settings:changed 事件同步到 settings store', async () => {
    const { emit } = installBridge();
    const unsubscribe = subscribeSettingsChanges();
    await mountAndLoad();
    const before = useSettingsStore.getState().global;
    expect(before).toBeTruthy();
    await act(async () => {
      const next = defaultGlobalSettings();
      next.git.useSystemGit = true;
      emit('settings:changed', { global: next, vault: null });
      await tick(0);
    });
    expect(useSettingsStore.getState().global?.git.useSystemGit).toBe(true);
    unsubscribe();
  });
});
