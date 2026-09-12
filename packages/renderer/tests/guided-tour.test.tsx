// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultGlobalSettings, type VaultInfo } from '@nexnote/shared';
import { GuidedTour } from '../src/tour/GuidedTour';
import { TOUR_STEPS } from '../src/tour/tour-steps';
import { useUiStore } from '../src/stores/ui-store';
import { useVaultLayoutPersistence } from '../src/shell/layout-persistence';
import { WelcomePage } from '../src/pages/WelcomePage';
import '../src/features/settings';
import { SettingsPage } from '../src/pages/SettingsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault: VaultInfo = {
  root: '/tmp/nexnote-guide-vault',
  name: 'guide-vault',
  configPath: '/tmp/nexnote-guide-vault/.nexnote/config.json',
};

let container: HTMLDivElement;
let root: Root | null = null;

function mount(ui: React.ReactNode): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

function addTourTargets(ids: string[]): void {
  for (const id of ids) {
    const el = document.createElement('div');
    el.setAttribute('data-tour', id);
    document.body.append(el);
  }
}

/** 让 happy-dom 目标拥有非零矩形（默认全 0 视为不可高亮）。 */
function fakeRect(id: string): void {
  const el = document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
  if (!el) return;
  el.getBoundingClientRect = () =>
    ({ top: 20, left: 20, width: 200, height: 120, bottom: 140, right: 220 }) as DOMRect;
}

function pressKey(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function installBridge(handlers: Record<string, (payload: unknown) => unknown>): {
  invokeSpy: ReturnType<typeof vi.fn>;
} {
  const invokeSpy = vi.fn((channel: string, payload?: unknown) => {
    const handler = handlers[channel];
    if (handler) return Promise.resolve({ ok: true, data: handler(payload) });
    return Promise.resolve({ ok: true, data: null });
  });
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: invokeSpy,
    on: () => () => undefined,
  };
  return { invokeSpy };
}

beforeEach(() => {
  container = document.createElement('div');
  useUiStore.setState({ tourOpen: false, guideCompleted: false });
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.querySelectorAll('[data-tour]').forEach((el) => el.remove());
});

describe('GuidedTour 分步导航', () => {
  it('下一步/上一步在步骤间移动，最后一步为「完成」并持久化', () => {
    addTourTargets(TOUR_STEPS.map((s) => s.id));
    mount(<GuidedTour />);
    act(() => useUiStore.getState().setTourOpen(true));

    const title = () => document.querySelector('[data-testid="tour-title"]')?.textContent ?? '';
    expect(title()).toBe(TOUR_STEPS[0].title);

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="tour-next"]')?.click();
    });
    expect(title()).toBe(TOUR_STEPS[1].title);

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="tour-prev"]')?.click();
    });
    expect(title()).toBe(TOUR_STEPS[0].title);

    for (let i = 0; i < TOUR_STEPS.length - 1; i += 1) {
      act(() => {
        document.querySelector<HTMLButtonElement>('[data-testid="tour-next"]')?.click();
      });
    }
    const nextButton = document.querySelector<HTMLButtonElement>('[data-testid="tour-next"]');
    expect(nextButton?.textContent).toBe('完成');

    act(() => nextButton?.click());
    const state = useUiStore.getState();
    expect(state.tourOpen).toBe(false);
    expect(state.guideCompleted).toBe(true);
    expect(document.querySelector('[data-testid="guided-tour"]')).toBeNull();
  });

  it('跳过引导：关闭浮层并持久化 guideCompleted', () => {
    mount(<GuidedTour />);
    act(() => useUiStore.getState().setTourOpen(true));
    expect(document.querySelector('[data-testid="guided-tour"]')).not.toBeNull();

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="tour-skip"]')?.click();
    });
    const state = useUiStore.getState();
    expect(state.tourOpen).toBe(false);
    expect(state.guideCompleted).toBe(true);
    expect(document.querySelector('[data-testid="guided-tour"]')).toBeNull();
  });

  it('Esc 结束引导并持久化', () => {
    mount(<GuidedTour />);
    act(() => useUiStore.getState().setTourOpen(true));
    pressKey('Escape');
    expect(useUiStore.getState().tourOpen).toBe(false);
    expect(useUiStore.getState().guideCompleted).toBe(true);
  });

  it('键盘：→ / Enter 前进，← 后退', () => {
    addTourTargets(TOUR_STEPS.map((s) => s.id));
    mount(<GuidedTour />);
    act(() => useUiStore.getState().setTourOpen(true));

    const title = () => document.querySelector('[data-testid="tour-title"]')?.textContent ?? '';
    pressKey('ArrowRight');
    expect(title()).toBe(TOUR_STEPS[1].title);
    pressKey('ArrowLeft');
    expect(title()).toBe(TOUR_STEPS[0].title);
    pressKey('Enter');
    expect(title()).toBe(TOUR_STEPS[1].title);
  });

  it('重播时从第一步开始', async () => {
    addTourTargets(TOUR_STEPS.map((s) => s.id));
    mount(<GuidedTour />);
    act(() => useUiStore.getState().setTourOpen(true));
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="tour-next"]')?.click();
    });
    act(() => useUiStore.getState().setTourOpen(false));
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    act(() => useUiStore.getState().setTourOpen(true));
    const title = document.querySelector('[data-testid="tour-title"]')?.textContent ?? '';
    expect(title).toBe(TOUR_STEPS[0].title);
  });
});

describe('GuidedTour 目标定位与降级', () => {
  it('目标存在且非零尺寸时渲染 spotlight 高亮', async () => {
    addTourTargets(['page-tree']);
    fakeRect('page-tree');
    mount(<GuidedTour />);
    act(() => useUiStore.getState().setTourOpen(true));
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(document.querySelector('[data-testid="tour-spotlight"]')).not.toBeNull();
  });

  it('目标缺失时优雅降级：仍显示卡片，无 spotlight', () => {
    mount(<GuidedTour />);
    act(() => useUiStore.getState().setTourOpen(true));
    expect(document.querySelector('[data-testid="guided-tour"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="tour-card"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="tour-spotlight"]')).toBeNull();
  });

  it('目标尺寸为 0（隐藏元素）时同样降级', () => {
    addTourTargets(['ai-dock']);
    mount(<GuidedTour />);
    act(() => useUiStore.getState().setTourOpen(true));
    expect(document.querySelector('[data-testid="tour-spotlight"]')).toBeNull();
    expect(document.querySelector('[data-testid="tour-card"]')).not.toBeNull();
  });

  it('文案面向用户，不含票据或开发词汇', () => {
    for (const step of TOUR_STEPS) {
      expect(`${step.title}${step.description}`).not.toMatch(/DEV-\d+/);
      expect(`${step.title}${step.description}`).not.toContain('票据');
      expect(step.description.split('。').filter(Boolean).length).toBeLessThanOrEqual(2);
    }
  });
});

describe('guideCompleted 持久化链路', () => {
  it('旧配置缺省 guideCompleted（layout=null）→ 首次进入自动弹出', async () => {
    installBridge({
      'vault:getLayout': () => null,
    });
    mount(
      <TestHarness>
        <GuidedTour />
      </TestHarness>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useUiStore.getState().tourOpen).toBe(true);
  });

  it('guideCompleted=true 时不再自动弹出', async () => {
    installBridge({
      'vault:getLayout': () => ({ guideCompleted: true }),
    });
    mount(<TestHarness />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useUiStore.getState().tourOpen).toBe(false);
  });

  it('完成引导后 guideCompleted 经防抖写回 vault 布局', async () => {
    vi.useFakeTimers();
    try {
      const { invokeSpy } = installBridge({
        'vault:getLayout': () => null,
      });
      mount(<TestHarness />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      expect(useUiStore.getState().tourOpen).toBe(true);

      act(() => useUiStore.getState().completeTour());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      const saveCall = invokeSpy.mock.calls.find(([channel]) => channel === 'vault:saveLayout');
      expect(saveCall).toBeTruthy();
      const layout = (saveCall?.[1] as { layout: { guideCompleted: boolean } }).layout;
      expect(layout.guideCompleted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('重播入口', () => {
  it('欢迎页「快速上手」打开引导', () => {
    installBridge({
      'app:getInfo': () => ({ version: '0.0.0-test', platform: 'test' }),
    });
    mount(<WelcomePage />);
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="welcome-start-tour"]')?.click();
    });
    expect(useUiStore.getState().tourOpen).toBe(true);
  });

  it('设置页「新手引导 → 重新播放」打开引导', async () => {
    installBridge({
      'settings:getAll': () => defaultGlobalSettings(),
      'app:getInfo': () => ({ version: '0.0.0-test', platform: 'test' }),
    });
    mount(<SettingsPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const nav = document.querySelector('[data-testid="settings-nav-general"]') as HTMLButtonElement;
    act(() => nav?.click());
    const replay = document.querySelector(
      '[data-testid="settings-replay-tour"]',
    ) as HTMLButtonElement;
    expect(replay).toBeTruthy();
    act(() => replay.click());
    expect(useUiStore.getState().tourOpen).toBe(true);
  });
});

/** 挂载 useVaultLayoutPersistence 的最小宿主组件。 */
function TestHarness({ children }: { children?: React.ReactNode }) {
  useVaultLayoutPersistence(vault);
  return <>{children}</>;
}
