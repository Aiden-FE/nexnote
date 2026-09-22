import { describe, expect, it } from 'vitest';
import {
  collectVaultTags,
  countMixedWords,
  inspectFrontmatter,
  pageStatistics,
  readFrontmatter,
  removeFrontmatterValue,
  renameFrontmatterKey,
  setFrontmatterValue,
  stampUpdated,
  tokenizeYaml,
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
    expect(() => renameFrontmatterKey(data, 'custom', '  ')).toThrow();
    expect(() => renameFrontmatterKey(data, 'custom', '__proto__')).toThrow(/不安全/);
  });
});

describe('DEV-077 stampUpdated', () => {
  const fixedNow = new Date('2026-09-22T10:00:00.000Z');

  it('文档已含 updated 字段时刷新为 now', () => {
    const md = '---\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# body';
    const out = stampUpdated(md, fixedNow);
    expect(out).toContain('updated: 2026-09-22T10:00:00.000Z');
    expect(out).not.toContain('2026-01-01T00:00:00.000Z');
    expect(out).toContain('# body');
  });

  it('文档无 updated 字段时不新增该键（删除后不写回）', () => {
    const md = '---\ntitle: T\n---\n\n# body';
    const out = stampUpdated(md, fixedNow);
    expect(out).toBe(md);
    expect(out).not.toContain('updated');
  });

  it('文档无 frontmatter 头时原样返回', () => {
    const md = '# body\n\ntext';
    const out = stampUpdated(md, fixedNow);
    expect(out).toBe(md);
  });

  it('不可解析的 YAML 头部原样返回（fail-closed）', () => {
    const md = '---\nupdated: not-a-date\n:invalid\n---\n\n# body';
    const out = stampUpdated(md, fixedNow);
    expect(out).toBe(md);
  });

  it('updated 刷新后 created 不被改动', () => {
    const md =
      '---\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-02T00:00:00.000Z\n---\n\n# body';
    const out = stampUpdated(md, fixedNow);
    expect(out).toContain('created: 2026-01-01T00:00:00.000Z');
    expect(out).toContain('updated: 2026-09-22T10:00:00.000Z');
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
    // DEV-078：created/updated 展示为本地时区 YYYY-MM-DD HH:mm:ss（不再是 ISO）
    expect(stats.created).toMatch(/^2024-03-01 \d{2}:\d{2}:\d{2}$/);
    expect(stats.updated).toMatch(/^2024-06-15 \d{2}:\d{2}:\d{2}$/);
  });

  it('空 frontmatter 显示占位符', () => {
    const stats = pageStatistics('# 只有正文');
    expect(stats.created).toBe('—');
    expect(stats.updated).toBe('—');
  });

  it('CJK 字符逐个计数，西文连续段按词计数', () => {
    expect(countMixedWords('中文 English 混排 test-case 42')).toBe(7);
    // 中(1)+文(1)+English(1)+混(1)+排(1)+test-case(1)+42(1) = 7；标题标记不会计数。
    expect(pageStatistics('# 中文 English 混排 test-case 42').words).toBe(7);
  });
});

describe('不可解析 frontmatter 数据保护', () => {
  it('锁定源码模式并原样保留 source，避免空对象覆盖', () => {
    const source = 'title: ok\n  bad indent: value';
    const md = `---\n${source}\n---\n\n正文`;
    const inspected = inspectFrontmatter(md);
    expect(inspected.locked).toBe(true);
    expect(inspected.parseError).toBeTruthy();
    expect(inspected.source).toBe(source);
    expect(inspected.body).toContain('正文');
    expect(() => readFrontmatter(md)).toThrow();
  });

  it('修复 YAML 后解除锁定且数据可解析', () => {
    const inspected = inspectFrontmatter('---\ntitle: fixed\ncustom: 3\n---\n\n正文');
    expect(inspected.locked).toBe(false);
    expect(inspected.parseError).toBeNull();
    expect(inspected.data).toMatchObject({ title: 'fixed', custom: 3 });
  });
});

describe('YAML 高亮 tokenizer', () => {
  it('识别 key/value/注释与 atom', () => {
    const lines = tokenizeYaml('title: "Hello"\ncount: 3\n# comment');
    expect(lines[0]?.map((t) => t.kind)).toContain('key');
    expect(lines[0]?.map((t) => t.kind)).toContain('string');
    expect(lines[1]?.map((t) => t.kind)).toContain('atom');
    expect(lines[2]?.map((t) => t.kind)).toContain('comment');
  });
});

describe('递归标签聚合', () => {
  it('扫描嵌套文件夹且跳过隐藏目录', async () => {
    const tree: Record<
      string,
      Array<{ name: string; path: string; kind: 'file' | 'directory' }>
    > = {
      '': [
        { name: 'root.md', path: 'root.md', kind: 'file' },
        { name: 'notes', path: 'notes', kind: 'directory' },
        { name: '.git', path: '.git', kind: 'directory' },
      ],
      notes: [
        { name: 'nested.md', path: 'notes/nested.md', kind: 'file' },
        { name: 'ignore.txt', path: 'notes/ignore.txt', kind: 'file' },
      ],
    };
    const docs: Record<string, string> = {
      'root.md': '---\ntags: [root, shared]\n---\n\nroot',
      'notes/nested.md': '---\ntags: [nested, shared]\n---\n\nnested',
    };
    const calls: string[] = [];
    const tags = await collectVaultTags({
      listDir: async (path) => {
        calls.push(path);
        return tree[path] ?? [];
      },
      readTextFile: async (path) => docs[path] ?? '',
    });
    expect(tags).toEqual(['nested', 'root', 'shared']);
    expect(calls).toEqual(['', 'notes']);
  });
});
