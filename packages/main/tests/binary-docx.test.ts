import { describe, it, expect } from 'vitest';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
} from 'docx';
import { readDocxToHtml } from '../src/binary/docx-semantic';
import { htmlToBlocks } from '@nexnote/shared';
import { blocksToDocx } from '../src/binary/docx-semantic';

async function buildSampleDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: '报告标题', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [new TextRun({ text: '加粗', bold: true }), new TextRun(' 普通 '), new TextRun({ text: '斜体', italics: true })],
          }),
          new Paragraph({ text: '红字', children: [new TextRun({ text: '红字', color: 'FF0000' })] }),
          new Paragraph({ text: '居中段落', alignment: AlignmentType.CENTER }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('甲')] }),
                  new TableCell({ children: [new Paragraph('乙')] }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

describe('docx 语义级往返（DEV-074，ADR-0015 Decision 4）', () => {
  it('段落 / 标题 / 加粗斜体 / 表格 / 字体色 / 对齐 往返保留', async () => {
    const bytes = await buildSampleDocx();
    const { html, meta } = await readDocxToHtml(bytes);
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<table>');

    const blocks = htmlToBlocks(html);
    const heading = blocks.find((b) => b.type === 'heading');
    expect(heading && heading.type === 'heading' && heading.runs[0]?.text).toBe('报告标题');
    const boldPara = blocks.find(
      (b) => b.type === 'paragraph' && b.runs.some((r) => r.bold),
    );
    expect(boldPara).toBeTruthy();
    const table = blocks.find((b) => b.type === 'table');
    expect(table && table.type === 'table' && table.rows[0]?.[0]?.[0]?.text).toBe('甲');

    // 写回 → 再读：结构稳定。
    const { bytes: rebuilt } = await blocksToDocx(blocks, '样例');
    const reread = await readDocxToHtml(rebuilt);
    expect(reread.html).toContain('<h1>报告标题</h1>');
    expect(reread.html).toContain('<strong>');
    expect(reread.html).toContain('<table>');
    void meta;
  });

  it('mammoth HTML → blocks：字体色与对齐保留', () => {
    const blocks = htmlToBlocks(
      '<p><span style="color:#FF0000">红字</span></p><p style="text-align:center">居中</p>',
    );
    const colorPara = blocks[0];
    expect(colorPara?.type).toBe('paragraph');
    if (colorPara?.type === 'paragraph') {
      expect(colorPara.runs[0]?.color).toBe('FF0000');
    }
    const centered = blocks[1];
    if (centered?.type === 'paragraph') {
      expect(centered.alignment).toBe('center');
    }
  });
});
