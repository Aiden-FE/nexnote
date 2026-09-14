// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfigState, VaultInfo } from '@nexnote/shared';
import { AiDockPanel } from '../src/features/ai/AiDockPanel';
import { shouldAutoShowSetupPrompt, useAiConfig, useAiWizard } from '../src/features/ai/ai-config';
import { useSettingsNav } from '../src/lib/open-settings';
import { VaultContext } from '../src/shell/vault-context';
import { useTabStore } from '../src/stores/tab-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault: VaultInfo = {
  root: '/tmp/nexnote-ai-entry-vault',
  name: 'ai-entry-vault',
  configPath: '/tmp/nexnote-ai-entry-vault/.nexnote/config.json',
};

function state(overrides: Partial<AiConfigState> = {}): AiConfigState {
  return {
    profiles: [],
    defaultProfileId: null,
    features: { writing: null, chat: null, embedding: null },
    needsOnboarding: true,
    setupPromptDismissed: false,
    embeddingFingerprint: null,
    embeddingGeneration: 0,
    ...overrides,
  };
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let root: Root | null = null;
let container: HTMLDivElement;
let aiState: AiConfigState;
let invokeSpy: ReturnType<typeof vi.fn>;

function installBridge(): void {
  invokeSpy = vi.fn((channel: string) => {
    if (channel === 'ai:getState') return Promise.resolve({ ok: true, data: aiState });
    if (channel === 'ai:setupPrompt:dismiss') {
      aiState = { ...aiState, setupPromptDismissed: true };
      return Promise.resolve({ ok: true, data: { state: aiState } });
    }
    return Promise.resolve({ ok: true, data: null });
  });
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: invokeSpy,
    on: () => () => undefined,
  };
}

function mount(ui: React.ReactNode): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

beforeEach(() => {
  aiState = state();
  installBridge();
  useAiConfig.setState({ state: null, loading: false });
  useAiWizard.setState({ open: false, editProfileId: null });
  useSettingsNav.setState({ activeId: null });
  useTabStore.setState({
    tabs: [{ id: 'welcome', kind: 'welcome', title: '欢迎', createdAt: 1 }],
    activeTabId: 'welcome',
  });
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.body.replaceChildren();
});

describe('DEV-026 AI 配置入口收口', () => {
  it('区分未配置空态与首启自动提示判定', () => {
    expect(shouldAutoShowSetupPrompt(null)).toBe(false);
    expect(shouldAutoShowSetupPrompt(state())).toBe(true);
    expect(shouldAutoShowSetupPrompt(state({ setupPromptDismissed: true }))).toBe(false);
    expect(
      shouldAutoShowSetupPrompt(
        state({
          profiles: [
            {
              id: 'p1',
              name: 'Mock',
              kind: 'openai-compatible',
              baseUrl: 'https://example.com/v1',
              defaultModel: 'm',
              params: {},
              hasApiKey: false,
              keyStorage: 'system-credential',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          needsOnboarding: false,
        }),
      ),
    ).toBe(false);
  });

  it('右栏未配置入口直接打开设置页 AI 分区', async () => {
    useAiConfig.setState({ state: aiState, loading: false });
    mount(<AiDockPanel />);
    await act(async () => tick());

    const button = document.querySelector<HTMLButtonElement>('[data-testid="ai-dock-configure"]');
    expect(button).not.toBeNull();
    act(() => button!.click());

    expect(useSettingsNav.getState().activeId).toBe('ai');
    const active = useTabStore
      .getState()
      .tabs.find((tab) => tab.id === useTabStore.getState().activeTabId);
    expect(active?.kind).toBe('settings');
    expect(document.querySelector('[data-testid="ai-wizard"]')).toBeNull();
  });

  it('vault 首次就绪且未跳过时自动弹一次；关闭后持久化且切换 vault 不重弹', async () => {
    const { AiGlobalLayer } = await import('../src/features/ai');
    mount(
      <VaultContext.Provider value={vault}>
        <AiGlobalLayer />
      </VaultContext.Provider>,
    );
    await act(async () => tick(10));
    expect(document.querySelector('[data-testid="ai-wizard"]')).not.toBeNull();

    act(() => useAiWizard.getState().close());
    await act(async () => tick());
    expect(invokeSpy).toHaveBeenCalledWith('ai:setupPrompt:dismiss', undefined);
    expect(useAiConfig.getState().state?.setupPromptDismissed).toBe(true);

    const otherVault = { ...vault, root: '/tmp/other-vault', name: 'other' };
    act(() => {
      root!.render(
        <VaultContext.Provider value={otherVault}>
          <AiGlobalLayer />
        </VaultContext.Provider>,
      );
    });
    await act(async () => tick());
    expect(document.querySelector('[data-testid="ai-wizard"]')).toBeNull();
  });
});
