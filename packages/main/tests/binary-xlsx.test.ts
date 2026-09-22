import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseXlsxToModel, writeModelToXlsx, XlsxError } from '../src/binary/xlsx-convert';

/** 构造一个含多 sheet、公式、合并单元格、基础样式的 xlsx 字节。 */
async function buildSampleXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet1 = workbook.addWorksheet('数据表');
  sheet1.getCell('A1').value = '标题';
  sheet1.getCell('A1').font = { bold: true };
  sheet1.getCell('A2').value = { formula: 'B2*2' };
  sheet1.getCell('B2').value = 21;
  sheet1.getCell('C3').value = '居中';
  sheet1.getCell('C3').alignment = { horizontal: 'center' };
  sheet1.mergeCells('A4:B4');
  sheet1.getCell('A4').value = 'merged';
  const sheet2 = workbook.addWorksheet('第二表');
  sheet2.getCell('A1').value = 'sheet2';
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('xlsx-convert（DEV-074，ADR-0015 R3）', () => {
  it('多 sheet / 公式 / 合并单元格 / 加粗样式往返保留', async () => {
    const bytes = await buildSampleXlsx();
    const parsed = parseXlsxToModel(bytes);
    expect(parsed.sheets.length).toBe(2);
    const sheet1 = parsed.sheets[0] as Record<string, unknown>;
    const celldata = (sheet1.celldata as Record<string, unknown>[]) ?? [];
    // 公式保留（fortune 以 = 前缀表示）。
    expect(celldata.some((c) => typeof (c.v as Record<string, unknown>).f === 'string')).toBe(true);
    // 加粗样式保留。
    expect(celldata.some((c) => (c.v as Record<string, unknown>).bl === 1)).toBe(true);
    // 合并单元格保留。
    const config = (sheet1.config as Record<string, unknown>) ?? {};
    const merge = (config.merge as Record<string, unknown>) ?? {};
    expect(Object.keys(merge).length).toBeGreaterThan(0);

    // 写回 → 再解析：结构稳定。
    const rebuilt = await writeModelToXlsx({ sheets: parsed.sheets });
    const reparsed = parseXlsxToModel(rebuilt);
    expect(reparsed.sheets.length).toBe(2);
    const rtCelldata = ((reparsed.sheets[0] as Record<string, unknown>).celldata ?? []) as Record<
      string,
      unknown
    >[];
    expect(rtCelldata.some((c) => typeof (c.v as Record<string, unknown>).f === 'string')).toBe(
      true,
    );
    expect(
      rtCelldata.some((c) => (c.v as Record<string, unknown>).v === '标题'),
    ).toBe(true);
  });

  it('损坏 / 非 zip 字节 fail-closed 拒绝', () => {
    expect(() => parseXlsxToModel(Buffer.from('not a zip at all'))).toThrow(XlsxError);
    expect(() => parseXlsxToModel(Buffer.alloc(0))).toThrow(XlsxError);
  });
});
