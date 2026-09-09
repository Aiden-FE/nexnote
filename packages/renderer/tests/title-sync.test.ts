import { describe, expect, it } from 'vitest';
import { firstH1, sanitizePageTitle } from '../src/editor/title-sync';

describe('firstH1 块锚点加固（DEV-020 GUI 反馈）', () => {
  it('正常 H1 带行尾锚点：返回纯标题', () => {
    expect(firstH1('# 我的标题 ^abc123')).toBe('我的标题');
  });

  it('H1 文本只剩锚点：视为无标题，不得据此重命名文件', () => {
    expect(firstH1('# ^edbjrskc')).toBeNull();
  });

  it('frontmatter 后锚点 only 的 H1 同样为 null', () => {
    expect(firstH1('---\ntitle: x\n---\n\n# ^onlyanchor\n')).toBeNull();
  });

  it('CRLF 行尾锚点同样剥离', () => {
    expect(firstH1('# 标题 ^abc\r\n正文')).toBe('标题');
  });

  it('无 H1 返回 null（保持原文，不补写）', () => {
    expect(firstH1('正文只有一段')).toBeNull();
  });
});

describe('sanitizePageTitle 残留锚点兜底', () => {
  it('剥离标题末尾的锚点 token', () => {
    expect(sanitizePageTitle('标题 ^deadbeef')).toBe('标题');
  });

  it('剥离后为空则回退未命名页面', () => {
    expect(sanitizePageTitle('^deadbeef')).toBe('未命名页面');
  });

  it('不误伤不含空格分隔的 ^ 序列', () => {
    expect(sanitizePageTitle('a^b')).toBe('a^b');
  });
});
