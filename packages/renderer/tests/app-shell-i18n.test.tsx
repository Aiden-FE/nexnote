// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, translate, type AiConfigState } from '@nexnote/shared';
import { setLanguage } from '../src/lib/i18n';
import { SplitView } from '../src/split/SplitView';
import { AiDockPanel } from '../src/features/ai/AiDockPanel';
import { useAiConfig } from '../src/features/ai/ai-config';
import { useTabStore } from '../src/stores/tab-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = (language: 'zh-CN' | 'en-US', key: string): string =>
  translate(CATALOGS[language], key, language);

function installBridge(options: { pendingVaultState?: boolean } = {}): void {
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn((channel: string) => {
      if (channel === 'vault:getState' && options.pendingVaultState) {
        return new Promise(() => undefined);
      }
      if (channel === 'ai:getState') {
        return Promise.resolve({ ok: true, data: useAiConfig.getState().state });
      }
      return Promise.resolve({ ok: true, data: null });
    }),
    on: () => () => undefined,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

function onboardingState(): AiConfigState {
  return {
    profiles: [],
    defaultProfileId: null,
    features: { writing: null, translation: null, chat: null, embedding: null },
    translationTargetLanguage: 'English',
    needsOnboarding: true,
    setupPromptDismissed: true,
    embeddingFingerprint: null,
    embeddingGeneration: 0,
  };
}

beforeEach(() => {
  installBridge();
  useTabStore.setState({ tabs: [], activeTabId: null });
  useAiConfig.setState({ state: null, loading: false });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  delete (window as unknown as { nexnote?: unknown }).nexnote;
  root = null;
  container = null;
  setLanguage('zh-CN');
});

describe('应用壳与 AI 空态双语（ADR-0023 阶段④第十一批）', () => {
  it('启动占位文案跟随界面语言', async () => {
    installBridge({ pendingVaultState: true });
    const App = (await import('../src/App')).default;
    const host = mount(<App />);

    expect(host.textContent).toContain(text('zh-CN', 'app.startup.loading'));
    act(() => setLanguage('en-US'));
    expect(host.textContent).toContain(text('en-US', 'app.startup.loading'));
    expect(host.textContent).not.toContain(text('zh-CN', 'app.startup.loading'));
  });

  it('无打开页面时空态跟随界面语言且英文无 CJK 残留', () => {
    mount(<SplitView />);

    const empty = document.querySelector('[data-testid="workspace-empty"]');
    expect(empty?.textContent).toContain(text('zh-CN', 'workspace.empty.noPage'));
    act(() => setLanguage('en-US'));
    expect(empty?.textContent).toContain(text('en-US', 'workspace.empty.noPage'));
    expect(empty?.textContent).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('AI dock 未配置空态三句文案跟随界面语言', async () => {
    useAiConfig.setState({ state: onboardingState(), loading: false });
    mount(<AiDockPanel />);
    await act(async () => {
      await Promise.resolve();
    });

    const empty = document.querySelector('[data-testid="ai-dock-empty"]');
    const welcome = document.querySelector('[data-testid="ai-dock-welcome"]');
    const configure = document.querySelector('[data-testid="ai-dock-configure"]');
    const copy = empty?.textContent ?? '';
    expect(copy).toContain(text('zh-CN', 'ai.dock.welcome'));
    expect(copy).toContain(text('zh-CN', 'ai.dock.description'));
    expect(configure?.textContent).toContain(text('zh-CN', 'ai.dock.configure'));
    expect(welcome?.textContent?.trim()).toBe(text('zh-CN', 'ai.dock.welcome'));

    act(() => setLanguage('en-US'));
    const english = empty?.textContent ?? '';
    expect(welcome?.textContent?.trim()).toBe(text('en-US', 'ai.dock.welcome'));
    expect(english).toContain(text('en-US', 'ai.dock.description'));
    expect(configure?.textContent).toContain(text('en-US', 'ai.dock.configure'));
    expect(english).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
