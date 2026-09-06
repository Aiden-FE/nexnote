import { describe, expect, it } from 'vitest';
import { assembleWritingContext, TRUNCATION_NOTE } from '../src/features/ai/writing';

describe('写作上下文组装与预算截断', () => {
  it('预算内完整包含文档与反链，无截断提示', () => {
    const r = assembleWritingContext({
      target: '选区',
      document: '这是当前文档的正文。'.repeat(10),
      backlinks: [
        { title: '笔记甲', snippet: '提到了本文的观点' },
        { title: '笔记乙', snippet: '另一个引用' },
      ],
      budgetChars: 6000,
    });
    expect(r.truncated).toBe(false);
    expect(r.note).toBeNull();
    expect(r.contextBlock).toContain('当前文档');
    expect(r.contextBlock).toContain('笔记甲');
    expect(r.contextBlock).toContain('笔记乙');
  });

  it('文档超长时裁剪文档并给出截断提示', () => {
    const big = '文档'.repeat(5000);
    const r = assembleWritingContext({
      target: '选区',
      document: big,
      backlinks: [],
      budgetChars: 500,
    });
    expect(r.truncated).toBe(true);
    expect(r.note).toBe(TRUNCATION_NOTE);
    expect(r.contextBlock).toContain(TRUNCATION_NOTE);
    expect(r.contextBlock.length).toBeLessThan(big.length);
  });

  it('预算紧张时优先保留文档，丢弃/截断反链', () => {
    const r = assembleWritingContext({
      target: '选区',
      document: '核心文档内容。'.repeat(100),
      backlinks: [
        { title: '反链一', snippet: '片段' + 'x'.repeat(500) },
        { title: '反链二', snippet: '另一段'.repeat(100) },
      ],
      budgetChars: 400,
    });
    expect(r.truncated).toBe(true);
    expect(r.contextBlock).toContain('当前文档');
    // 文档优先占满预算，反链整体被丢弃
    expect(r.contextBlock).not.toContain('相关笔记');
  });

  it('反链可部分纳入：先文档后反链按序填充', () => {
    const r = assembleWritingContext({
      target: '',
      document: '短文档',
      backlinks: [
        { title: '纳入', snippet: '短片段' },
        { title: '超出', snippet: '很'.repeat(5000) },
      ],
      budgetChars: 200,
    });
    expect(r.truncated).toBe(true);
    expect(r.contextBlock).toContain('纳入');
    expect(r.contextBlock).not.toContain('超出');
  });

  it('target 正文不进入 contextBlock（由 prompt 单独携带）', () => {
    const r = assembleWritingContext({
      target: 'UNIQUETARGET',
      document: '文档',
      backlinks: [],
    });
    expect(r.contextBlock).not.toContain('UNIQUETARGET');
  });
});
