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
