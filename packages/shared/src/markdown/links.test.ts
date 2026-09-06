import { describe, expect, it } from 'vitest';
import {
  classifyNormalDestination,
  extractMarkdownLinks,
  rebaseNormalDestination,
  rewriteNormalLinkTargets,
  rewriteWikiTargets,
  resolveNoteLinkTarget,
} from './links';

describe('extractMarkdownLinks code-awareness', () => {
  it('parses normal links with optional title, angle destination, balanced parens', () => {
    const md = `[a](b.md) [c](<d e.md>) [f](g.md "标题") [h](my%20note(1).md)`;
    const normal = extractMarkdownLinks(md).filter((l) => l.kind === 'normal');
    expect(normal.map((l) => (l.kind === 'normal' ? l.destination : ''))).toEqual([
      'b.md',
      'd e.md',
      'g.md',
      'my%20note(1).md',
    ]);
    const titled = normal.find((l) => l.kind === 'normal' && l.destination === 'g.md');
    expect(titled && titled.kind === 'normal' ? titled.title : null).toBe('标题');
  });

  it('ignores fenced code and inline code (single and multi backticks)', () => {
    const md = [
      '[real](real.md)',
      '`[inline](hidden.md)`',
      '`` [double](also-hidden.md) ``',
      '```md',
      '[fenced](hidden.md)',
      '```',
      '~~~\n[fenced2](hidden.md)\n~~~',
    ].join('\n');
    const links = extractMarkdownLinks(md);
    expect(links.length).toBe(1);
    expect(links[0]!.kind).toBe('normal');
    expect(links[0]!.offset).toBe(md.indexOf('[real]'));
  });

  it('parses wiki + normal links with aligned block indices under CRLF', () => {
    const md = '首段\r\n\r\n[real](target.md) 与 [[target]]\r\n\r\n`[inline](hidden.md)`';
    const links = extractMarkdownLinks(md);
    expect(links.map((l) => l.blockIndex)).toEqual([1, 1]);
  });
});

describe('classifyNormalDestination / resolveNoteLinkTarget', () => {
  it('classifies external / anchor / asset / note', () => {
    expect(classifyNormalDestination('https://x.com/a.md')).toBe('external');
    expect(classifyNormalDestination('#heading')).toBe('anchor');
    expect(classifyNormalDestination('img.png')).toBe('asset');
    expect(classifyNormalDestination('doc.pdf')).toBe('asset');
    expect(classifyNormalDestination('b.md')).toBe('note');
    expect(classifyNormalDestination('<dir/b.md>')).toBe('note');
    expect(classifyNormalDestination('extensionless')).toBe('note');
  });

  it('resolves relative to source dirname and rejects traversal', () => {
    expect(resolveNoteLinkTarget('dir/source.md', 'b.md')).toBe('dir/b');
    expect(resolveNoteLinkTarget('dir/source.md', './sub/c.md')).toBe('dir/sub/c');
    expect(resolveNoteLinkTarget('source.md', './dir/b.md')).toBe('dir/b');
    expect(resolveNoteLinkTarget('source.md', '/root-note.md')).toBe('root-note');
    expect(resolveNoteLinkTarget('dir/source.md', '../escape.md')).toBe('escape');
    expect(resolveNoteLinkTarget('dir/source.md', '../../escape.md')).toBeNull();
  });

  it('returns null for assets/external/anchors', () => {
    expect(resolveNoteLinkTarget('source.md', 'photo.png')).toBeNull();
    expect(resolveNoteLinkTarget('source.md', 'https://example.com/x.md')).toBeNull();
    expect(resolveNoteLinkTarget('source.md', '#heading')).toBeNull();
  });
});

describe('rename rewriters are code-aware and path-relative', () => {
  it('rewriteWikiTargets preserves alias/anchor/embed and skips code', () => {
    const src = '[[old]] ![[old]] `[[old]]`\n```\n[[old]]\n```\n[[old#h|别名]]';
    const r = rewriteWikiTargets(src, 'old', 'new');
    expect(r.content).toBe('[[new]] ![[new]] `[[old]]`\n```\n[[old]]\n```\n[[new#h|别名]]');
  });

  it('rewriteNormalLinkTargets only changes links resolving to the renamed target', () => {
    // index.md (root) links to b.md via basename and ./ ; code example must stay untouched.
    const src = '[x](b.md#p) [y](./b.md) [code](b.md)';
    const r = rewriteNormalLinkTargets(src, 'b', 'renamed', 'index.md');
    // [code](b.md) is a real link too in this sample (not in code fence) → rewritten
    expect(r.content).toBe('[x](renamed.md#p) [y](./renamed.md) [code](renamed.md)');
  });

  it('does not rewrite code examples or links in another directory with same basename', () => {
    // A nested file that links to its OWN local b (other/b.md) must not be rewritten when root b moves.
    const srcInOther = '[local](b.md)';
    const r1 = rewriteNormalLinkTargets(srcInOther, 'b', 'renamed', 'other/index.md');
    expect(r1.content).toBe('[local](b.md)'); // resolves to other/b, not root b
    // code fence containing the link is never touched
    const code = '```md\n[link](b.md)\n```';
    const r2 = rewriteNormalLinkTargets(code, 'b', 'renamed', 'index.md');
    expect(r2.content).toBe(code);
    expect(r2.changed).toBe(false);
  });

  it('rebaseNormalDestination preserves ./ prefix, extension, anchor and title', () => {
    const out = rebaseNormalDestination('index.md', { destination: './b.md#part', angle: false, title: 'T' }, 'renamed');
    expect(out).toBe('./renamed.md#part "T"');
  });
});
