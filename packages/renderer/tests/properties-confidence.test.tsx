import { describe, expect, it } from 'vitest';
// @vitest-environment happy-dom
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ConfidenceResult } from '@nexnote/shared';
import { PropertiesPanel } from '../src/features/frontmatter/PropertiesPanel';

const confidence: ConfidenceResult = {
  pageId: 12,
  path: 'target.md',
  score: 68,
  computedAt: '2026-01-01T00:00:00.000Z',
  factors: [
    { key: 'stability', label: '内容稳定性', score: 0.9, weight: 0.25, contribution: 22.5, detail: '近期改动很小' },
    { key: 'review_count', label: '修订次数', score: 0.5, weight: 0.15, contribution: 7.5, detail: '2 次提交' },
    { key: 'author_count', label: '作者数量', score: 0.25, weight: 0.15, contribution: 3.75, detail: '1 位作者' },
    { key: 'age', label: '文档年龄', score: 0.8, weight: 0.15, contribution: 12, detail: '365 天' },
    { key: 'link_authority', label: '链接权威度', score: 0.7, weight: 0.2, contribution: 14, detail: 'PageRank' },
    { key: 'manual_boost', label: '手动加权', score: 0.8, weight: 0.1, contribution: 8, detail: 'boost=80' },
  ],
};

describe('PropertiesPanel confidence', () => {
  it('renders the indexed score, all factor bars, and hover explanations', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PropertiesPanel
          markdown="# Target"
          data={{}}
          filePath="target.md"
          linkCounts={{ in: 1, out: 0 }}
          confidence={confidence}
        />,
      );
    });

    expect(container.textContent).toContain('68');
    expect(container.querySelectorAll('[data-testid^="confidence-factor-"]')).toHaveLength(6);
    expect(container.querySelector('[data-testid="confidence-factor-stability"]')?.getAttribute('title')).toContain('近期改动很小');
    root.unmount();
    container.remove();
  });
});
