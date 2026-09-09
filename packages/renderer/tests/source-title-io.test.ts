import { describe, expect, it } from 'vitest';
import { firstH1, bindH1ToTitle, pagePathForTitle } from '../src/editor/title-sync';
import { saveSourceText, type PageFileIo } from '../src/editor/source/page-source-io';

describe('标题绑定与源码保存链路（DEV-020 GUI 反馈）', () => {
  it('anchor-only H1 不会触发重命名，路径和内容原样落盘', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const renames: Array<{ from: string; to: string }> = [];
    const io: PageFileIo = {
      stat: async (path) => ({
        path,
        size: 100,
        modifiedAt: 't1',
        isFile: true,
        isDirectory: false,
      }),
      exists: async (path) => path === '研究/外部笔记.md',
      write: async (path, content) => {
        writes.push({ path, content });
        return { path, size: content.length, modifiedAt: 't2', isFile: true, isDirectory: false };
      },
      renameLinked: async (from, to) => {
        renames.push({ from, to });
      },
    };

    const result = await saveSourceText({
      io,
      path: '研究/外部笔记.md',
      text: '# ^edbjrskc\n\n源码模式正文段落保留。\n',
      baseVersion: null,
    });

    expect(result.kind).toBe('saved');
    if (result.kind !== 'saved') return;
    expect(result.path).toBe('研究/外部笔记.md');
    expect(result.title).toBeNull();
    expect(result.renamedFrom).toBeNull();
    expect(renames).toHaveLength(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toContain('源码模式正文段落保留。');
  });

  it('切回块编辑时，anchor-only H1 被替换为文件名标题，正文完整保留', () => {
    const original = '# ^edbjrskc\n\n第一段正文\n\n第二段正文\n';
    const replaced = bindH1ToTitle(original, '外部笔记');

    expect(firstH1(replaced)).toBe('外部笔记');
    expect(replaced).toContain('第一段正文');
    expect(replaced).toContain('第二段正文');
    expect(replaced.split('\n').length).toBeGreaterThanOrEqual(original.split('\n').length - 1);
  });

  it('frontmatter 后 anchor-only H1 仍走文件名绑定，frontmatter 保持最前', () => {
    const original = '---\ntags:\n  - 笔记\n---\n\n# ^edbjrskc\n\n正文\n';
    const replaced = bindH1ToTitle(original, '外部笔记');

    expect(replaced.startsWith('---\n')).toBe(true);
    expect(firstH1(replaced)).toBe('外部笔记');
    expect(replaced).toContain('正文');
    expect(pagePathForTitle('foo.md', '^edbjrskc')).not.toBe('^edbjrskc.md');
    expect(pagePathForTitle('foo.md', '^edbjrskc')).toBe('未命名页面.md');
  });
});
