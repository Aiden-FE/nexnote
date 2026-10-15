// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsSection } from '../src/features/ai/AiSettingsSection';
import { useAiConfig } from '../src/features/ai/ai-config';
import { setLanguage } from '../src/lib/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;
let eventListener: ((payload: unknown) => void) | null = null;
const invokeSpy = vi.fn();

beforeEach(() => {
  setLanguage('en-US');
  eventListener = null;
  invokeSpy.mockImplementation((channel: string) => {
    if (channel === 'ai:cancelRetrievalBuild') {
      return Promise.resolve({ ok: true, data: { cancelled: true } });
    }
    return Promise.resolve({ ok: true, data: null });
  });
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: invokeSpy,
    on: (_channel: string, listener: (payload: unknown) => void) => {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
  };
  useAiConfig.setState({
    state: {
      profiles: [],
      defaultProfileId: null,
      features: { writing: null, translation: null, chat: null, embedding: null },
      translationTargetLanguage: 'English',
      needsOnboarding: false,
      setupPromptDismissed: true,
      embeddingFingerprint: null,
      embeddingGeneration: 0,
    },
    loading: false,
  });
});

afterEach(() => {
  setLanguage('zh-CN');
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('DEV-121 semantic retrieval index status', () => {
  it('renders block progress and cancels through the typed IPC channel', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(<AiSettingsSection />));
    expect(document.querySelector('[data-testid="ai-retrieval-index-status"]')).toBeNull();

    await act(async () => {
      eventListener?.({
        status: {
          phase: 'building',
          mode: 'full',
          blocksDone: 12,
          blocksTotal: 48,
          model: 'multilingual-e5-small',
        },
      });
      await Promise.resolve();
    });
    expect(
      document.querySelector('[data-testid="ai-retrieval-index-phase"]')?.textContent,
    ).toContain('Building');
    const progress = document.querySelector<HTMLProgressElement>(
      '[data-testid="ai-retrieval-index-progress"]',
    );
    expect(progress?.value).toBe(12);
    expect(progress?.max).toBe(48);

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="ai-retrieval-index-cancel"]')
        ?.click();
    });
    expect(invokeSpy.mock.calls.some(([channel]) => channel === 'ai:cancelRetrievalBuild')).toBe(
      true,
    );
  });
});
