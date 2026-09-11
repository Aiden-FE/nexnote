// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { RetrievalResponse } from '@nexnote/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const invokeMock = vi.fn();
vi.mock('../src/lib/ipc', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
import { RetrievalSources } from '../src/features/ai/retrieval/RetrievalSources';
import { useTabStore } from '../src/stores/tab-store';

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

const response: RetrievalResponse = {
  query: '咖啡',
  degraded: false,
  model: 'fake-1',
  contextText: '上下文',
  sources: [
    {
      path: 'coffee.md',
      title: '咖啡',
      blockId: 'b1',
      blockType: 'paragraph',
      snippet: '咖啡风味',
      score: 5,
      vectorSim: 0.82,
      confidenceScore: 78,
      via: 'vector',
    },
    {
      path: 'tea.md',
      title: '茶',
      blockId: null,
      blockType: 'paragraph',
      snippet: '茶也有风味',
      score: 1,
      vectorSim: null,
      confidenceScore: null,
      via: 'links',
    },
  ],
  stages: [
    { stage: 'fts', candidates: 12, elapsedMs: 3, enabled: true },
    { stage: 'links', candidates: 4, elapsedMs: 1, enabled: true },
    { stage: 'vector', candidates: 16, elapsedMs: 8, enabled: true },
  ],
};

describe('RetrievalSources 召回透明 UI', () => {
  it('渲染来源/相似度/置信度与三阶段统计', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<RetrievalSources response={response} />);
      await flush();
    });
    expect(container.querySelector('[data-testid="retrieval-model"]')?.textContent).toContain(
      'fake-1',
    );
    expect(container.querySelectorAll('[data-testid="retrieval-source"]')).toHaveLength(2);
    expect(container.textContent).toContain('相似度 0.82');
    expect(container.textContent).toContain('置信度 78');
    const stages = container.querySelectorAll('[data-stage]');
    expect(stages).toHaveLength(3);

    // 点击来源必须经统一路由：sidecar markdown 直接进入源码编辑器，不能挂 TipTap。
    invokeMock.mockResolvedValue({ format: 'markdown' });
    const before = useTabStore.getState().tabs.length;
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="retrieval-source"] button',
    );
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    const after = useTabStore.getState().tabs;
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      pagePath: 'coffee.md',
      format: 'markdown',
      editorMode: 'source',
    });
    expect(invokeMock).toHaveBeenCalledWith('document:getMetadata', { path: 'coffee.md' });
  });

  it('降级时显示两阶段徽标且向量阶段标注跳过', async () => {
    const degraded: RetrievalResponse = {
      ...response,
      degraded: true,
      model: null,
      stages: [
        { stage: 'fts', candidates: 9, elapsedMs: 2, enabled: true },
        { stage: 'links', candidates: 2, elapsedMs: 1, enabled: true },
        { stage: 'vector', candidates: 0, elapsedMs: 0, enabled: false, note: 'embedding 不可用' },
      ],
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<RetrievalSources response={degraded} />);
      await flush();
    });
    expect(container.querySelector('[data-testid="retrieval-degraded"]')?.textContent).toContain(
      '向量不可用',
    );
    const vectorStage = container.querySelector('[data-stage="vector"]');
    expect(vectorStage?.getAttribute('data-enabled')).toBe('0');
  });
});
