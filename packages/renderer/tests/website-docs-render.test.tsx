// @vitest-environment happy-dom
/** 网站文档渲染与路由契约的回归测试：渲染器在共享 vitest 环境下验证。 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DocsChapter, DocsIndex, docsCopy } from '../../../apps/website/src/docs/DocsView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: React.ReactNode): string {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  const text = container.textContent ?? '';
  const html = container.innerHTML;
  act(() => root.unmount());
  container.remove();
  return `${text}\n<!--HTML-->\n${html}`;
}

describe('website docs', () => {
  it('zh index renders chapter card linking to /zh/docs/getting-started', () => {
    const out = render(<DocsIndex lang="zh" text={docsCopy.zh} />);
    expect(out).toContain('快速上手');
    expect(out).toContain('href="/zh/docs/getting-started"');
    expect(out).toContain('适用版本 v0.0.29+');
  });
  it('en chapter renders article, sidebar, toc and pager', () => {
    const out = render(<DocsChapter lang="en" text={docsCopy.en} slug="getting-started" />);
    expect(out).toContain('Create your first wikilink');
    expect(out).toContain('<table>');
    expect(out).toContain('On this page');
    expect(out).toContain('<code>[[Page name]]</code>');
    // 标题必须渲染成真实 h2（曾因预注入 HTML 被转义成字面文本）
    expect(out).toContain('<h2 id="h-1-open-your-vault">');
    expect(out).not.toContain('&lt;h2');
    expect(out).toContain('href="#h-1-open-your-vault"');
  });
  it('unknown slug renders not-found affordance', () => {
    const out = render(<DocsChapter lang="zh" text={docsCopy.zh} slug="nope" />);
    expect(out).toContain('找不到这一章');
    expect(out).toContain('href="/zh/docs"');
  });
});
