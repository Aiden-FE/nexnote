import { describe, expect, it } from 'vitest';
import { parsePageMarkdown } from '../src/indexer/markdown-indexer';

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
});
