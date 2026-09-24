import { describe, expect, it } from 'vitest';
import { BINARY_IGNORE_MARKER, updateBinaryIgnoreBlock } from '../src/binary/binary-gitignore';

describe('binary gitignore stanza (ADR-0015)', () => {
  it('enable/disable is idempotent and preserves unrelated CRLF user rules', () => {
    const original = '# user rule\r\nsecret.txt\r\n';
    const enabled = updateBinaryIgnoreBlock(original, true);
    expect(enabled).toContain('# user rule\r\nsecret.txt\r\n');
    expect(enabled).toContain(`${BINARY_IGNORE_MARKER}\r\n*.docx\r\n*.xlsx\r\n*.xmind\r\n`);
    expect(updateBinaryIgnoreBlock(enabled, true)).toBe(enabled);
    expect(updateBinaryIgnoreBlock(enabled, false)).toBe(original);
  });

  it('normalizes duplicate owned rules on enable without deleting user lines', () => {
    const dirty = [
      '# user',
      '*.docx',
      BINARY_IGNORE_MARKER,
      '*.docx',
      '*.xlsx',
      '*.xmind',
      'notes.txt',
      '',
    ].join('\n');
    const enabled = updateBinaryIgnoreBlock(dirty, true);
    expect(enabled.split(/\r?\n/).filter((line) => line === '*.docx')).toHaveLength(1);
    expect(enabled).toContain('# user');
    expect(enabled).toContain('notes.txt');
    expect(updateBinaryIgnoreBlock(enabled, false)).toBe('# user\nnotes.txt\n');
  });
});
