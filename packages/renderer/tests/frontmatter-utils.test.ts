import { describe, expect, it } from 'vitest';
import {
  pageStatistics,
  readFrontmatter,
  removeFrontmatterValue,
  renameFrontmatterKey,
  setFrontmatterValue,
  writeFrontmatter,
} from '../src/features/frontmatter/frontmatter-utils';

describe('readFrontmatter / writeFrontmatter', () => {
  it('无 frontmatter 的文档', () => {
    const doc = readFrontmatter('# 标题\n\n正文');
    expect(doc.data).toEqual({});
    expect(doc.body).toContain('# 标题');
  });

  it('读写往返不变形', () => {
    const md = '---\ntitle: 原始\ntags: [a, b]\n---\n\n# 标题\n\n正文段落';
    const doc = readFrontmatter(md);
    expect(doc.data.title).toBe('原始');
    expect(doc.data.tags).toEqual(['a', 'b']);
    const out = writeFrontmatter(doc.data, doc.body);
    expect(readFrontmatter(out).data).toEqual(doc.data);
    expect(out).toContain('# 标题');
    expect(out).toContain('正文段落');
  });

  it('修改字段后保存重开不变形', () => {
    const md = '---\ntitle: 旧\ntags: [a]\n---\n\n正文';
    const doc = readFrontmatter(md);
    const next = setFrontmatterValue(doc.data, 'title', '新标题');
    const next2 = setFrontmatterValue(next, 'rating', 4.5);
    const saved = writeFrontmatter(next2, doc.body);
    const reopened = readFrontmatter(saved);
    expect(reopened.data.title).toBe('新标题');
    expect(reopened.data.rating).toBe(4.5);
    expect(reopened.data.tags).toEqual(['a']);
  });
});

describe('字段操作', () => {
  const data = { title: 'T', custom: 'C', count: 1 };

  it('setFrontmatterValue 赋值与类型保持', () => {
    expect(setFrontmatterValue(data, 'count', 9).count).toBe(9);
    expect(setFrontmatterValue(data, 'flag', true).flag).toBe(true);
    expect(setFrontmatterValue(data, 'list', ['x']).list).toEqual(['x']);
  });

  it('removeFrontmatterValue 删除', () => {
    const next = removeFrontmatterValue(data, 'custom');
    expect(next.custom).toBeUndefined();
    expect(next.title).toBe('T');
  });

  it('renameFrontmatterKey 重命名与冲突拒绝', () => {
    const renamed = renameFrontmatterKey(data, 'custom', 'renamed');
    expect(renamed.renamed).toBe('C');
    expect(renamed.custom).toBeUndefined();
    expect(() => renameFrontmatterKey(data, 'custom', 'title')).toThrow('已存在');
    expect(() => renameFrontmatterKey(data, 'custom', '  ')).toThrow('不能为空');
  });
});

describe('pageStatistics', () => {
  it('统计词数/块数并读取时间字段', () => {
    const md = [
      '---',
      'created: 2024-03-01',
      'updated: 2024-06-15',
      '---',
      '',
      '# 第一块',
      '',
      '这是 第二块 内容',
      '',
      '```js',
      'const x = 1',
      '```',
    ].join('\n');
    const stats = pageStatistics(md);
    expect(stats.blocks).toBe(3);
    expect(stats.words).toBeGreaterThan(0);
    expect(stats.created).toContain('2024-03-01');
    expect(stats.updated).toContain('2024-06-15');
  });

  it('空 frontmatter 显示占位符', () => {
    const stats = pageStatistics('# 只有正文');
    expect(stats.created).toBe('—');
    expect(stats.updated).toBe('—');
  });
});
