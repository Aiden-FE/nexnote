import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table as DocxTable,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from 'docx';
import mammoth from 'mammoth';
import type { DocxAlignment, DocxBlock } from '@nexnote/shared';
import { readZipEntries, readZipEntry } from '../docx/zip';

/**
 * docx 语义级往返的 Node 侧实现（DEV-074，ADR-0015 Decision 4）：
 * - 读：mammoth 把 .docx 转成 HTML（段落、标题、加粗/斜体、表格、字体色、对齐），
 *   并统计不保留结构（页眉页脚 / 编号样式 / 上下标）。
 * - 写：TipTap 产出的 HTML 经 shared 的 htmlToBlocks 转语义块，再用 dolanmiu/docx 重建 .docx。
 * 明确不保留：页眉页脚、编号列表样式、上下标。
 */

export class DocxSemanticError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DocxSemanticError';
  }
}

export interface DocxReadMeta {
  headersFooters: number;
  numberingStyles: number;
  superSubscripts: number;
}

/** 读取 .docx 为 HTML（mammoth），并统计语义级往返会丢弃的结构。 */
export async function readDocxToHtml(
  bytes: Buffer,
): Promise<{ html: string; meta: DocxReadMeta }> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml({ buffer: bytes });
    html = result.value;
  } catch (e) {
    throw new DocxSemanticError(`docx 解析失败：${(e as Error).message}`, 'DOCX_PARSE_FAILED');
  }
  let headersFooters = 0;
  try {
    for (const entry of readZipEntries(bytes)) {
      if (/^word\/(header|footer)\d*\.xml$/i.test(entry.name)) headersFooters += 1;
    }
  } catch {
    headersFooters = 0;
  }
  let numberingStyles = 0;
  try {
    numberingStyles =
      readZipEntry(bytes, 'word/numbering.xml').toString('utf8').length > 0 ? 1 : 0;
  } catch {
    numberingStyles = 0;
  }
  let superSubscripts = 0;
  try {
    const documentXml = readZipEntry(bytes, 'word/document.xml').toString('utf8');
    superSubscripts = (documentXml.match(/<w:(vertAlign|subScript|superScript)\b/g) ?? []).length;
  } catch {
    superSubscripts = 0;
  }
  return { html, meta: { headersFooters, numberingStyles, superSubscripts } };
}

/** 语义块 → .docx 字节（dolanmiu/docx）。保留段落/标题/加粗斜体/字体色/对齐/表格。 */
export async function blocksToDocx(
  blocks: DocxBlock[],
  title?: string,
): Promise<{ bytes: Buffer; meta: { paragraphs: number; tables: number } }> {
  let paragraphs = 0;
  let tables = 0;
  const children: (Paragraph | DocxTable)[] = [];
  for (const block of blocks) {
    if (block.type === 'table') {
      tables += 1;
      const rows = block.rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  children: cell.length
                    ? [new Paragraph({ children: cell.map(runToText) })]
                    : [new Paragraph('')],
                }),
            ),
          }),
      );
      children.push(new DocxTable({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      continue;
    }
    paragraphs += 1;
    const options: IParagraphOptions = {
      children: block.runs.length ? block.runs.map(runToText) : [new TextRun('')],
      alignment: alignmentToDocx(block.alignment),
    };
    if (block.type === 'heading') options.heading = headingFor(block.level);
    children.push(new Paragraph(options));
  }
  const doc = new Document({
    ...(title ? { title } : {}),
    sections: [{ children: children.length > 0 ? children : [new Paragraph('')] }],
  });
  const buffer = await Packer.toBuffer(doc);
  return { bytes: Buffer.from(buffer), meta: { paragraphs, tables } };
}

function runToText(run: { text: string; bold?: boolean; italic?: boolean; color?: string }): TextRun {
  return new TextRun({ text: run.text, bold: run.bold, italics: run.italic, color: run.color });
}

function alignmentToDocx(
  alignment: DocxAlignment | undefined,
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (alignment === 'center') return AlignmentType.CENTER;
  if (alignment === 'right') return AlignmentType.RIGHT;
  if (alignment === 'both') return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

function headingFor(level: 1 | 2 | 3 | 4 | 5 | 6): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return (
    {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
      4: HeadingLevel.HEADING_4,
      5: HeadingLevel.HEADING_5,
      6: HeadingLevel.HEADING_6,
    } as const
  )[level];
}
