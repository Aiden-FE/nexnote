// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfigState, VaultInfo } from '@nexnote/shared';
import { AiDockPanel } from '../src/features/ai/AiDockPanel';
import { AiSettingsSection } from '../src/features/ai/AiSettingsSection';
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
    features: { writing: null, translation: null, chat: null, embedding: null },
    translationTargetLanguage: 'English',
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
    if (channel === 'ai:translation:setTargetLanguage') {
      return Promise.resolve({ ok: true, data: { state: aiState } });
    }
    if (channel === 'ai:features:set') {
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

  it('AI 设置提供独立翻译 Profile 与持久化默认目标语言', async () => {
    aiState = state({
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
    });
    useAiConfig.setState({ state: aiState, loading: false });
    mount(<AiSettingsSection />);
    expect(document.querySelector('[data-testid="ai-feature-profile-translation"]')).not.toBeNull();
    const target = document.querySelector<HTMLSelectElement>(
      '[data-testid="ai-translation-target-language"]',
    )!;
    target.value = '日本語';
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await act(async () => tick());
    expect(invokeSpy).toHaveBeenCalledWith('ai:translation:setTargetLanguage', {
      targetLanguage: '日本語',
    });
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

describe('DEV-075 分功能指定模型：自由输入 + 下拉双模式', () => {
  function mountWithAssignment(): void {
    aiState = state({
      profiles: [
        {
          id: 'p1',
          name: 'Mock',
          kind: 'openai-compatible',
          baseUrl: 'https://example.com/v1',
          defaultModel: 'gpt-x',
          params: {},
          hasApiKey: false,
          keyStorage: 'system-credential',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      features: {
        ...state().features,
        writing: { profileId: 'p1', model: 'gpt-x' },
      },
      needsOnboarding: false,
    });
    useAiConfig.setState({ state: aiState, loading: false });
    mount(<AiSettingsSection />);
  }

  const nativeInputSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;

  it('逐字符输入不触发 ai:features:set；blur 才提交', async () => {
    mountWithAssignment();
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="ai-feature-model-writing"]',
    )!;
    expect(input).not.toBeNull();
    // 逐字符输入
    act(() => {
      if (nativeInputSetter) {
        nativeInputSetter.call(input, 'gpt-x-turbo');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await act(async () => tick());
    expect(invokeSpy).not.toHaveBeenCalledWith('ai:features:set', expect.anything());
    // 触发 commit：blur 在 happy-dom 下不触发 React onBlur；Enter 走同一 commit 函数
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    await act(async () => tick());
    expect(invokeSpy).toHaveBeenCalledWith('ai:features:set', {
      feature: 'writing',
      assignment: { profileId: 'p1', model: 'gpt-x-turbo' },
    });
  });

  it('聚焦拉取候选（datalist 挂载），失败静默降级为自由输入', async () => {
    // 成功路径
    invokeSpy.mockImplementation((channel: string) => {
      if (channel === 'ai:listModels') {
        return Promise.resolve({
          ok: true,
          data: { models: ['m-a', 'm-b'] },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });
    mountWithAssignment();
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="ai-feature-model-writing"]',
    )!;
    // React 监听 focusin；调用 .focus() 让 React onFocus 触发
    act(() => input.focus());
    await act(async () => tick(20));
    const listId = input.getAttribute('list');
    expect(listId).toBeTruthy();
    const datalist = listId ? document.getElementById(listId) : null;
    expect(datalist).not.toBeNull();
    const options = datalist!.getElementsByTagName('option');
    expect(options.length).toBe(2);
    // ai:listModels 被调用过一次（缓存 + 同一 profile 不重复拉取）
    expect(invokeSpy.mock.calls.filter(([c]) => c === 'ai:listModels')).toHaveLength(1);

    // 失败路径（换 profileId，缓存未命中；新组件实例）
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
    aiState = {
      ...aiState,
      profiles: [{ ...aiState.profiles[0]!, id: 'p2' }],
      features: {
        ...aiState.features,
        writing: { profileId: 'p2', model: 'gpt-x' },
      },
    };
    useAiConfig.setState({ state: aiState, loading: false });
    invokeSpy.mockImplementation((channel: string) => {
      if (channel === 'ai:listModels') return Promise.reject(new Error('network down'));
      return Promise.resolve({ ok: true, data: null });
    });
    mount(<AiSettingsSection />);
    const input2 = document.querySelector<HTMLInputElement>(
      '[data-testid="ai-feature-model-writing"]',
    )!;
    act(() => input2.focus());
    await act(async () => tick(20));
    // 失败时不弹错误提示，自由输入仍然可用
    expect(document.querySelector('[data-testid="ai-settings-notice"]')).toBeNull();
    expect(input2).not.toBeNull();
  });

  it('Enter 提交；值未变化时不重复提交', async () => {
    mountWithAssignment();
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="ai-feature-model-writing"]',
    )!;
    // Enter 提交新值
    act(() => {
      if (nativeInputSetter) {
        nativeInputSetter.call(input, 'gpt-new');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    await act(async () => tick());
    expect(invokeSpy).toHaveBeenCalledWith('ai:features:set', {
      feature: 'writing',
      assignment: { profileId: 'p1', model: 'gpt-new' },
    });
    // 值未变化时 Enter 不重复提交
    const callsBefore = invokeSpy.mock.calls.filter(
      ([channel]) => channel === 'ai:features:set',
    ).length;
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    await act(async () => tick());
    const callsAfter = invokeSpy.mock.calls.filter(
      ([channel]) => channel === 'ai:features:set',
    ).length;
    expect(callsAfter).toBe(callsBefore);
  });
});
