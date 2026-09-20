// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultGlobalSettings, type SettingSearchEntry } from '@nexnote/shared';
import '../src/features/settings';
import { SettingsPage } from '../src/pages/SettingsPage';
import { UpdateSettingsSection } from '../src/features/settings/update-section';
import { useSettingsNav } from '../src/lib/open-settings';
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
    if (channel === 'app:getUpdateSettings') {
      return Promise.resolve({
        ok: true,
        data: { channel: 'stable', autoDownload: true, checkOnLaunch: true },
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
  useSettingsNav.setState({ activeId: null });
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

describe('更新设置', () => {
  it('错误状态显示区分检查与下载的恢复路径', async () => {
    const { emit } = installBridge();
    await act(async () => {
      root.render(<UpdateSettingsSection />);
      await tick(20);
    });
    await act(async () => {
      emit('app:updateStatus', {
        status: 'error',
        message: '下载失败',
        channel: 'stable',
        retry: 'download',
      });
      await tick(0);
    });
    expect(container.textContent).toContain('重试下载');
    expect(container.textContent).toContain('下载失败，可重试下载。');
    emit('app:updateStatus', {
      status: 'error',
      message: '检查失败',
      channel: 'stable',
      retry: 'check',
    });
    await act(async () => tick(0));
    expect(container.textContent).toContain('重新检查');
    expect(container.textContent).toContain('检查失败，可重新检查更新。');
  });

  it('从主进程加载更新设置并显示单一权威', async () => {
    const { invokeSpy } = installBridge();
    await act(async () => {
      root.render(<UpdateSettingsSection />);
      await tick(20);
    });
    expect(container.querySelector('[data-testid="update-settings"]')).toBeTruthy();
    expect(invokeSpy).toHaveBeenCalledWith('app:getUpdateSettings', undefined);
    expect(container.textContent).toContain('所有更新设置保存在主进程');
  });
});

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

describe('术语统一「知识库」（DEV-021）', () => {
  it('常规分区用户可见文案不含 vault / Vault 字样', async () => {
    installBridge();
    await mountAndLoad();
    const navBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-nav-general"]',
    )!;
    await act(async () => {
      navBtn.click();
      await tick(20);
    });
    const copy = container.textContent ?? '';
    expect(copy, copy).not.toMatch(/vault/i);
    expect(copy).toContain('恢复上次知识库');
    expect(copy).toContain('打开特定知识库');
  });

  it('关于分区数据说明改称知识库目录', async () => {
    installBridge();
    await mountAndLoad();
    const navBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-nav-about"]',
    )!;
    await act(async () => {
      navBtn.click();
      await tick(20);
    });
    const copy = container.textContent ?? '';
    expect(copy).toContain('所有数据保存在本地知识库目录中。');
    expect(copy).not.toMatch(/vault/i);
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
describe('DEV-066 设置页 Toggle 视觉修复', () => {
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

  it('开关轨道约束 thumb 不外溢：轨道 overflow-hidden，thumb 深色模式下可读（bg-background）', async () => {
    installBridge();
    await openShortcuts();
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.className).toContain('overflow-hidden');
    const thumb = toggle.querySelector('span[aria-hidden="true"]')!;
    expect(thumb).toBeTruthy();
    expect(thumb.className).toContain('bg-background');
    expect(thumb.className).toContain('shadow-sm');
  });

  it('保留 role=switch 与 aria-checked 语义，点击触发 setShortcuts 持久化', async () => {
    const { invokeSpy } = installBridge();
    await openShortcuts();
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.hasAttribute('aria-checked')).toBe(true);
    await act(async () => {
      toggle.click();
      await tick(20);
    });
    expect(invokeSpy).toHaveBeenCalledWith(
      'settings:setShortcuts',
      expect.objectContaining({ shortcuts: expect.any(Array) }),
    );
  });
});
