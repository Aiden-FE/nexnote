// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfigState, AiProfileView, ConnectionTestResult } from '@nexnote/shared';
import { AiSettingsSection } from '../src/features/ai/AiSettingsSection';
import { AiSetupWizard } from '../src/features/ai/AiSetupWizard';
import { useAiConfig, useAiWizard } from '../src/features/ai/ai-config';
import { setLanguage } from '../src/lib/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile: AiProfileView = {
  id: 'profile-1',
  name: 'Mock',
  kind: 'openai-compatible',
  baseUrl: 'https://a.example.com/v1',
  defaultModel: 'gpt-x',
  params: {},
  hasApiKey: false,
  keyStorage: 'system-credential',
  createdAt: 1,
  updatedAt: 1,
};

const aiState: AiConfigState = {
  profiles: [profile],
  defaultProfileId: profile.id,
  features: {
    writing: { profileId: profile.id, model: profile.defaultModel },
    translation: null,
    chat: null,
    embedding: null,
  },
  translationTargetLanguage: 'English',
  needsOnboarding: false,
  setupPromptDismissed: false,
  embeddingFingerprint: null,
  embeddingGeneration: 0,
};

let invokeSpy: ReturnType<typeof vi.fn>;

function installBridge(): void {
  invokeSpy = vi.fn(() => Promise.resolve({ ok: true, data: null }));
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: invokeSpy,
    on: () => () => undefined,
  };
}

let container: HTMLDivElement;
let root: Root | null = null;

function mount(ui: React.ReactNode): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

async function wait(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  setLanguage('en-US');
  installBridge();
  useAiConfig.setState({ state: aiState, loading: false });
  useAiWizard.setState({ open: false, editProfileId: null });
});

afterEach(() => {
  setLanguage('zh-CN');
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.body.replaceChildren();
});

describe('ADR-0023 AI settings and wizard bilingual UI', () => {
  it('renders provider settings and capability badges in English', async () => {
    const testResult: ConnectionTestResult = {
      reachable: true,
      capabilities: { chat: true, streaming: true, embeddings: false, tools: false },
      models: [],
      latencyMs: 42,
    };
    let resolveTest: ((value: ConnectionTestResult) => void) | undefined;
    invokeSpy.mockImplementation((channel: string) =>
      channel === 'ai:testConnection'
        ? new Promise<unknown>((resolve) => {
            resolveTest = (value) => resolve(value);
          })
        : Promise.resolve({ ok: true, data: null }),
    );
    mount(<AiSettingsSection />);
    const text = container.textContent ?? '';

    expect(text).toContain('AI providers');
    expect(text).toContain('Feature model assignments');
    expect(text).toContain('Model gpt-x');
    expect(text).toContain('Follow default');
    expect(container.querySelector('[data-testid="ai-default-badge"]')?.textContent).toContain(
      'Default',
    );
    expect(
      document.querySelector<HTMLButtonElement>('[aria-label="Expand model list"]'),
    ).not.toBeNull();

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid^="ai-test-profile-"]')?.click();
    });
    await wait();
    resolveTest!({ ok: true, data: testResult });
    await wait();
    await wait();
    expect(container.textContent).toContain('Reachable · 42ms');
    expect(container.textContent).toContain('Tool calls');
    expect(container.textContent).toContain('Embeddings');

    expect(container.textContent).not.toMatch(/[一-鿿]/);
  });

  it('localizes separators in app-owned import notices while preserving profile names', async () => {
    invokeSpy.mockImplementation((channel: string) =>
      channel === 'ai:import'
        ? Promise.resolve({
            ok: true,
            data: {
              state: aiState,
              imported: 1,
              skipped: ['Alt Profile'],
            },
          })
        : Promise.resolve({ ok: true, data: null }),
    );
    mount(<AiSettingsSection />);
    const input = document.querySelector<HTMLInputElement>('[data-testid="ai-import-file"]')!;
    const file = new File(['{}'], 'profiles.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain(', skipped 1 (Alt Profile)');
    expect(container.textContent).not.toContain('、');
  });

  it('renders the setup wizard steps, provider presets, and connection fields in English', async () => {
    useAiWizard.setState({ open: true, editProfileId: null });
    mount(<AiSetupWizard />);

    expect(container.textContent).toContain('Configure AI provider');
    expect(container.textContent).toContain('OpenAI official');
    expect(container.textContent).toContain('Built-in semantic embedding');
    expect(container.textContent).not.toMatch(/[一-鿿]/);

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="ai-wizard-preset-openai"]')?.click();
    });
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain('Connection');
    expect(container.textContent).toContain('Base URL');
    expect(container.textContent).toContain('API Key');
    expect(container.textContent).toContain('Stored only in the OS keychain');
    expect(container.textContent).not.toMatch(/[一-鿿]/);
  });
});
