// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfigState, AiConnectionTarget, AiProfileView } from '@nexnote/shared';
import { AiSettingsSection } from '../src/features/ai/AiSettingsSection';
import { AiSetupWizard } from '../src/features/ai/AiSetupWizard';
import { useAiConfig, useAiWizard } from '../src/features/ai/ai-config';
import {
  clearModelCandidatesCache,
  fetchModelCandidates,
  modelCandidateCacheKey,
  modelCandidateTarget,
  peekModelCandidates,
  pruneModelCandidatesCache,
} from '../src/features/ai/model-candidates';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function profile(overrides: Partial<AiProfileView> = {}): AiProfileView {
  return {
    id: 'p1',
    name: 'Mock',
    kind: 'openai-compatible',
    baseUrl: 'https://a.example.com/v1',
    defaultModel: 'gpt-x',
    params: {},
    hasApiKey: false,
    keyStorage: 'system-credential',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function state(p: AiProfileView, overrides: Partial<AiConfigState> = {}): AiConfigState {
  return {
    profiles: [p],
    defaultProfileId: p.id,
    features: {
      writing: { profileId: p.id, model: p.defaultModel },
      translation: null,
      chat: null,
      embedding: null,
    },
    translationTargetLanguage: 'English',
    needsOnboarding: false,
    setupPromptDismissed: false,
    embeddingFingerprint: null,
    embeddingGeneration: 0,
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement;
let aiState: AiConfigState;
let invokeSpy: ReturnType<typeof vi.fn>;

function installBridge(): void {
  invokeSpy = vi.fn(() => Promise.resolve({ ok: true, data: null }));
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: invokeSpy,
    on: () => () => undefined,
  };
}

function mockModels(models: string[]): void {
  invokeSpy.mockImplementation((channel: string) => {
    if (channel === 'ai:listModels') return Promise.resolve({ ok: true, data: { models } });
    if (channel === 'ai:getState') return Promise.resolve({ ok: true, data: aiState });
    return Promise.resolve({ ok: true, data: null });
  });
}

function mount(ui: React.ReactNode = <AiSettingsSection />): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

const modelInput = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>('[data-testid="ai-feature-model-writing"]')!;

/** 点击下拉箭头打开面板（测试中比 focus 事件更可靠）。 */
function openDropdown(input: HTMLInputElement): void {
  const picker = input.closest('[data-testid^="ai-model-picker-"]');
  const btn = picker?.querySelector<HTMLButtonElement>('[aria-label="展开模型列表"]');
  const panel = picker?.querySelector('[data-testid^="ai-model-dropdown-"]');
  if (panel) {
    // 已经打开，先关闭再重新打开（模拟用户重新聚焦）
    act(() => btn?.click());
  }
  act(() => btn?.click());
}

function dropdownOptionCount(input: HTMLInputElement): number {
  const picker = input.closest('[data-testid^="ai-model-picker-"]');
  if (!picker) return 0;
  const panel = picker.querySelector('[data-testid^="ai-model-dropdown-"]');
  if (!panel) return 0;
  return panel.querySelectorAll('button').length;
}

const listModelsCalls = () => invokeSpy.mock.calls.filter(([c]) => c === 'ai:listModels');

beforeEach(() => {
  clearModelCandidatesCache();
  installBridge();
  aiState = state(profile());
  useAiConfig.setState({ state: aiState, loading: false });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.body.replaceChildren();
  clearModelCandidatesCache();
  vi.clearAllMocks();
});

describe('DEV-091 分功能模型候选缓存语义', () => {
  it('空结果不写缓存：第二次拉取能拿到真实候选', async () => {
    const p = profile();
    const key = modelCandidateCacheKey(p.id, p);
    mockModels([]);
    await expect(fetchModelCandidates(p.id, p, key)).resolves.toEqual({ models: [], error: null });
    expect(peekModelCandidates(key)).toEqual([]);
    expect(listModelsCalls()).toHaveLength(1);

    // 第二次（重新聚焦 / 刷新）不得命中空缓存
    mockModels(['m-a', 'm-b']);
    await expect(fetchModelCandidates(p.id, p, key)).resolves.toEqual({
      models: ['m-a', 'm-b'],
      error: null,
    });
    expect(listModelsCalls()).toHaveLength(2);
    expect(peekModelCandidates(key)).toEqual(['m-a', 'm-b']);
  });

  it('非空结果命中缓存，不重复请求', async () => {
    const p = profile();
    const key = modelCandidateCacheKey(p.id, p);
    mockModels(['m-a']);
    await fetchModelCandidates(p.id, p, key);
    await fetchModelCandidates(p.id, p, key);
    expect(listModelsCalls()).toHaveLength(1);

    mockModels(['m-a', 'm-b']);
    await fetchModelCandidates(p.id, p, key, true); // force 刷新
    expect(listModelsCalls()).toHaveLength(2);
  });

  it('缓存键含连接签名：baseUrl / 凭据 / updatedAt 变化即换键', () => {
    const p = profile();
    expect(modelCandidateCacheKey(p.id, p)).not.toBe(
      modelCandidateCacheKey(p.id, { ...p, baseUrl: 'https://b.example.com/v1' }),
    );
    expect(modelCandidateCacheKey(p.id, p)).not.toBe(
      modelCandidateCacheKey(p.id, { ...p, updatedAt: 2 }),
    );
    expect(modelCandidateCacheKey(p.id, p)).not.toBe(
      modelCandidateCacheKey(p.id, { ...p, hasApiKey: true }),
    );
    // 尾斜杠归一化后视为同一签名
    expect(modelCandidateCacheKey(p.id, p)).toBe(
      modelCandidateCacheKey(p.id, { ...p, baseUrl: 'https://a.example.com/v1/' }),
    );
  });

  it('配置变更淘汰失效条目（旧 profile 缓存不留存）', async () => {
    const p = profile();
    const key = modelCandidateCacheKey(p.id, p);
    mockModels(['old-model']);
    await fetchModelCandidates(p.id, p, key);
    expect(peekModelCandidates(key)).toEqual(['old-model']);

    const saved = { ...p, baseUrl: 'https://b.example.com/v1', updatedAt: 2 };
    pruneModelCandidatesCache(state(saved));
    expect(peekModelCandidates(key)).toEqual([]);
    expect(peekModelCandidates(modelCandidateCacheKey(saved.id, saved))).toEqual([]);

    // 删除 profile 后其条目也不保留
    mockModels(['old-model']);
    await fetchModelCandidates(p.id, p, modelCandidateCacheKey(p.id, p));
    pruneModelCandidatesCache({ ...state(p), profiles: [] });
    expect(peekModelCandidates(modelCandidateCacheKey(p.id, p))).toEqual([]);
  });

  it('查询目标与「编辑 AI Profile」同形：candidate {kind, baseUrl, defaultModel}，渲染层不携带密钥', () => {
    const p = profile({ hasApiKey: true });
    expect(modelCandidateTarget(p.id, p)).toEqual({
      profileId: 'p1',
      candidate: {
        kind: 'openai-compatible',
        baseUrl: 'https://a.example.com/v1',
        defaultModel: 'gpt-x',
      },
    });
  });
});

describe('DEV-091 设置页分功能下拉与向导候选对齐', () => {
  it('一次空结果不会让下拉长期为空：重新聚焦可拿到候选', async () => {
    mockModels([]);
    mount();
    const input = modelInput();
    openDropdown(input);
    await act(async () => tick(20));
    expect(listModelsCalls()).toHaveLength(1);
    expect(dropdownOptionCount(input)).toBe(0);

    // 供应商此刻已可列出模型；用户再次聚焦（或点击刷新）必须重新拉取
    mockModels(['m-a', 'm-b']);
    openDropdown(input);
    await act(async () => tick(20));
    expect(listModelsCalls()).toHaveLength(2);
    expect(dropdownOptionCount(input)).toBe(2);
  });

  it('profile 保存（baseUrl/updatedAt 变化）后候选失效并按新目标重拉', async () => {
    mockModels(['a-model']);
    mount();
    const input = modelInput();
    openDropdown(input);
    await act(async () => tick(20));
    expect(dropdownOptionCount(input)).toBe(1);
    expect(listModelsCalls()[0]![1]).toEqual({
      profileId: 'p1',
      candidate: {
        kind: 'openai-compatible',
        baseUrl: 'https://a.example.com/v1',
        defaultModel: 'gpt-x',
      },
    });

    // 保存到另一个 baseUrl（与向导一致：查询目标随已保存配置走）
    const saved = profile({ baseUrl: 'https://b.example.com/v1', updatedAt: 2 });
    aiState = state(saved);
    act(() => useAiConfig.getState().apply(aiState));
    await act(async () => tick());

    mockModels(['b-model-1', 'b-model-2']);
    openDropdown(input);
    await act(async () => tick(20));
    expect(listModelsCalls()).toHaveLength(2);
    expect(listModelsCalls()[1]![1]).toEqual({
      profileId: 'p1',
      candidate: {
        kind: 'openai-compatible',
        baseUrl: 'https://b.example.com/v1',
        defaultModel: 'gpt-x',
      },
    });
    expect(dropdownOptionCount(input)).toBe(2);
  });

  it('请求失败时降级为自由输入：不弹错误、输入可用，且失败不入缓存', async () => {
    invokeSpy.mockImplementation((channel: string) => {
      if (channel === 'ai:listModels') return Promise.reject(new Error('network down'));
      return Promise.resolve({ ok: true, data: null });
    });
    mount();
    const input = modelInput();
    openDropdown(input);
    await act(async () => tick(20));
    expect(document.querySelector('[data-testid="ai-settings-notice"]')).toBeNull();
    expect(dropdownOptionCount(input)).toBe(0);

    // 失败不入缓存：下次聚焦再试一次并成功
    mockModels(['m-a']);
    openDropdown(input);
    await act(async () => tick(20));
    expect(listModelsCalls()).toHaveLength(2);
    expect(dropdownOptionCount(input)).toBe(1);
  });

  it('同一 profile：设置页下拉候选 === 「编辑 AI Profile」读到的候选', async () => {
    const upstream = ['gpt-4o-mini', 'gpt-4o', 'text-embedding-3-small'];
    // 两处都指向同一供应商实时列表：settings 走 ai:listModels，wizard 走 ai:testConnection()
    const targets: AiConnectionTarget[] = [];
    invokeSpy.mockImplementation((channel: string, payload: unknown) => {
      if (channel === 'ai:listModels' || channel === 'ai:testConnection') {
        targets.push(payload as AiConnectionTarget);
        if (channel === 'ai:listModels') {
          return Promise.resolve({ ok: true, data: { models: upstream } });
        }
        return Promise.resolve({
          ok: true,
          data: {
            reachable: true,
            capabilities: { chat: true, streaming: true, embeddings: true, tools: true },
            models: upstream,
            latencyMs: 1,
          },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    // 1) 设置页分功能下拉
    mount();
    const input = modelInput();
    openDropdown(input);
    await act(async () => tick(20));
    expect(dropdownOptionCount(input)).toBe(upstream.length);

    // 2) 「编辑 AI Profile」向导读取的候选
    act(() => root?.unmount());
    container.remove();
    useAiWizard.setState({ open: true, editProfileId: 'p1' });
    mount(<AiSetupWizard />);
    await act(async () => tick(30));
    // 编辑模式起始于「连接信息」步；下一步触发测试并读出候选
    const next = document.querySelector<HTMLButtonElement>('[data-testid="ai-wizard-next"]');
    expect(next).not.toBeNull();
    act(() => next!.click());
    await act(async () => tick(30));
    const toModel = document.querySelector<HTMLButtonElement>('[data-testid="ai-wizard-to-model"]');
    expect(toModel).not.toBeNull();
    act(() => toModel!.click());
    const chips = [...document.querySelectorAll('[data-testid="ai-wizard-model"] button')].map(
      (b) => b.textContent,
    );
    expect(chips).toEqual(upstream.slice(0, 12));

    // 3) 两处的查询目标同形（同一 kind/baseUrl/defaultModel）
    expect(targets.length).toBeGreaterThanOrEqual(2);
    const [settingsTarget, wizardTarget] = targets;
    expect(settingsTarget!.candidate).toEqual(wizardTarget!.candidate);
    expect(settingsTarget!.profileId).toBe('p1');
  });
});
