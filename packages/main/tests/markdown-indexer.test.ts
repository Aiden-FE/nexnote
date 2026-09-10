import { describe, expect, it } from 'vitest';
import { applySidecarMetadata, parsePageMarkdown, projectBinaryPage } from '../src/indexer/markdown-indexer';

describe('parsePageMarkdown', () => {
  it('共享 wikilink 语法：alias/heading/block anchor，跳过代码中的假链接', () => {
    const parsed = parsePageMarkdown(
      'notes/source.md',
      `---\naliases: [Src]\ntags: [work/project]\n---\n# Source\n\n[[Target|显示]] [[Target#Heading]] [[Target#^block-1]]\n\n\`[[InlineCode]]\`\n\n\`\`\`md\n[[FencedCode]]\n\`\`\`\n\n段落 #inline ^src-block\n`,
    );

    expect(parsed.title).toBe('Source');
    expect(parsed.aliases).toEqual(['Src']);
    expect(parsed.tags).toEqual(['inline', 'work/project']);
    expect(parsed.links).toEqual([
      expect.objectContaining({ targetName: 'Target', alias: '显示', anchor: null, linkType: 'wiki' }),
      expect.objectContaining({ targetName: 'Target', alias: null, anchor: '#Heading', linkType: 'wiki' }),
      expect.objectContaining({ targetName: 'Target', alias: null, anchor: '#^block-1', linkType: 'wiki' }),
    ]);
    expect(parsed.links.some((link) => link.targetName.includes('Code'))).toBe(false);
    expect(parsed.blocks.some((block) => block.blockId === 'src-block')).toBe(true);
  });

  it('parses confidence_boost as a number without requiring the confidence field', () => {
    const parsed = parsePageMarkdown('boost.md', '---\nconfidence_boost: 72\n---\n# Boost\n');
    expect(parsed.confidenceBoost).toBe(72);
    expect(parsePageMarkdown('plain.md', '# Plain\n').confidenceBoost).toBeNull();
    expect(parsePageMarkdown('invalid.md', '---\nconfidence_boost: strong\n---\n# Bad\n').confidenceBoost).toBeNull();
  });

  it('CRLF blocks align link positions and ignore normal links inside code', () => {
    const parsed = parsePageMarkdown(
      'source.md',
      '首段\r\n\r\n[real](target.md) 与 [[target]]\r\n\r\n`[inline](hidden.md)`\r\n\r\n```md\r\n[fenced](hidden.md)\r\n```',
    );
    expect(parsed.links.map((link) => [link.targetName, link.sourceBlockIndex])).toEqual([['target', 1], ['target', 1]]);
  });

  it('解析指向 vault markdown 页面的普通链接，跳过外链与页内 anchor', () => {
    const parsed = parsePageMarkdown(
      'source.md',
      `[A](a.md#part) [B](./dir/b.md) [web](https://example.com/x.md) [here](#heading)`,
    );
    expect(parsed.links).toEqual([
      expect.objectContaining({ targetName: 'a', anchor: '#part', linkType: 'normal' }),
      expect.objectContaining({ targetName: 'dir/b', anchor: null, linkType: 'normal' }),
    ]);
  });

  it('frontmatter id 作为 stableId 的 fallback（旧笔记兼容）', () => {
    const parsed = parsePageMarkdown('legacy.md', '---\nid: legacy-uuid\ncreated: 2020-01-01T00:00:00.000Z\n---\n# Legacy\n');
    expect(parsed.stableId).toBe('legacy-uuid');
    expect(parsePageMarkdown('plain.md', '# Plain\n').stableId).toBeNull();
  });
});

describe('applySidecarMetadata', () => {
  const frontmatterPage = parsePageMarkdown(
    'note.md',
    '---\nid: front-id\ncreated: 2020-01-01T00:00:00.000Z\nupdated: 2020-06-01T00:00:00.000Z\n---\n# Note\n',
  );

  it('sidecar 的 id/createdAt/updatedAt 为 canonical override', () => {
    const merged = applySidecarMetadata(frontmatterPage, {
      id: 'sidecar-id',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(merged.stableId).toBe('sidecar-id');
    expect(merged.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(merged.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });

  it('sidecar 缺失字段回落到 frontmatter 推断值；无 sidecar 原样返回', () => {
    const partial = applySidecarMetadata(frontmatterPage, { id: 'sidecar-id' });
    expect(partial.stableId).toBe('sidecar-id');
    expect(partial.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(partial.updatedAt).toBe('2020-06-01T00:00:00.000Z');
    expect(applySidecarMetadata(frontmatterPage, null)).toBe(frontmatterPage);
  });
});

describe('projectBinaryPage', () => {
  it('二进制文档只投影 title/path 描述符：不解码正文、不产生块/链接/标签', () => {
    const bytes = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00]),
      Buffer.from('# 伪装标题\n\n[[wikilink]] 正文 #tag\n', 'utf8'),
    ]);
    const projected = projectBinaryPage('Files/report.docx', bytes);
    expect(projected.title).toBe('report'); // 文件名 stem，绝非二进制里解码出的 H1
    expect(projected.body).toBe('');
    expect(projected.blocks).toEqual([]);
    expect(projected.links).toEqual([]);
    expect(projected.tags).toEqual([]);
    expect(projected.stableId).toBeNull();
    expect(projected.hash).toHaveLength(64);
    expect(projectBinaryPage('Files/report.docx', Buffer.from('other')).hash).not.toBe(projected.hash);
  });
});
