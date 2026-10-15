// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuiltInEmbeddingStatus } from '@nexnote/shared';
import { AiSetupWizard } from '../src/features/ai/AiSetupWizard';
import { useAiConfig, useAiWizard } from '../src/features/ai/ai-config';
import { setLanguage } from '../src/lib/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function status(downloaded: boolean): BuiltInEmbeddingStatus {
  return {
    identity: 'model@revision:int8:384:cosine',
    model: 'Xenova/multilingual-e5-small',
    revision: '761b726d',
    dtype: 'int8',
    dimensions: 384,
    metric: 'cosine',
    license: 'MIT',
    rolePrefixes: { query: 'query: ', passage: 'passage: ' },
    directory: '/tmp/model',
    files: [],
    downloaded,
    downloading: false,
    loaded: downloaded,
  };
}

let container: HTMLDivElement;
let root: Root | null = null;
let downloaded = false;
let eventListener: ((payload: unknown) => void) | null = null;
const invokeSpy = vi.fn();

function mount(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<AiSetupWizard />));
}

async function wait(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

beforeEach(() => {
  setLanguage('en-US');
  downloaded = false;
  eventListener = null;
  invokeSpy.mockImplementation((channel: string) => {
    if (channel === 'ai:builtInEmbedding:status') {
      return Promise.resolve({ ok: true, data: status(downloaded) });
    }
    if (channel === 'ai:builtInEmbedding:download') {
      return Promise.resolve({ ok: true, data: { started: true } });
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
  useAiConfig.setState({ state: null, loading: false });
  useAiWizard.setState({ open: true, editProfileId: null });
});

afterEach(() => {
  setLanguage('zh-CN');
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('DEV-121 built-in semantic embedding wizard', () => {
  it('requires an explicit pinned download and streams byte progress', async () => {
    mount();
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="ai-wizard-preset-local-embedding"]')
        ?.click();
    });
    await wait();

    expect(
      document.querySelector('[data-testid="ai-wizard-local-embedding-status"]')?.textContent,
    ).toContain('Not downloaded');
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="ai-wizard-next"]')?.disabled,
    ).toBe(true);

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="ai-wizard-local-embedding-download"]')
        ?.click();
    });
    expect(
      invokeSpy.mock.calls.some(([channel]) => channel === 'ai:builtInEmbedding:download'),
    ).toBe(true);

    act(() => {
      eventListener?.({
        phase: 'downloading',
        file: 'model.onnx',
        downloadedBytes: 25,
        totalBytes: 100,
        done: false,
      });
    });
    const progress = document.querySelector<HTMLProgressElement>(
      '[data-testid="ai-wizard-local-embedding-progress"]',
    );
    expect(progress?.value).toBe(25);
    expect(progress?.max).toBe(100);
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="ai-wizard-next"]')?.disabled,
    ).toBe(true);

    downloaded = true;
    await act(async () => {
      eventListener?.({ phase: 'ready', identity: 'model@revision:int8:384:cosine' });
      await Promise.resolve();
    });
    await wait();
    expect(
      document.querySelector('[data-testid="ai-wizard-local-embedding-status"]')?.textContent,
    ).toContain('Ready');
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="ai-wizard-next"]')?.disabled,
    ).toBe(false);
  });
});
