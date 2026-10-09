// @vitest-environment happy-dom
/** 网站文档渲染与路由契约的回归测试：渲染器在共享 vitest 环境下验证。 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DocsChapter, DocsIndex, docsCopy } from '../../../apps/website/src/docs/DocsView';
import { chapters } from '../../../apps/website/src/docs/content';

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
  it('publishes the complete bilingual chapter catalog in order', () => {
    const expected = [
      'getting-started',
      'editor',
      'wikilinks',
      'search-and-recall',
      'confidence',
      'git-and-sync',
      'ai-assistant',
      'plugins',
      'spreadsheets-and-mindmaps',
      'settings',
      'troubleshooting',
    ];
    expect(chapters('zh').map((chapter) => chapter.slug)).toEqual(expected);
    expect(chapters('en').map((chapter) => chapter.slug)).toEqual(expected);
    expect(chapters('zh')).toHaveLength(expected.length);
    expect(chapters('en')).toHaveLength(expected.length);
  });
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
  it('chapter index includes the wikilinks guide in both languages', () => {
    const zh = render(<DocsIndex lang="zh" text={docsCopy.zh} />);
    expect(zh).toContain('双链与知识网络');
    expect(zh).toContain('href="/zh/docs/wikilinks"');
    const en = render(<DocsIndex lang="en" text={docsCopy.en} />);
    expect(en).toContain('Wikilinks & the Knowledge Network');
    expect(en).toContain('href="/docs/wikilinks"');
  });
  it('wikilinks chapter renders and links back to editor', () => {
    const out = render(<DocsChapter lang="zh" text={docsCopy.zh} slug="wikilinks" />);
    expect(out).toContain('链接解析优先级');
    expect(out).toContain('上一章：编辑器：块编辑与快捷插入');
  });
  it('git chapter is listed and reachable in both languages', () => {
    const zh = render(<DocsIndex lang="zh" text={docsCopy.zh} />);
    expect(zh).toContain('版本历史与同步');
    expect(zh).toContain('href="/zh/docs/git-and-sync"');
    const en = render(<DocsIndex lang="en" text={docsCopy.en} />);
    expect(en).toContain('Version History & Sync');
    const chapter = render(<DocsChapter lang="zh" text={docsCopy.zh} slug="git-and-sync" />);
    expect(chapter).toContain('自动提交与手动提交');
    expect(chapter).toContain('同步冲突');
  });
  it('ai chapter is listed and explains provider + permission modes', () => {
    const zh = render(<DocsIndex lang="zh" text={docsCopy.zh} />);
    expect(zh).toContain('AI 助手与权限模式');
    expect(zh).toContain('href="/zh/docs/ai-assistant"');
    const en = render(<DocsIndex lang="en" text={docsCopy.en} />);
    expect(en).toContain('AI Assistant & Permission Modes');
    const chapter = render(<DocsChapter lang="zh" text={docsCopy.zh} slug="ai-assistant" />);
    expect(chapter).toContain('配置供应商');
    expect(chapter).toContain('conversation');
    expect(chapter).toContain('full');
  });
  it('binary editors chapter is listed for spreadsheets and mindmaps', () => {
    const zh = render(<DocsIndex lang="zh" text={docsCopy.zh} />);
    expect(zh).toContain('表格与思维导图');
    expect(zh).toContain('href="/zh/docs/spreadsheets-and-mindmaps"');
    const en = render(<DocsIndex lang="en" text={docsCopy.en} />);
    expect(en).toContain('Spreadsheets & Mindmaps');
    const chapter = render(
      <DocsChapter lang="zh" text={docsCopy.zh} slug="spreadsheets-and-mindmaps" />,
    );
    expect(chapter).toContain('导入或新建');
  });
});
