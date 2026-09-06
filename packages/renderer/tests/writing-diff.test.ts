import { describe, expect, it } from 'vitest';
import { diffLines, hasVisibleDiff } from '../src/features/ai/writing';

describe('行级 diff', () => {
  it('追加：原文为空时全部 add', () => {
    const ops = diffLines('', '新增段落');
    expect(ops.every((o) => o.type === 'add')).toBe(true);
    expect(ops.map((o) => o.text).join('\n')).toBe('新增段落');
  });

  it('替换：删除旧行、新增新行、保留相同行', () => {
    const ops = diffLines('保留行\n旧句子', '保留行\n新句子');
    const types = ops.map((o) => o.type);
    expect(types).toContain('eq');
    expect(types).toContain('del');
    expect(types).toContain('add');
    expect(ops.find((o) => o.type === 'del')?.text).toContain('旧句子');
    expect(ops.find((o) => o.type === 'add')?.text).toContain('新句子');
  });

  it('相同内容无 add/del', () => {
    const ops = diffLines('相同', '相同');
    expect(ops.some((o) => o.type !== 'eq')).toBe(false);
  });

  it('hasVisibleDiff 忽略首尾空白', () => {
    expect(hasVisibleDiff('a', 'a  ')).toBe(false);
    expect(hasVisibleDiff('a', 'b')).toBe(true);
  });
});
