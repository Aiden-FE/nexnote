import { describe, expect, it } from 'vitest';
import {
  fieldTypeOf,
  getList,
  getString,
  isStandardField,
  parseFrontmatterYaml,
  serializeFrontmatterYaml,
  splitFrontmatter,
} from '../src';

describe('parseFrontmatterYaml', () => {
  it('解析标量各类型', () => {
    const data = parseFrontmatterYaml([
      'title: 我的笔记',
      'count: 42',
      'ratio: 0.7',
      'draft: true',
      'archived: false',
      'empty: null',
      'created: 2024-01-15',
    ].join('\n'));
    expect(data.title).toBe('我的笔记');
    expect(data.count).toBe(42);
    expect(data.ratio).toBe(0.7);
    expect(data.draft).toBe(true);
    expect(data.archived).toBe(false);
    expect(data.empty).toBeNull();
    expect(data.created).toBeInstanceOf(Date);
  });

  it('解析 flow 序列与块序列', () => {
    const data = parseFrontmatterYaml(['tags: [work, "project x", 123]', 'aliases:', '  - 甲', '  - 乙'].join('\n'));
    expect(data.tags).toEqual(['work', 'project x', '123']);
    expect(data.aliases).toEqual(['甲', '乙']);
  });

  it('引号字符串保留特殊字符', () => {
    const data = parseFrontmatterYaml('title: "冒号: 井号# 引号\\"内"');
    expect(data.title).toBe('冒号: 井号# 引号"内');
  });

  it('空值与空行容忍', () => {
    const data = parseFrontmatterYaml('\n# 注释行\nkey:\n\n');
    expect(data.key).toBe('');
  });

  it('非法输入抛错（供源码模式标红）', () => {
    expect(() => parseFrontmatterYaml('  bad indent')).toThrow();
    expect(() => parseFrontmatterYaml('no colon here')).toThrow();
  });
});

describe('serializeFrontmatterYaml', () => {
  it('标准字段先于自定义字段且顺序确定', () => {
    const yaml = serializeFrontmatterYaml({
      zeta: 'z',
      title: 'T',
      alpha: 'a',
      tags: ['x', 'y'],
    });
    const lines = yaml.split('\n').map((l) => l.split(':')[0]);
    expect(lines.indexOf('title')).toBeLessThan(lines.indexOf('tags'));
    expect(lines.indexOf('tags')).toBeLessThan(lines.indexOf('alpha'));
    expect(lines.indexOf('alpha')).toBeLessThan(lines.indexOf('zeta'));
  });

  it('类型往返保真（datetime 保留时间分量）', () => {
    const data = {
      title: '标题',
      count: 7,
      on: true,
      off: false,
      nil: null,
      date: new Date('2024-05-01T08:30:45.000Z'),
      tags: ['a', 'b'],
      longList: ['one', 'two', 'three', 'four', 'five', 'six'],
    };
    const yaml = serializeFrontmatterYaml(data);
    const back = parseFrontmatterYaml(yaml);
    expect(back.title).toBe(data.title);
    expect(back.count).toBe(7);
    expect(back.on).toBe(true);
    expect(back.off).toBe(false);
    expect(back.nil).toBeNull();
    expect(back.date).toBeInstanceOf(Date);
    expect((back.date as Date).toISOString()).toBe(data.date.toISOString());
    expect(back.tags).toEqual(['a', 'b']);
    expect(back.longList).toEqual(data.longList);
  });

  it('需要引号的值被安全序列化并可回读', () => {
    const tricky = '2024-01-01 or #hash: with colon';
    const yaml = serializeFrontmatterYaml({ weird: tricky });
    const back = parseFrontmatterYaml(yaml);
    expect(back.weird).toBe(tricky);
  });
});

describe('splitFrontmatter 集成', () => {
  it('与 kernel splitFrontmatter 配合 round-trip', () => {
    const md = '---\ntitle: A\ntags: [t1, t2]\n---\n\n# 正文';
    const { yaml, body } = splitFrontmatter(md);
    expect(yaml).toBe('title: A\ntags: [t1, t2]');
    expect(body.trim()).toBe('# 正文');
    const data = parseFrontmatterYaml(yaml ?? '');
    data.title = 'B';
    const nextYaml = serializeFrontmatterYaml(data);
    expect(nextYaml).toContain('title: B');
    expect(nextYaml).toContain('tags: [t1, t2]');
  });
});

describe('辅助函数', () => {
  it('fieldTypeOf / isStandardField / getList / getString', () => {
    expect(fieldTypeOf('x')).toBe('string');
    expect(fieldTypeOf(1)).toBe('number');
    expect(fieldTypeOf(true)).toBe('boolean');
    expect(fieldTypeOf(new Date())).toBe('date');
    expect(fieldTypeOf([])).toBe('list');
    expect(fieldTypeOf(null)).toBe('null');

    expect(isStandardField('title')).toBe(true);
    expect(isStandardField('confidence')).toBe(true);
    expect(isStandardField('custom')).toBe(false);

    expect(getList({ tags: ['a'] }, 'tags')).toEqual(['a']);
    expect(getList({ tags: 'single' }, 'tags')).toEqual(['single']);
    expect(getList({}, 'tags')).toEqual([]);

    expect(getString({ title: 'T' }, 'title')).toBe('T');
    expect(getString({ count: 3 }, 'count')).toBe('3');
    expect(getString({}, 'missing', 'fallback')).toBe('fallback');
  });
});
