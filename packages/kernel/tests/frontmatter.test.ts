// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  assertSafeFrontmatterKey,
  fieldTypeOf,
  getList,
  getString,
  formatDisplayDateTime,
  isReadonlyStandardField,
  isStandardField,
  parseFrontmatterYaml,
  serializeFrontmatterYaml,
  splitFrontmatter,
  STANDARD_FIELD_CATALOG,
} from '../src';

describe('parseFrontmatterYaml', () => {
  it('解析标量各类型', () => {
    const data = parseFrontmatterYaml(
      [
        'title: 我的笔记',
        'count: 42',
        'ratio: 0.7',
        'draft: true',
        'archived: false',
        'empty: null',
        'created: 2024-01-15',
      ].join('\n'),
    );
    expect(data.title).toBe('我的笔记');
    expect(data.count).toBe(42);
    expect(data.ratio).toBe(0.7);
    expect(data.draft).toBe(true);
    expect(data.archived).toBe(false);
    expect(data.empty).toBeNull();
    expect(data.created).toBeInstanceOf(Date);
  });

  it('解析 flow 序列与块序列', () => {
    const data = parseFrontmatterYaml(
      ['tags: [work, "project x", 123]', 'aliases:', '  - 甲', '  - 乙'].join('\n'),
    );
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

  it('拒绝 __proto__ / constructor / prototype 等危险 key，防止原型污染', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(() => parseFrontmatterYaml(`${key}: value`)).toThrow();
      expect(() => serializeFrontmatterYaml({ [key]: 'x' } as never)).toThrow();
    }
    const data = parseFrontmatterYaml('safe: yes');
    expect(Object.getPrototypeOf(data)).toBeNull();
  });

  it('拒绝空 key', () => {
    expect(() => parseFrontmatterYaml(': value')).toThrow(/不能为空/);
  });

  it('assertSafeFrontmatterKey 统一校验空与危险 key', () => {
    expect(assertSafeFrontmatterKey('  title ')).toBe('title');
    expect(() => assertSafeFrontmatterKey('')).toThrow(/不能为空/);
    expect(() => assertSafeFrontmatterKey('__proto__')).toThrow(/不安全/);
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

describe('标准字段目录（DEV-025）', () => {
  it('DEV-080：标准字段 6 个（type 已移除），顺序固定', () => {
    expect(STANDARD_FIELD_CATALOG.map((field) => field.key)).toEqual([
      'title',
      'tags',
      'aliases',
      'created',
      'updated',
      'confidence',
    ]);
  });

  it('每个字段带类型与一句话说明（集中定义，不散落字符串）', () => {
    expect(STANDARD_FIELD_CATALOG.length).toBe(6);
    for (const field of STANDARD_FIELD_CATALOG) {
      expect(['string', 'list', 'date', 'number', 'boolean']).toContain(field.type);
      expect(field.description.trim().length).toBeGreaterThan(4);
    }
    expect(STANDARD_FIELD_CATALOG.find((f) => f.key === 'confidence')?.description).toContain(
      'Git',
    );
    expect(STANDARD_FIELD_CATALOG.find((f) => f.key === 'tags')?.type).toBe('list');
    expect(STANDARD_FIELD_CATALOG.find((f) => f.key === 'created')?.type).toBe('date');
  });

  it('DEV-080：isStandardField("type") 返回 false', () => {
    expect(isStandardField('type')).toBe(false);
  });

  it('与 isStandardField 判定一致', () => {
    for (const field of STANDARD_FIELD_CATALOG) {
      expect(isStandardField(field.key)).toBe(true);
    }
    expect(isStandardField('not_a_standard_field')).toBe(false);
  });

  it('DEV-080：serializeFrontmatterYaml 不输出 type 且顺序由 catalog 派生', () => {
    const yaml = serializeFrontmatterYaml({
      title: 'T',
      type: 'note',
      confidence: 5,
    });
    expect(yaml).toContain('title: T');
    expect(yaml).toContain('confidence: 5');
    // type 是数据中存在但已不是标准字段：会被当作 custom key 输出。
    // 若调用方希望彻底剥离，应在调用前从 data 删除 type（见 ticket §期望行为 §4）。
    expect(yaml).toContain('type: note');
    // 顺序：standard 在前（title, confidence），custom（type）在后
    const lines = yaml.split('\n');
    expect(lines.findIndex((l) => l.startsWith('title'))).toBeLessThan(
      lines.findIndex((l) => l.startsWith('confidence')),
    );
    expect(lines.findIndex((l) => l.startsWith('confidence'))).toBeLessThan(
      lines.findIndex((l) => l.startsWith('type')),
    );
  });

  it('DEV-077：updated 标 readonly=true；其余标准字段不变', () => {
    const updated = STANDARD_FIELD_CATALOG.find((f) => f.key === 'updated');
    expect(updated?.readonly).toBe(true);
    // created/title 等其他标准字段保持非 readonly
    expect(isReadonlyStandardField('created')).toBe(false);
    expect(isReadonlyStandardField('title')).toBe(false);
    expect(isReadonlyStandardField('updated')).toBe(true);
    expect(isReadonlyStandardField('not_a_field')).toBe(false);
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

describe('DEV-078 formatDisplayDateTime', () => {
  it('Date → 本地时区 YYYY-MM-DD HH:mm:ss（带前导 0）', () => {
    const d = new Date(2026, 0, 5, 3, 4, 9); // 本地 2026-01-05 03:04:09
    expect(formatDisplayDateTime(d)).toBe('2026-01-05 03:04:09');
  });

  it('可解析 ISO 字符串 → 本地时区展示', () => {
    // 用 UTC 0 点 → 本地（取决于测试时区）。只断言格式 YYYY-MM-DD HH:mm:ss。
    const out = formatDisplayDateTime('2026-09-22T10:00:00.000Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('null / undefined / 空串 → 返回空串（调用方决定回退）', () => {
    expect(formatDisplayDateTime(null)).toBe('');
    expect(formatDisplayDateTime(undefined)).toBe('');
    expect(formatDisplayDateTime('')).toBe('');
    expect(formatDisplayDateTime('   ')).toBe('');
  });

  it('不可解析的字符串原样回退，不抛错', () => {
    expect(formatDisplayDateTime('not-a-date')).toBe('not-a-date');
  });
});

describe('DEV-095 文档头 frontmatter 时间可读（NodeView）', () => {
  const markdown = `---\ncreated: 2026-01-15T10:00:00.000Z\nupdated: 2026-09-22T01:23:45.110Z\ntitle: 笔记\ntags:\n  - work\n---\n\n# 正文段落\n\n正文段落内容。\n`;

  it('显示 created/updated 为本地可读时间；节点 text 保持原 YAML 不变', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const kernel = await import('../src').then((m) =>
      m.createEditor(container, { initialMarkdown: markdown, saveDelayMs: 0 }),
    );
    try {
      const dom = kernel.editor.view.dom as HTMLElement;
      // 文档头：第一个 block 就是 frontmatter 节点
      const pre = dom.querySelector('pre[data-frontmatter]');
      expect(pre).not.toBeNull();
      // 内联显示时不能被内联编辑
      expect(pre!.getAttribute('contenteditable')).toBe('false');

      const timeSpans = pre!.querySelectorAll('.nexnote-frontmatter-time');
      const texts = Array.from(timeSpans).map((s) => s.textContent ?? '');
      // created 与 updated 都应被替换为 YYYY-MM-DD HH:mm:ss（本地时区），不再出现 ISO 串
      expect(texts).toHaveLength(2);
      for (const t of texts) {
        expect(t).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      }
      expect(texts.some((t) => t.includes('T') || t.includes('Z'))).toBe(false);

      // 节点 text（原始 YAML）必须保持字节级不变，序列化与往返也必须一致
      const doc = kernel.editor.state.doc;
      const fmNode = doc.content.firstChild;
      expect(fmNode?.type.name).toBe('frontmatter');
      expect(fmNode?.textContent).toContain('created: 2026-01-15T10:00:00.000Z');
      expect(fmNode?.textContent).toContain('updated: 2026-09-22T01:23:45.110Z');

      const out = kernel.getMarkdown();
      expect(out).toContain('created: 2026-01-15T10:00:00.000Z');
      expect(out).toContain('updated: 2026-09-22T01:23:45.110Z');

      // 往返序列化必须字节级一致（ADR-0004 byte fidelity）。
      // 允许序列化把输入末尾的单个换行吃掉——内容本身未变。
      expect(out.replace(/\n+$/, '')).toBe(markdown.replace(/\n+$/, ''));
    } finally {
      kernel.destroy();
      container.remove();
    }
  });

  it('NodeView 在节点 text 变化后重新渲染为新格式', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const kernel = await import('../src').then((m) =>
      m.createEditor(container, {
        initialMarkdown: `---\ncreated: 2026-01-01T00:00:00.000Z\n---\n\n# 标题\n\n正文。\n`,
        saveDelayMs: 0,
      }),
    );
    try {
      // 通过命令同步替换 frontmatter 文本（模拟保存后 updated 回灌的场景）
      const ok = kernel.editor.commands.setFrontmatter(
        'created: 2026-06-15T12:34:56.000Z\ntitle: 更新\n',
      );
      expect(ok).toBe(true);

      const dom = kernel.editor.view.dom as HTMLElement;
      const timeSpan = dom.querySelector('pre[data-frontmatter] .nexnote-frontmatter-time');
      expect(timeSpan).not.toBeNull();
      const text = timeSpan!.textContent ?? '';
      expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      // 节点 text 应保留新的原始 ISO
      const fmNode = kernel.editor.state.doc.content.firstChild;
      expect(fmNode?.textContent).toContain('created: 2026-06-15T12:34:56.000Z');
    } finally {
      kernel.destroy();
      container.remove();
    }
  });
});
