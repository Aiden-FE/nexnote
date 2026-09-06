import { describe, expect, it } from 'vitest';
import { extractWikilinks } from './wikilink';

describe('extractWikilinks offsets', () => {
  it('preserves offsets after inline code of different length', () => {
    const markdown = '`[[ignored-long-target]]` before [[real]]';
    const [link] = extractWikilinks(markdown);
    expect(link?.targetName).toBe('real');
    expect(link?.offset).toBe(markdown.indexOf('[[real]]'));
  });

  it('reports UTF-16 offsets against the original CRLF string', () => {
    const markdown = '😀 前缀\r\n\r\n中文 [[目标]]';
    const [link] = extractWikilinks(markdown);
    expect(link?.offset).toBe(markdown.indexOf('[[目标]]'));
    expect(link?.byteOffset).toBe(new TextEncoder().encode(markdown.slice(0, markdown.indexOf('[[目标]]'))).byteLength);
    expect(markdown.slice(link?.offset, (link?.offset ?? 0) + (link?.raw.length ?? 0))).toBe('[[目标]]');
    expect(link?.blockIndex).toBe(1);
  });
});
