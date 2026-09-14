import { describe, expect, it } from 'vitest';
import {
  replaceFrontmatterYaml,
  splitFrontmatterParts,
} from '../src/features/frontmatter/frontmatter-utils';

describe('splitFrontmatterParts（DEV-025 字节精确拆装）', () => {
  it('header + separator + body 逐字节还原原文（保留缩进与引号风格）', () => {
    const raw = '---\ntitle: 原始\n  nested: keep\ntags: [x, "y z"]\n---\n\n# 正文\n';
    const parts = splitFrontmatterParts(raw);
    expect(parts.header).toBe('---\ntitle: 原始\n  nested: keep\ntags: [x, "y z"]\n---');
    expect(parts.yaml).toBe('title: 原始\n  nested: keep\ntags: [x, "y z"]');
    expect(parts.separator).toBe('\n\n');
    expect(parts.body).toBe('# 正文\n');
    expect(parts.header + parts.separator + parts.body).toBe(raw);
  });

  it('--- 后无空行紧跟正文也逐字节还原', () => {
    const raw = '---\ntitle: A\n---\n# T\n';
    const parts = splitFrontmatterParts(raw);
    expect(parts.header).toBe('---\ntitle: A\n---');
    expect(parts.separator).toBe('\n');
    expect(parts.body).toBe('# T\n');
    expect(parts.header + parts.separator + parts.body).toBe(raw);
  });

  it('CRLF 文档同样可拆装还原', () => {
    const raw = '---\r\ntitle: A\r\n---\r\n\r\n# 正文\r\n';
    const parts = splitFrontmatterParts(raw);
    expect(parts.yaml).toBe('title: A');
    expect(parts.separator).toBe('\r\n\r\n');
    expect(parts.body).toBe('# 正文\r\n');
    expect(parts.header + parts.separator + parts.body).toBe(raw);
  });

  it('无 YAML 头时 header/yaml 为 null，body 即原文', () => {
    const raw = '# T\n\n正文\n';
    const parts = splitFrontmatterParts(raw);
    expect(parts.header).toBeNull();
    expect(parts.yaml).toBeNull();
    expect(parts.separator).toBe('');
    expect(parts.body).toBe(raw);
  });

  it('空 YAML 头（---\\n\\n---）可拆装且不误吞正文', () => {
    const raw = '---\n\n---\n# T\n';
    const parts = splitFrontmatterParts(raw);
    expect(parts.yaml).toBe('');
    expect(parts.body).toBe('# T\n');
    expect(parts.header + parts.separator + parts.body).toBe(raw);
  });

  it('紧邻 ---\\n--- 与 kernel 语义一致：不识别为 YAML 头', () => {
    const raw = '---\n---\n# T\n';
    expect(splitFrontmatterParts(raw).header).toBeNull();
  });
});

describe('replaceFrontmatterYaml（仅替换 YAML 区域，正文字节不动）', () => {
  it('LF 文档：分隔线与正文原字节保留，YAML 区域整体替换', () => {
    const raw = '---\ntitle: 旧值\ncustom: "quoted"\n---\n\n# 正文   \n\n行尾双空格  \n';
    const next = replaceFrontmatterYaml(raw, 'title: 新值');
    expect(next).toBe('---\ntitle: 新值\n---\n\n# 正文   \n\n行尾双空格  \n');
  });

  it('CRLF 文档：编辑后的 YAML 使用原文档的 CRLF 行尾', () => {
    const raw = '---\r\ntitle: 旧值\r\n---\r\n\r\n# 正文\r\n';
    const next = replaceFrontmatterYaml(raw, 'title: 新值\ntags: []');
    expect(next).toBe('---\r\ntitle: 新值\r\ntags: []\r\n---\r\n\r\n# 正文\r\n');
  });

  it('无 YAML 头：新增头部且正文字节不变', () => {
    const raw = '# T\n\n正文\n';
    const next = replaceFrontmatterYaml(raw, 'title: T');
    expect(next).toBe('---\ntitle: T\n---\n\n# T\n\n正文\n');
  });

  it('YAML 为空时移除整个头部，正文原字节保留', () => {
    const raw = '---\ntitle: A\n---\n\n# T\n';
    expect(replaceFrontmatterYaml(raw, '')).toBe('# T\n');
  });

  it('YAML 为空且本来无头部时原样返回', () => {
    const raw = '# T\n';
    expect(replaceFrontmatterYaml(raw, '')).toBe(raw);
  });

  it('未变化的 YAML 传回时结果与原文一致（幂等）', () => {
    const raw = '---\ntitle: A\ntags: [x]\n---\n\n# T\n';
    expect(replaceFrontmatterYaml(raw, 'title: A\ntags: [x]')).toBe(raw);
  });
});
